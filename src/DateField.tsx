import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { addDays, formatDueLong, toISODate, today } from './dates';
import { IconCalendar } from './icons';

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const monthTitle = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

/** Monday-first weekday headers (2024-01-01 was a Monday). */
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => weekdayShort.format(new Date(2024, 0, 1 + i)).replace('.', ''));

/** ISO 8601 week number. */
function isoWeek(date: Date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
}

const shift = (iso: string, days: number) => {
  const d = parse(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
};

const shiftMonth = (iso: string, months: number) => {
  const d = parse(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISODate(d);
};

const nextMonday = () => {
  const d = new Date();
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return toISODate(d);
};

const POPOVER_WIDTH = 296;
const GAP = 6;
const EDGE = 8;

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name when the field is not wrapped in a <label>. */
  label?: string;
  placeholder?: string;
  className?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

/**
 * Themed replacement for <input type="date">. Stores local YYYY-MM-DD strings,
 * opens a Monday-first month grid with ISO week numbers, and is fully keyboard
 * driven (arrows, PageUp/PageDown, Home/End, Enter, Escape).
 */
export function DateField({ value, onChange, label, placeholder = 'No date', className = '', onKeyDown }: Props) {
  const [open, setOpen] = useState(false);
  const [focusDate, setFocusDate] = useState(() => value || today());
  const [position, setPosition] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const [host, setHost] = useState<Element | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const titleId = useId();

  const todayIso = today();
  const view = parse(focusDate);
  const viewYear = view.getFullYear();
  const viewMonth = view.getMonth();

  const weeks = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 6 }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        return date;
      }),
    );
  }, [viewYear, viewMonth]);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const height = popover?.offsetHeight ?? 360;
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - EDGE * 2);
    const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE));
    const fitsBelow = rect.bottom + GAP + height <= window.innerHeight - EDGE;
    const fitsAbove = rect.top - GAP - height >= EDGE;
    const above = !fitsBelow && fitsAbove;
    const top = above ? rect.top - GAP - height : Math.min(rect.bottom + GAP, Math.max(EDGE, window.innerHeight - height - EDGE));
    setPosition({ top, left, above });
  }, []);

  const openPicker = () => {
    setFocusDate(value || today());
    focusOnOpen.current = true;
    setHost(triggerRef.current?.closest('.app') ?? document.body);
    setOpen(true);
  };

  const close = (returnFocus = true) => {
    setOpen(false);
    setPosition(null);
    if (returnFocus) triggerRef.current?.focus();
  };

  const commit = (iso: string) => {
    onChange(iso);
    close();
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  // Focus the active day on open, and keep focus on it as arrow keys move it.
  useEffect(() => {
    if (!open || !position) return;
    const cell = gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`);
    if (!cell) return;
    if (focusOnOpen.current || gridRef.current?.contains(document.activeElement)) {
      cell.focus({ preventScroll: true });
      focusOnOpen.current = false;
    }
  }, [open, position, focusDate]);

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => shift(focusDate, -1),
      ArrowRight: () => shift(focusDate, 1),
      ArrowUp: () => shift(focusDate, -7),
      ArrowDown: () => shift(focusDate, 7),
      PageUp: () => shiftMonth(focusDate, event.shiftKey ? -12 : -1),
      PageDown: () => shiftMonth(focusDate, event.shiftKey ? 12 : 1),
      Home: () => shift(focusDate, -((parse(focusDate).getDay() + 6) % 7)),
      End: () => shift(focusDate, 6 - ((parse(focusDate).getDay() + 6) % 7)),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setFocusDate(move());
    }
  };

  const onPopoverKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // The popover is portaled but React still bubbles to the editor; keep Escape local.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openPicker();
      return;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && value) {
      event.preventDefault();
      onChange('');
      return;
    }
    onKeyDown?.(event);
  };

  const quick = [
    { label: 'Today', iso: todayIso },
    { label: 'Tomorrow', iso: addDays(1) },
    { label: 'Next Monday', iso: nextMonday() },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`crm-field date-field${value ? '' : ' is-empty'}${open ? ' is-open' : ''} ${className}`.trim()}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label ? `${label}: ${value ? dayLabel.format(parse(value)) : placeholder}` : undefined}
        onClick={() => (open ? close() : openPicker())}
        onKeyDown={onTriggerKey}
      >
        <span className="date-field-value num">{value ? formatDueLong(value) : placeholder}</span>
        <IconCalendar width={15} height={15} />
      </button>
      {open && host && createPortal(
        <div
          ref={popoverRef}
          className={`date-popover${position?.above ? ' is-above' : ''}`}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, visibility: position ? 'visible' : 'hidden' }}
          onKeyDown={onPopoverKey}
        >
          <div className="date-popover-head">
            <button type="button" className="date-popover-nav" aria-label="Previous month" onClick={() => setFocusDate(shiftMonth(focusDate, -1))}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <h3 id={titleId} className="date-popover-title" aria-live="polite">{monthTitle.format(view)}</h3>
            <button type="button" className="date-popover-nav" aria-label="Next month" onClick={() => setFocusDate(shiftMonth(focusDate, 1))}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>

          <div className="date-popover-quick">
            {quick.map((entry) => (
              <button type="button" key={entry.label} className={value === entry.iso ? 'is-active' : ''} aria-pressed={value === entry.iso} onClick={() => commit(entry.iso)}>
                {entry.label}
              </button>
            ))}
          </div>

          <div ref={gridRef} className="date-grid" role="grid" aria-labelledby={titleId} onKeyDown={onGridKey}>
            <div className="date-grid-row is-head" role="row">
              <span className="date-grid-week" role="columnheader" aria-label="Week">Wk</span>
              {WEEKDAYS.map((name) => <span key={name} role="columnheader" className="date-grid-weekday">{name}</span>)}
            </div>
            {weeks.map((week) => (
              <div className="date-grid-row" role="row" key={toISODate(week[0])}>
                <span className="date-grid-week num" role="rowheader">{isoWeek(week[0])}</span>
                {week.map((date) => {
                  const iso = toISODate(date);
                  const outside = date.getMonth() !== viewMonth;
                  const weekend = date.getDay() === 0 || date.getDay() === 6;
                  const classes = [
                    'date-cell',
                    'num',
                    outside && 'is-outside',
                    weekend && 'is-weekend',
                    iso === todayIso && 'is-today',
                    iso === value && 'is-selected',
                    iso < todayIso && 'is-past',
                  ].filter(Boolean).join(' ');
                  return (
                    <span role="gridcell" key={iso} aria-selected={iso === value}>
                      <button
                        type="button"
                        className={classes}
                        data-date={iso}
                        tabIndex={iso === focusDate ? 0 : -1}
                        aria-label={`${dayLabel.format(date)}${iso === todayIso ? ', today' : ''}`}
                        aria-current={iso === todayIso ? 'date' : undefined}
                        onClick={() => commit(iso)}
                        onFocus={() => iso !== focusDate && setFocusDate(iso)}
                      >
                        {date.getDate()}
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="date-popover-foot">
            <span className="date-popover-hint">{value ? formatDueLong(value) : 'No date set'}</span>
            {value && <button type="button" className="date-popover-clear" onClick={() => commit('')}>Clear</button>}
          </div>
        </div>,
        host,
      )}
    </>
  );
}
