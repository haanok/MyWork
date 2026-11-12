import { useEffect, useMemo, useRef, useState } from 'react';
import { IconCheck, IconClose, IconCopy } from './icons';
import { formatClock, formatDuration, formatHours, totalsByCustomer, useNow, type TrackerState } from './timeTracking';
import type { Customer, Task } from './types';

/** Footer of the customer list: live clock plus the clock-out / resume controls. */
export function TimeTrackerPanel({
  state,
  customers,
  onPause,
  onResume,
  onShowSummary,
}: {
  state: TrackerState;
  customers: Customer[];
  onPause: () => void;
  onResume: () => void;
  onShowSummary: () => void;
}) {
  const now = useNow(state.running);
  const totals = totalsByCustomer(state, now);
  const sessionTotal = [...totals.values()].reduce((sum, ms) => sum + ms, 0);
  const current = state.running ? state.segments[state.segments.length - 1] : undefined;
  const currentName = current ? customers.find((c) => c.id === current.customerId)?.name || 'Untitled customer' : undefined;

  return (
    <section className={`time-tracker${state.running ? ' is-running' : ''}`} aria-label="Time tracking">
      <div className="time-tracker-status">
        <span className="time-tracker-dot" aria-hidden="true" />
        <span className="time-tracker-copy">
          <span className="time-tracker-label">{state.running ? `Tracking ${currentName}` : 'Tracking paused'}</span>
          <span className="time-tracker-clock" aria-live="off">
            {current ? formatClock(totals.get(current.customerId) ?? 0) : formatClock(sessionTotal)}
            {current && <span className="time-tracker-total"> · {formatDuration(sessionTotal)} total</span>}
          </span>
        </span>
      </div>
      <div className="time-tracker-actions">
        {state.paused ? (
          <button type="button" className="crm-primary small-primary" onClick={onResume}>Resume</button>
        ) : (
          <button type="button" className="crm-secondary" onClick={onPause}>Pause</button>
        )}
        <button type="button" className="crm-secondary" onClick={onShowSummary}>Summary</button>
      </div>
    </section>
  );
}

export function TimeSummaryDialog({
  state,
  customers,
  tasks,
  onResume,
  onClear,
  onClose,
}: {
  state: TrackerState;
  customers: Customer[];
  tasks: Task[];
  onResume: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const now = useNow(state.running);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  const sessionStart = state.segments[0]?.start;
  const rows = useMemo(() => {
    const totals = totalsByCustomer(state, now);
    return [...totals.entries()]
      .map(([customerId, ms]) => {
        const customer = customers.find((c) => c.id === customerId);
        const completed = sessionStart === undefined ? [] : tasks.filter((t) =>
          t.customerId === customerId && t.status === 'done' && t.doneAt && Date.parse(t.doneAt) >= sessionStart);
        return { customerId, name: customer?.name || (customer ? 'Untitled customer' : 'Deleted customer'), ms, completed };
      })
      .sort((a, b) => b.ms - a.ms);
  }, [state, now, customers, tasks, sessionStart]);
  const total = rows.reduce((sum, row) => sum + row.ms, 0);

  const range = sessionStart === undefined ? '' : `${new Date(sessionStart).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })} – ${new Date(state.running ? now : state.segments[state.segments.length - 1].end).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  })}`;

  const asText = () => [
    `Time summary${range ? ` (${range})` : ''}`,
    ...rows.flatMap((row) => [
      `${row.name}: ${formatDuration(row.ms)} (${formatHours(row.ms)} h)`,
      ...row.completed.map((task) => `  - ${task.title}${task.solution ? `: ${task.solution.replace(/\s+/g, ' ')}` : ''}`),
    ]),
    `Total: ${formatDuration(total)} (${formatHours(total)} h)`,
  ].join('\n');

  const close = () => ref.current?.close();

  return (
    <dialog
      ref={ref}
      className="import-dialog time-summary-dialog"
      aria-labelledby="time-summary-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="mcp-head">
        <h2 id="time-summary-title">Time summary</h2>
        <button type="button" className="icon-key" onClick={close} aria-label="Close">
          <IconClose width={16} height={16} />
        </button>
      </div>
      <p className="time-summary-lead">
        {rows.length === 0
          ? 'No time logged yet. Time is tracked while a customer is open.'
          : `${range}${state.paused ? ' · Tracking paused' : ''}`}
      </p>

      {rows.length > 0 && (
        <>
          <ul className="time-summary-list">
            {rows.map((row) => (
              <li key={row.customerId}>
                <div className="time-summary-row">
                  <strong>{row.name}</strong>
                  <span>{formatDuration(row.ms)} <em>{formatHours(row.ms)} h</em></span>
                </div>
                {row.completed.length > 0 && (
                  <ul className="time-summary-tasks">
                    {row.completed.map((task) => (
                      <li key={task.id}>
                        <IconCheck width={13} height={13} aria-hidden="true" />
                        <span>
                          {task.title}
                          {task.solution && <span className="time-summary-solution"> — {task.solution}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <div className="time-summary-row time-summary-total">
            <strong>Total</strong>
            <span>{formatDuration(total)} <em>{formatHours(total)} h</em></span>
          </div>
        </>
      )}

      <div className="import-actions time-summary-actions">
        {rows.length > 0 && (
          <>
            <button
              type="button"
              className="crm-secondary"
              onClick={() => { void navigator.clipboard?.writeText(asText()).then(() => setCopied(true), () => undefined); }}
            >
              {copied ? <IconCheck width={15} height={15} /> : <IconCopy width={15} height={15} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="crm-secondary"
              onClick={() => { if (window.confirm('Clear all logged time? This cannot be undone.')) onClear(); }}
            >
              Clear log
            </button>
          </>
        )}
        {state.paused && (
          <button type="button" className="crm-primary" onClick={() => { onResume(); close(); }}>Resume tracking</button>
        )}
      </div>
    </dialog>
  );
}
