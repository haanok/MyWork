import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { today, toISODate, uid } from './dates';
import { IconFlag, IconPlus, IconTrash } from './icons';
import { KanbanBoard } from './KanbanBoard';
import { dailyTotals, formatDuration, useNow, type useTimeTracker } from './timeTracking';
import { TimeTrackerPanel } from './TimeTracker';
import { TaskEntry } from './TaskEntry';
import type { Customer, CustomerStatus, Priority, Task, TaskStatus } from './types';

type TaskFilter = 'open' | 'done' | 'all';
export type WorkspaceLayout = 'list' | 'board';

interface Props {
  customer: Customer;
  customers: Customer[];
  tasks: Task[];
  autoFocusName: boolean;
  sourceLabel: string;
  layout: WorkspaceLayout;
  onLayoutChange: (layout: WorkspaceLayout) => void;
  tracker?: ReturnType<typeof useTimeTracker>;
  onShowSummary: () => void;
  onSelectCustomer: (id: string) => void;
  onAddCustomer: () => void;
  onUpdateCustomer: (patch: Partial<Customer>) => void;
  onAddTask: (title: string, description: string, priority: Priority, due?: string, status?: TaskStatus) => void;
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
  onRemoveTask: (id: string) => void;
  onArchiveCustomer: () => void;
  onDeleteCustomer: () => void;
}

const CUSTOMER_STATUSES: CustomerStatus[] = ['active', 'waiting', 'paused', 'archived'];
const CUSTOMER_STATUS_LABEL: Record<CustomerStatus, string> = {
  active: 'Active',
  waiting: 'Waiting',
  paused: 'Paused',
  archived: 'Archived',
};

function CustomerRail({
  customer, customers, tasks, tracker, onAddCustomer, onSelectCustomer, onShowSummary,
}: Pick<Props, 'customer' | 'customers' | 'tasks' | 'tracker' | 'onAddCustomer' | 'onSelectCustomer' | 'onShowSummary'>) {
  const now = useNow(tracker?.state.running ?? false);
  const totals = tracker ? dailyTotals(tracker.state, now, toISODate(new Date(now))) : new Map<string, number>();
  return (
    <aside className="customer-rail" aria-label="Customer navigation">
      <div className="rail-heading">
        <div>
          <h2>Customers</h2>
          <span>{customers.length} records</span>
        </div>
        <button type="button" className="icon-key" onClick={onAddCustomer} aria-label="Add customer" title="Add customer">
          <IconPlus />
        </button>
      </div>
      <nav className="customer-nav">
        {customers.map((entry) => {
          const count = tasks.filter((task) => task.customerId === entry.id && task.status !== 'done').length;
          return (
            <button
              type="button"
              key={entry.id}
              className={`customer-nav-item${entry.id === customer.id ? ' is-current' : ''}`}
              aria-current={entry.id === customer.id ? 'page' : undefined}
              onClick={() => onSelectCustomer(entry.id)}
            >
              <span className="customer-mark" aria-hidden="true">{entry.name.slice(0, 1).toUpperCase() || '?'}</span>
              <span className="customer-nav-copy">
                <span className="customer-nav-name">{entry.name || 'Untitled customer'}</span>
                <span className="customer-nav-meta">
                  <span className="customer-nav-status">{entry.status}</span>
                  {tracker && (
                    <span className="customer-nav-time" title="Time tracked today">
                      <span aria-hidden="true"> · </span>
                      <span className="visually-hidden">Time today </span>
                      {formatDuration(totals.get(entry.id) ?? 0)}
                    </span>
                  )}
                </span>
              </span>
              <span className="customer-nav-count">{count}</span>
            </button>
          );
        })}
      </nav>
      {tracker && (
        <TimeTrackerPanel
          state={tracker.state}
          customer={customer}
          totals={totals}
          onPause={tracker.pause}
          onResume={tracker.resume}
          onShowSummary={onShowSummary}
        />
      )}
    </aside>
  );
}

export function CustomerWorkspace({
  customer,
  customers,
  tasks,
  autoFocusName,
  sourceLabel,
  layout,
  onLayoutChange,
  tracker,
  onShowSummary,
  onSelectCustomer,
  onAddCustomer,
  onUpdateCustomer,
  onAddTask,
  onUpdateTask,
  onRemoveTask,
  onArchiveCustomer,
  onDeleteCustomer,
}: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [composerOpen, setComposerOpen] = useState(false);
  const taskTitleRef = useRef<HTMLInputElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isBoard = layout === 'board';

  useEffect(() => {
    if (composerOpen) taskTitleRef.current?.focus();
  }, [composerOpen]);

  useEffect(() => {
    if (autoFocusName) nameRef.current?.select();
  }, [autoFocusName, customer.id]);

  const customerTasks = useMemo(() => tasks.filter((task) => task.customerId === customer.id), [tasks, customer.id]);
  const shortNameTaken = customer.shortName
    ? customers.find((entry) => entry.id !== customer.id && entry.shortName === customer.shortName)?.name
    : undefined;
  const openCount = customerTasks.filter((task) => task.status !== 'done').length;
  const overdueCount = customerTasks.filter((task) => task.status !== 'done' && task.due && task.due < today()).length;
  const doneCount = customerTasks.filter((task) => task.status === 'done').length;

  const orderedTasks = useMemo(() => {
    const filtered = customerTasks.filter((task) => {
      if (filter === 'open') return task.status !== 'done';
      if (filter === 'done') return task.status === 'done';
      return true;
    });
    return filtered.sort((a, b) => {
      if (a.status === 'done' && b.status === 'done') return (b.doneAt ?? '').localeCompare(a.doneAt ?? '');
      if (a.status === 'done') return 1;
      if (b.status === 'done') return -1;
      return (a.due ?? '9999-12-31').localeCompare(b.due ?? '9999-12-31');
    });
  }, [customerTasks, filter]);

  const submitTask = (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    onAddTask(cleanTitle, description.trim(), priority, due || undefined);
    setTitle('');
    setDescription('');
    setDue('');
    setPriority('normal');
  };

  return (
    <div className={`crm-workspace${isBoard ? ' is-board' : ''}${isBoard && detailsOpen ? ' has-details' : ''}`}>
      <CustomerRail
        customer={customer}
        customers={customers}
        tasks={tasks}
        tracker={tracker}
        onAddCustomer={onAddCustomer}
        onSelectCustomer={onSelectCustomer}
        onShowSummary={onShowSummary}
      />

      <section className="crm-main" aria-label={`${customer.name} task queue`}>
        <header className="record-head">
          <div className="record-identity">
            <span className="record-mark" aria-hidden="true">{customer.name.slice(0, 1).toUpperCase() || '?'}</span>
            <div className="record-title-block">
              <input
                ref={nameRef}
                className="customer-name-input"
                aria-label="Customer name"
                value={customer.name}
                onChange={(event) => onUpdateCustomer({ name: event.target.value })}
                onBlur={() => {
                  if (!customer.name.trim()) onUpdateCustomer({ name: 'Untitled customer' });
                }}
                autoFocus={autoFocusName}
              />
              <span className="record-meta">Customer record · Updated {new Date(customer.touchedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
            </div>
          </div>
          <div className="record-controls">
          <div className="record-view-controls">
          <div className="task-filters layout-toggle" role="group" aria-label="Task layout">
            <button type="button" aria-pressed={!isBoard} className={!isBoard ? 'is-active' : ''} onClick={() => onLayoutChange('list')}>List</button>
            <button type="button" aria-pressed={isBoard} className={isBoard ? 'is-active' : ''} onClick={() => onLayoutChange('board')}>Board</button>
          </div>
          {isBoard && (
            <button
              type="button"
              className="crm-secondary details-toggle"
              aria-expanded={detailsOpen}
              aria-controls="customer-details"
              onClick={() => setDetailsOpen((open) => !open)}
            >
              {detailsOpen ? 'Hide details' : 'Notes & contacts'}
            </button>
          )}
          </div>
          <div className="record-fields">
          <label className="customer-status-control short-name-control" title="Type “sg: send report” in quick add to log a task for this customer">
            <span>Short name</span>
            <input
              className="short-name-input"
              aria-label="Customer short name"
              aria-describedby={shortNameTaken ? 'short-name-taken' : undefined}
              placeholder="e.g. sg"
              maxLength={12}
              autoComplete="off"
              spellCheck={false}
              value={customer.shortName ?? ''}
              onChange={(event) => {
                const shortName = event.target.value.toLowerCase().replace(/[\s:]+/g, '');
                onUpdateCustomer({ shortName: shortName || undefined });
              }}
            />
            {shortNameTaken && <span id="short-name-taken" className="short-name-taken">Also used by {shortNameTaken}</span>}
          </label>
          <label className="customer-status-control">
            <span>Status</span>
            <select
              value={customer.status}
              onChange={(event) => onUpdateCustomer({ status: event.target.value as CustomerStatus })}
              aria-label="Customer status"
            >
              {CUSTOMER_STATUSES.map((status) => <option key={status} value={status}>{CUSTOMER_STATUS_LABEL[status]}</option>)}
            </select>
          </label>
          </div>
          </div>
        </header>

        <div className="queue-summary" aria-label="Task summary">
          <span><b>{openCount}</b> open</span>
          <span className={overdueCount > 0 ? 'summary-alert' : ''}><b>{overdueCount}</b> overdue</span>
          <span><b>{doneCount}</b> completed</span>
        </div>

        {isBoard ? (
          <KanbanBoard
            tasks={customerTasks}
            onAddTask={onAddTask}
            onUpdateTask={onUpdateTask}
            onRemoveTask={onRemoveTask}
          />
        ) : (<>
        <button
          type="button"
          className="mobile-log-task crm-primary"
          aria-expanded={composerOpen}
          aria-controls="task-composer"
          onClick={() => setComposerOpen((open) => !open)}
        >
          {composerOpen ? 'Close' : 'Log a task'}
        </button>
        <form id="task-composer" className={`task-composer${composerOpen ? ' is-open' : ''}`} onSubmit={submitTask}>
          <div className="composer-heading">
            <div>
              <h3>Log a task</h3>
              <p>Capture the next action with enough context to pick it up later.</p>
            </div>
          </div>
          <input
            ref={taskTitleRef}
            className="crm-field task-input"
            aria-label="Task title"
            placeholder="Task title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoComplete="off"
          />
          <textarea
            className="crm-field composer-description"
            aria-label="Task description"
            placeholder="Description, next steps, or call notes"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <div className="composer-actions">
            <label className="date-control">
              <span>Due date</span>
              <input className="crm-field" type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            </label>
            <div className="priority-control" role="group" aria-label="Task priority">
              <button type="button" className={priority === 'normal' ? 'is-active' : ''} aria-pressed={priority === 'normal'} onClick={() => setPriority('normal')}>Normal</button>
              <button type="button" className={priority === 'high' ? 'is-active' : ''} aria-pressed={priority === 'high'} onClick={() => setPriority('high')}>
                <IconFlag width={15} height={15} /> High
              </button>
            </div>
            <button type="submit" className="crm-primary" disabled={!title.trim()}>
              <IconPlus width={16} height={16} /> Add task
            </button>
          </div>
        </form>

        <div className="task-queue-head">
          <h3>Task queue</h3>
          <div className="task-filters" role="tablist" aria-label="Filter tasks">
            {(['open', 'all', 'done'] as TaskFilter[]).map((value) => (
              <button
                type="button"
                key={value}
                role="tab"
                aria-selected={filter === value}
                className={filter === value ? 'is-active' : ''}
                onClick={() => setFilter(value)}
              >
                {value === 'open' ? 'Open' : value === 'done' ? 'Completed' : 'All'}
              </button>
            ))}
          </div>
        </div>

        <div className="task-list crm-task-list">
          {orderedTasks.length === 0 ? (
            <div className="queue-empty">
              <span className="empty-mark" aria-hidden="true">+</span>
              <p>{filter === 'done' ? 'No completed tasks yet.' : 'No tasks in this view.'}</p>
              <span>Log a task to record the next action.</span>
            </div>
          ) : orderedTasks.map((task) => (
            <TaskEntry key={task.id} task={task} onUpdate={onUpdateTask} onRemove={onRemoveTask} />
          ))}
        </div>
        </>)}
      </section>

      {(!isBoard || detailsOpen) && (
      <aside id="customer-details" className="context-rail" aria-label="Customer details">
        <section className="context-section">
          <div className="context-heading">
            <h3>Context</h3>
            <span className="context-live">{sourceLabel}</span>
          </div>
          <label className="context-label" htmlFor="customer-notes">Working notes</label>
          <textarea
            id="customer-notes"
            className="crm-field customer-notes"
            rows={7}
            value={customer.notes}
            placeholder="Preferences, current project, or details to remember"
            onChange={(event) => onUpdateCustomer({ notes: event.target.value })}
          />
        </section>

        <section className="context-section">
          <div className="context-heading">
            <h3>Contacts</h3>
            <span className="context-count">{customer.contacts.length}</span>
          </div>
          {customer.contacts.length === 0 ? (
            <p className="context-empty">No contacts added.</p>
          ) : (
            <ul className="crm-contact-list">
              {customer.contacts.map((contact) => (
                <li key={contact.id} className="crm-contact">
                  <span className="contact-avatar" aria-hidden="true">{contact.name.slice(0, 1).toUpperCase() || '?'}</span>
                  <div className="contact-copy">
                    <strong>{contact.name || 'New contact'}</strong>
                    <span>{contact.detail || 'Add contact details'}</span>
                  </div>
                  <button type="button" className="icon-key subtle-icon" aria-label={`Remove ${contact.name || 'contact'}`} onClick={() => onUpdateCustomer({ contacts: customer.contacts.filter((entry) => entry.id !== contact.id) })}>
                    <IconTrash width={15} height={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="crm-secondary add-contact"
            onClick={() => onUpdateCustomer({ contacts: [...customer.contacts, { id: uid(), name: '', detail: '' }] })}
          >
            <IconPlus width={15} height={15} /> Add contact
          </button>
          {customer.contacts.some((contact) => !contact.name || !contact.detail) && (
            <div className="contact-edit-list">
              {customer.contacts.filter((contact) => !contact.name || !contact.detail).map((contact) => (
                <div className="contact-edit" key={contact.id}>
                  <input className="crm-field" aria-label="Contact name" placeholder="Name" value={contact.name} onChange={(event) => onUpdateCustomer({ contacts: customer.contacts.map((entry) => entry.id === contact.id ? { ...entry, name: event.target.value } : entry) })} />
                  <input className="crm-field" aria-label="Contact detail" placeholder="Email or role" value={contact.detail} onChange={(event) => onUpdateCustomer({ contacts: customer.contacts.map((entry) => entry.id === contact.id ? { ...entry, detail: event.target.value } : entry) })} />
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="context-danger">
          <button type="button" className="remove-customer archive-customer" onClick={onArchiveCustomer}>Archive customer</button>
          <button type="button" className="remove-customer delete-customer" onClick={onDeleteCustomer}>Delete customer</button>
        </div>
      </aside>
      )}
    </div>
  );
}
