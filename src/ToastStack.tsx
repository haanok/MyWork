import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { CircleCheck, CircleX, Info, Trash2, TriangleAlert, X, type LucideIcon } from 'lucide-react';

/* Adapted from Bencho's MIT-licensed Toast stack.
   Source and licence: https://bencho.dev/licence
   See docs/licenses/bencho-MIT.txt.

   ══ Toast stack ══════════════════════════════════════════
   Three toasts, at most: the newest in front, the two before it
   tucked behind with a sliver of each showing above it, a step
   smaller each and a barely-there grey (the reference's tones). Point at the stack and it
   fans out into a list; move away and it gathers back up.

   ── ONE SPRING, THREE PLACES ────────────────────────────
   A toast's place is worked out from how far back it is and
   whether the stack is open, and Framer springs it there. Opening,
   closing, a toast leaving and the next arriving are all the same
   move — every toast heading for its new place on the same spring,
   a touch under critical so it settles with a hint of give.

   ── HOVER IS THE WHOLE FRAME ────────────────────────────
   Hovering the toasts themselves would let the list slide
   out from under the pointer and close again; the frame is the
   list's own size, so hovering it is hovering the list. Pointer
   over/out with a containment test rather than enter/leave, so the
   wall's demonstration — which dispatches its own pointer events,
   and leaves with no relatedTarget — opens and closes it too (the
   tilt card's note has the long version).

   MyWork anchors both states to the bottom and measures each card
   so long errors can wrap. Real notifications replace the demo's
   endless pool: dismissing one never creates a synthetic message. */

type Kind = 'success' | 'info' | 'error' | 'warning' | 'removed';
export type ToastInput = {
  kind: Kind;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  /** Zero leaves expiry to the caller (for example the board's Undo window). */
  duration?: number;
};
export type Toast = ToastInput & { id: number };

const ICON: Record<Kind, LucideIcon> = {
  success: CircleCheck,
  info: Info,
  error: CircleX,
  warning: TriangleAlert,
  removed: Trash2,
};
const H = 64;
const SHOWN = 3;
/* a touch under critical: it settles with a hint of give, no wobble */
const SPRING = { type: 'spring', stiffness: 380, damping: 34, mass: 1 } as const;

export function useToastStack() {
  /* front first; ids count up so a returning toast is a new element */
  const next = useRef(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((toast: ToastInput) => {
    const id = next.current++;
    setToasts((stack) => [{ ...toast, id }, ...stack].slice(0, SHOWN));
    return id;
  }, []);
  const dismiss = useCallback((id: number) => {
    setToasts((stack) => stack.filter((toast) => toast.id !== id));
  }, []);
  return { toasts, notify, dismiss };
}

function ToastCard({ toast, index, open, paused, y, scale, reducedMotion, onDismiss, onMeasure }: {
  toast: Toast;
  index: number;
  open: boolean;
  paused: boolean;
  y: number;
  scale: number;
  reducedMotion: boolean;
  onDismiss: (id: number) => void;
  onMeasure: (id: number, height: number | null) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const remaining = useRef(toast.duration ?? 6000);
  const Icon = ICON[toast.kind];
  const front = index === 0;
  const present = useIsPresent();

  useEffect(() => {
    const card = element.current;
    if (!card) return;
    const measure = () => onMeasure(toast.id, card.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => { observer.disconnect(); onMeasure(toast.id, null); };
  }, [onMeasure, toast.id]);

  useEffect(() => {
    if (paused || toast.duration === 0) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [onDismiss, paused, toast.duration, toast.id]);

  return (
    <motion.div
      ref={element}
      className="tst-toast"
      data-kind={toast.kind}
      data-front={front || undefined}
      style={{ zIndex: SHOWN - index }}
      /* a new one rises in from below the front */
      initial={{ y: reducedMotion ? y : y + 24, scale: 1, opacity: 0, x: 0 }}
      animate={{ y, scale, opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: reducedMotion ? 0 : 60, transition: { duration: reducedMotion ? 0 : 0.22, ease: [0.4, 0, 1, 1] } }}
      transition={reducedMotion ? { duration: 0 } : SPRING}
      aria-hidden={!present || (!open && !front) ? true : undefined}
      inert={!present || (!open && !front)}
    >
      <span className="tst-icon"><Icon size={18} strokeWidth={2} aria-hidden="true" /></span>
      <span className="tst-text">
        <b>{toast.title}</b>
        {toast.body && <span>{toast.body}</span>}
      </span>
      {toast.action && (
        <button type="button" className="tst-act" onClick={() => {
          toast.action?.onClick();
          onDismiss(toast.id);
        }}>
          {toast.action.label}
        </button>
      )}
      <button type="button" className="tst-x" aria-label={`Dismiss ${toast.title}`} onClick={() => {
        toast.onDismiss?.();
        onDismiss(toast.id);
      }}>
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </motion.div>
  );
}

export function ToastStack({ toasts, onDismiss, peek = 14, gap = 10, corner }: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  peek?: number;
  gap?: number;
  corner?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const [pageHidden, setPageHidden] = useState(document.hidden);
  const reducedMotion = Boolean(useReducedMotion());
  const root = useRef<HTMLDivElement>(null);
  const open = toasts.length > 0 && (hovered || focused);
  const onMeasure = useCallback((id: number, height: number | null) => {
    setHeights((current) => {
      if (height === null) {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      return current[id] === height ? current : { ...current, [id]: height };
    });
  }, []);

  useEffect(() => {
    const update = () => setPageHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) { setHovered(false); setFocused(false); }
  }, [toasts.length]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setHovered(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  /* the frame is the open list's size; both states share its bottom */
  const listH = toasts.reduce((sum, toast) => sum + (heights[toast.id] ?? H), 0)
    + Math.max(0, toasts.length - 1) * gap;
  const place = (k: number) => {
    if (open) {
      /* the list: front at the bottom, the rest above it */
      const below = toasts.slice(0, k + 1).reduce((sum, toast) => sum + (heights[toast.id] ?? H), 0);
      return { y: listH - below - k * gap, scale: 1 };
    }
    /* the stack: front at the bottom, each one behind a peek higher
       and a step smaller, hanging from its top edge */
    return { y: listH - (heights[toasts[0]?.id] ?? H) - k * peek, scale: 1 - k * 0.05 };
  };

  return (
    <>
      <div className="visually-hidden" role="status" aria-atomic="true">
        {toasts[0] && <span key={toasts[0].id}>{toasts[0].title}{toasts[0].body ? `. ${toasts[0].body}` : ''}</span>}
      </div>
      <div
        ref={root}
        className="tst"
        role="region"
        aria-label="Notifications"
        data-open={open || undefined}
        style={{ height: listH, ...(corner === undefined ? {} : { '--tst-r': `${corner}px` }) } as CSSProperties}
        onPointerOver={(event) => { if (event.pointerType !== 'touch') setHovered(true); }}
        onPointerOut={(event) => {
          const to = event.relatedTarget;
          if (!(to instanceof Node) || !root.current?.contains(to)) setHovered(false);
        }}
        onPointerDown={(event) => { if (event.pointerType === 'touch') setHovered(true); }}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!root.current?.contains(event.relatedTarget)) { setFocused(false); setHovered(false); }
        }}
      >
        <AnimatePresence>
          {toasts.map((toast, index) => (
            <ToastCard
              key={toast.id}
              toast={toast}
              index={index}
              open={open}
              paused={open || pageHidden}
              {...place(index)}
              reducedMotion={reducedMotion}
              onDismiss={onDismiss}
              onMeasure={onMeasure}
            />
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
