import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { formatDueLong, relativeDue, today, uid } from './dates';
import { IconFlag, IconPlus, IconTrash } from './icons';
import type { Customer, CustomerStatus, Priority, Task, TaskStatus } from './types';

type TaskFilter = 'open' | 'done' | 'all';

interface Props {
  customer: Customer;
  customers: Customer[];
  tasks: Task[];
  autoFocusName: boolean;
  sourceLabel: string;
  onSelectCustomer: (id: string) => void;
  onAddCustomer: () => void;
  onUpdateCustomer: (patch: Partial<Customer>) => void;
  onAddTask: (title: string, description: string, priority: Priority, due?: string) => void;
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
  onRemoveTask: (id: string) => void;
  onArchiveCustomer: () => void;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  doing: 'In progress',
  done: 'Complete',
};

const CUSTOMER_STATUSES: CustomerStatus[] = ['active', 'waiting', 'paused', 'archived'];

export function CustomerWorkspace({
  customer,
  customers,
  tasks,
  autoFocusName,
  sourceLabel,
  onSelectCustomer,
  onAddCustomer,
  onUpdateCustomer,
  onAddTask,
  onUpdateTask,
  onRemoveTask,
  onArchiveCustomer,
}: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');

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
    <div className="crm-workspace">
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
                  <span className="customer-nav-status">{entry.status}</span>
                </span>
                <span className="customer-nav-count">{count}</span>
              </button>
            );
          })}
        </nav>
      </aside>

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
          <label className="customer-status-control short-name-control" title="Type this followed by a colon in Quick add, for example “sg: send report”.">
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
              {CUSTOMER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          </div>
        </header>

        <div className="queue-summary" aria-label="Task summary">
          <span><b>{openCount}</b> open</span>
          <span className={overdueCount > 0 ? 'summary-alert' : ''}><b>{overdueCount}</b> overdue</span>
          <span><b>{doneCount}</b> completed</span>
        </div>

        <form className="task-composer" onSubmit={submitTask}>
          <div className="composer-heading">
            <div>
              <h3>Log a task</h3>
              <p>Capture the next action with enough context to pick it up later.</p>
            </div>
          </div>
          <input
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
              <span>Use the task form above to record the next action.</span>
            </div>
          ) : orderedTasks.map((task) => (
            <TaskEntry key={task.id} task={task} onUpdate={onUpdateTask} onRemove={onRemoveTask} />
          ))}
        </div>
      </section>

      <aside className="context-rail" aria-label="Customer details">
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

        <button type="button" className="remove-customer" onClick={onArchiveCustomer}>Archive customer</button>
      </aside>
    </div>
  );
}

function TaskEntry({
  task,
  onUpdate,
  onRemove,
}: {
  task: Task;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [due, setDue] = useState(task.due ?? '');
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const overdue = !!task.due && task.due < today() && task.status !== 'done';
  const hasLongDescription = (task.description?.length ?? 0) > 180 || (task.description?.split('\n').length ?? 0) > 3;

  const save = () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    onUpdate(task.id, { title: cleanTitle, description: description.trim(), due: due || undefined });
    setEditing(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setEditing(false);
    }
  };

  return (
    <article className={`task-entry${overdue ? ' is-overdue' : ''}${task.status === 'done' ? ' is-complete' : ''}`}>
      <div className="task-date">
        {task.due ? (
          <>
            <strong>{formatDueLong(task.due)}</strong>
            <span>{overdue ? relativeDue(task.due) : task.status === 'done' ? 'Closed' : relativeDue(task.due)}</span>
          </>
        ) : (
          <><strong>No due date</strong><span>Unscheduled</span></>
        )}
      </div>
      <div className="task-content">
        {editing ? (
          <div className="task-editor">
            <input className="crm-field" aria-label="Task title" value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={onKeyDown} autoFocus />
            <textarea className="crm-field" aria-label="Task description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} onKeyDown={onKeyDown} placeholder="Add details and next steps" />
            <div className="editor-actions">
              <label className="date-control"><span>Due date</span><input className="crm-field" type="date" value={due} onChange={(event) => setDue(event.target.value)} /></label>
              <button type="button" className="crm-secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button type="button" className="crm-primary small-primary" onClick={save}>Save</button>
            </div>
          </div>
        ) : (
          <>
            <div className="task-title-line">
              <h4>{task.title}</h4>
              {task.priority === 'high' && <span className="priority-mark"><IconFlag width={13} height={13} /> High</span>}
            </div>
            <p className={`task-description${task.description ? '' : ' is-blank'}${hasLongDescription && !descriptionExpanded ? ' is-collapsed' : ''}`}>
              {task.description || 'No description yet. Add the details needed to move this forward.'}
            </p>
            {hasLongDescription && (
              <button
                type="button"
                className="task-expand"
                aria-expanded={descriptionExpanded}
                onClick={() => setDescriptionExpanded((expanded) => !expanded)}
              >
                {descriptionExpanded ? 'Read less' : 'Read more'}
              </button>
            )}
            <button type="button" className="task-edit-link" onClick={() => {
              setTitle(task.title);
              setDescription(task.description ?? '');
              setDue(task.due ?? '');
              setEditing(true);
            }}>Edit task</button>
          </>
        )}
      </div>
      <div className="task-controls">
        <label className="status-select-label">
          <span className="visually-hidden">Status for {task.title}</span>
          <select className={`task-status-select st-${task.status}`} value={task.status} onChange={(event) => onUpdate(task.id, { status: event.target.value as TaskStatus })}>
            {(['open', 'doing', 'done'] as TaskStatus[]).map((status) => <option value={status} key={status}>{STATUS_LABEL[status]}</option>)}
          </select>
        </label>
          <button
            type="button"
            className={`icon-key subtle-icon priority-toggle${task.priority === 'high' ? ' is-on' : ''}`}
            aria-label={`${task.priority === 'high' ? 'Remove high priority from' : 'Mark'} ${task.title}`}
            aria-pressed={task.priority === 'high'}
            onClick={() => onUpdate(task.id, { priority: task.priority === 'high' ? 'normal' : 'high' })}
          >
            <IconFlag width={15} height={15} />
          </button>
          <button type="button" className="icon-key subtle-icon" aria-label={`Delete ${task.title}`} onClick={() => onRemove(task.id)}>
          <IconTrash width={16} height={16} />
        </button>
      </div>
    </article>
  );
}