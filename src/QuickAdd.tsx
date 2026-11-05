import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDueLong, relativeDue } from './dates';
import { parseQuickAdd } from './quickAddParse';
import type { Customer, Priority } from './types';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const QUICK_ADD_KEYS = isMac ? '⌘K' : 'Ctrl+K';

interface Props {
  customers: Customer[];
  current: Customer | null;
  onAdd: (customerId: string, title: string, priority: Priority, due?: string) => void;
  onClose: () => void;
}

export function QuickAddDialog({ customers, current, onAdd, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseQuickAdd(text, customers, current), [text, customers, current]);
  const exampleKey = 'customer';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const problem = !text.trim()
    ? null
    : parsed.customerProblem
      ?? (!parsed.customer ? 'Start with the customer name and a colon, for example “' + exampleKey + ': …”.' : null)
      ?? (!parsed.title ? 'Write the task after the colon.' : null);
  const canAdd = Boolean(text.trim() && parsed.customer && parsed.title && !problem);

  const submit = () => {
    if (!canAdd || !parsed.customer) return;
    onAdd(parsed.customer.id, parsed.title, parsed.priority, parsed.due);
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="import-dialog quick-add-dialog"
      aria-labelledby="quick-add-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === dialogRef.current) onClose(); }}
    >
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h2 id="quick-add-title">Quick add task</h2>
        <p className="quick-add-lead">
          Capture a task for any customer without leaving what you are doing. Open this box from anywhere
          with <kbd>{QUICK_ADD_KEYS}</kbd>{isMac ? ' (Command and K)' : ' (Control and K)'}.
        </p>
        <label className="visually-hidden" htmlFor="quick-add-input">Task</label>
        <input
          id="quick-add-input"
          className="quick-add-input"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder={current ? `Task for ${current.name}…` : `${exampleKey}: send report fri !`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby="quick-add-preview quick-add-help"
        />

        <div id="quick-add-preview" className="quick-add-preview" aria-live="polite">
          {problem ? (
            <span className="quick-add-problem">{problem}</span>
          ) : parsed.customer && parsed.title ? (
            <>
              <span className="quick-add-chip">{parsed.customer.name}</span>
              <span className="quick-add-chip-title">{parsed.title}</span>
              {parsed.due && <span className="quick-add-chip">Due {formatDueLong(parsed.due)} · {relativeDue(parsed.due)}</span>}
              {parsed.priority === 'high' && <span className="quick-add-chip quick-add-high">High priority</span>}
            </>
          ) : (
            <span className="quick-add-hint">
              {current ? `Adds to ${current.name}. Type “name:” first to pick another customer.` : 'Nothing typed yet.'}
            </span>
          )}
        </div>

        <details id="quick-add-help" className="quick-add-help" open={!text}>
          <summary>How to write it</summary>
          <dl>
            <dt><code>{exampleKey}:</code></dt>
            <dd>Customer first, then a colon: its short name (set it on the customer, e.g. <code>sg</code>) or the start of its name.{current ? ' Leave it out to use the open customer.' : ''}</dd>
            <dt><code>fri</code> <code>tomorrow</code> <code>+3</code> <code>12.11</code></dt>
            <dd>A date at the end sets the due date (weekday, today/tomorrow, days from now, or day.month).</dd>
            <dt><code>!</code></dt>
            <dd>At the end: high priority.</dd>
          </dl>
          <p className="quick-add-example">Example: <code>{exampleKey}: send report fri !</code></p>
        </details>

        <div className="import-actions">
          <span className="quick-add-keys"><kbd>Enter</kbd> add · <kbd>Esc</kbd> close</span>
          <button type="button" className="crm-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="crm-primary" disabled={!canAdd}>Add task</button>
        </div>
      </form>
    </dialog>
  );
}
