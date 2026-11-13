import { useEffect, useMemo, useRef, useState } from 'react';
import { toISODate } from './dates';
import { IconCheck, IconClose, IconCopy } from './icons';
import { formatClock, formatDuration, formatHours, dailyTotals, loggedDays, useNow, type TrackerState } from './timeTracking';
import type { Customer, Task } from './types';

/** Footer of the customer list: live clock plus the clock-out / resume controls. */
export function TimeTrackerPanel({
  state,
  customer,
  totals,
  onPause,
  onResume,
  onShowSummary,
}: {
  state: TrackerState;
  customer: Customer;
  totals: Map<string, number>;
  onPause: () => void;
  onResume: () => void;
  onShowSummary: () => void;
}) {
  const dayTotal = [...totals.values()].reduce((sum, ms) => sum + ms, 0);
  const name = customer.name || 'Untitled customer';

  return (
    <section className={`time-tracker${state.running ? ' is-running' : ''}`} aria-label="Time tracking">
      <div className="time-tracker-status">
        <span className="time-tracker-dot" aria-hidden="true" />
        <span className="time-tracker-copy">
          <span className="time-tracker-label">{state.running ? `Tracking ${name}` : 'Tracking paused'}</span>
          <span className="time-tracker-clock" aria-live="off">
            {formatClock(totals.get(customer.id) ?? 0)}
            <span className="time-tracker-total"> · {formatDuration(dayTotal)} total today</span>
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
  onResume?: () => void;
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

  const today = toISODate(new Date(now));
  const [pickedDay, setPickedDay] = useState('');
  const [customerId, setCustomerId] = useState('');
  const day = pickedDay || today;
  const days = useMemo(() => loggedDays(state), [state]);
  const customerNames = useMemo(() => {
    const names = new Map(customers.map((c) => [c.id, c.name || 'Untitled customer']));
    for (const segment of state.segments) {
      if (!names.has(segment.customerId)) names.set(segment.customerId, 'Deleted customer');
    }
    return names;
  }, [customers, state.segments]);

  const rows = useMemo(() => {
    const totals = dailyTotals(state, now, day);
    return [...totals]
      .filter(([id]) => !customerId || id === customerId)
      .map(([id, ms]) => ({
        customerId: id,
        name: customerNames.get(id),
        ms,
        completed: tasks.filter((t) => t.customerId === id && t.status === 'done' && t.doneAt
          && toISODate(new Date(t.doneAt)) === day),
      }))
      .sort((a, b) => b.ms - a.ms);
  }, [state, now, day, customerId, customerNames, tasks]);
  const total = rows.reduce((sum, row) => sum + row.ms, 0);

  const asText = () => [
    `Time summary (${day})`,
    ...rows.flatMap((row) => [
      `${row.name}: ${formatDuration(row.ms)} (${formatHours(row.ms)} h)`,
      ...row.completed.map((task) => `  - ${task.title}${task.solution ? `: ${task.solution.replace(/\s+/g, ' ')}` : ''}`),
    ]),
    `Total: ${formatDuration(total)} (${formatHours(total)} h)`,
  ].join('\n');

  const close = () => ref.current?.close();
  const clearHistory = () => {
    if (!window.confirm('Clear logged time for all customers on every day? This cannot be undone.')) return;
    onClear();
    setPickedDay('');
    setCustomerId('');
    setCopied(false);
  };

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
      <div className="time-summary-filters">
        <div>
          <label htmlFor="time-summary-day">Day</label>
          <select id="time-summary-day" value={pickedDay} onChange={(e) => { setPickedDay(e.target.value); setCopied(false); }}>
            <option value="">Today</option>
            {days.filter((date) => date !== today).map((date) => (
              <option key={date} value={date}>
                {new Date(date + 'T00:00:00').toLocaleDateString(undefined, { dateStyle: 'full' })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="time-summary-customer">Customer</label>
          <select id="time-summary-customer" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setCopied(false); }}>
            <option value="">All customers</option>
            {[...customerNames].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
      </div>
      {rows.length === 0 && (
        <p className="time-summary-lead">
          {customerId ? 'No time logged for this customer on this day.' : 'No time logged on this day.'}
        </p>
      )}

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
              onClick={clearHistory}
            >
              Clear all history
            </button>
          </>
        )}
        {state.paused && onResume && (
          <button type="button" className="crm-primary" onClick={() => { onResume(); close(); }}>Resume tracking</button>
        )}
      </div>
    </dialog>
  );
}
