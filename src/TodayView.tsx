import { useMemo, useState } from 'react';
import { TaskEntry } from './TaskEntry';
import { formatDueLong } from './dates';
import { todayTasks } from './taskPlanning';
import { useToday } from './useToday';
import type { Customer, Task } from './types';

interface Props {
  customers: Customer[];
  tasks: Task[];
  onOpenCustomer: (id: string) => void;
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
  onRemoveTask: (id: string) => void;
}

/** Deadlines, planned work and follow-ups; finished work stays visible today. */
export function TodayView({ customers, tasks, onOpenCustomer, onUpdateTask, onRemoveTask }: Props) {
  const t0 = useToday();
  const [planning, setPlanning] = useState(false);
  const [query, setQuery] = useState('');
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const { overdue, dueToday, planned, waiting, doneToday, pending } = useMemo(
    () => todayTasks(customers, tasks, t0), [customers, tasks, t0],
  );
  const candidates = useMemo(() => {
    const shown = new Set(pending.map((task) => task.id));
    const q = query.trim().toLowerCase();
    return tasks.filter((task) => {
      const customer = customerById.get(task.customerId);
      return customer && customer.status !== 'archived' && task.status !== 'done' && !shown.has(task.id)
        && (!q || `${task.title} ${customer.name}`.toLowerCase().includes(q));
    }).sort((a, b) => a.title.localeCompare(b.title));
  }, [tasks, pending, customerById, query]);

  const customerCount = new Set(pending.map((t) => t.customerId)).size;
  const overdueCount = pending.filter((task) => task.due && task.due < t0).length;
  const clear = pending.length === 0;

  const section = (title: string, list: Task[], tone?: 'alert' | 'quiet') =>
    list.length > 0 && (
      <section className={`today-section${tone ? ` is-${tone}` : ''}`} aria-label={title}>
        <div className="task-queue-head">
          <h3>{title} <span className="today-count">{list.length}</span></h3>
        </div>
        <div className="task-list crm-task-list">
          {list.map((task) => (
            <TaskEntry
              key={task.id}
              task={task}
              customer={customerById.get(task.customerId)}
              onOpenCustomer={onOpenCustomer}
              onUpdate={onUpdateTask}
              onRemove={onRemoveTask}
            />
          ))}
        </div>
      </section>
    );

  return (
    <div className="today-view">
      <section className="crm-main today-main" aria-label="Today">
        <header className="record-head">
          <div className="record-title-block">
            <h2>Today</h2>
            <span className="record-meta">{formatDueLong(t0)} · all customers</span>
          </div>
          <button type="button" className="crm-secondary" aria-expanded={planning} aria-controls="today-planner" onClick={() => setPlanning((value) => !value)}>
            {planning ? 'Close planner' : 'Plan today'}
          </button>
        </header>

        {planning && (
          <section id="today-planner" className="today-planner" aria-label="Plan today">
            <h3>Add to your day</h3>
            <p>Choose work for today. Deadlines stay as they are; unfinished plans carry forward.</p>
            <input className="crm-field" type="search" aria-label="Find a task to plan" placeholder="Find a task or customer" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
            <ul className="today-plan-options">
              {candidates.map((task) => (
                <li key={task.id}>
                  <div><strong>{task.title}</strong><span>{customerById.get(task.customerId)?.name}{task.due ? ` · Due ${formatDueLong(task.due)}` : ' · No deadline'}</span></div>
                  <button type="button" className="crm-secondary" aria-label={`Plan for today: ${task.title}`} onClick={() => onUpdateTask(task.id, { plannedFor: t0 })}>Plan</button>
                </li>
              ))}
            </ul>
            {candidates.length === 0 && <p role="status">{query.trim() ? 'No matching tasks outside today’s list.' : 'No other open tasks to plan.'}</p>}
          </section>
        )}

        <div className="queue-summary" aria-label="Today summary">
          <span className={overdueCount > 0 ? 'summary-alert' : ''}><b>{overdueCount}</b> overdue</span>
          <span><b>{dueToday.length}</b> due today</span>
          <span><b>{planned.length}</b> planned</span>
          <span><b>{waiting.length}</b> waiting / follow-up</span>
          <span><b>{customerCount}</b> {customerCount === 1 ? 'customer' : 'customers'}</span>
          {doneToday.length > 0 && <span><b>{doneToday.length}</b> closed today</span>}
        </div>

        {clear && (
          <div className="queue-empty">
            <span className="empty-mark is-clear" aria-hidden="true">✓</span>
            <p>Nothing left for today.</p>
            <span>{doneToday.length > 0 ? 'Today’s work is closed. Plan another task when you’re ready.' : 'Plan a task for today. Deadlines and follow-ups appear here when they’re due.'}</span>
          </div>
        )}

        {section('Overdue', overdue, 'alert')}
        {section('Due today', dueToday)}
        {section('Planned work', planned)}
        {section('Waiting & follow-ups', waiting)}
        {section('Closed today', doneToday, 'quiet')}
      </section>
    </div>
  );
}
