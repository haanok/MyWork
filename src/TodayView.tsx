import { useMemo } from 'react';
import { TaskEntry } from './CustomerWorkspace';
import { formatDueLong, toISODate, today } from './dates';
import type { Customer, Task } from './types';

interface Props {
  customers: Customer[];
  tasks: Task[];
  onOpenCustomer: (id: string) => void;
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
  onRemoveTask: (id: string) => void;
}

const byPriorityThenTitle = (a: Task, b: Task) =>
  (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1) || a.title.localeCompare(b.title);

/**
 * Overdue and due-today tasks across every customer that is not archived.
 * Tasks closed today stay listed at the bottom, so ticking one off does not
 * make it vanish from under the pointer.
 */
export function TodayView({ customers, tasks, onOpenCustomer, onUpdateTask, onRemoveTask }: Props) {
  const t0 = today();
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const { overdue, dueToday, doneToday } = useMemo(() => {
    const overdue: Task[] = [];
    const dueToday: Task[] = [];
    const doneToday: Task[] = [];
    for (const task of tasks) {
      const customer = customerById.get(task.customerId);
      if (!customer || customer.status === 'archived' || !task.due || task.due > t0) continue;
      if (task.status === 'done') {
        if (task.doneAt && toISODate(new Date(task.doneAt)) === t0) doneToday.push(task);
      } else if (task.due < t0) {
        overdue.push(task);
      } else {
        dueToday.push(task);
      }
    }
    overdue.sort((a, b) => a.due!.localeCompare(b.due!) || byPriorityThenTitle(a, b));
    dueToday.sort(byPriorityThenTitle);
    doneToday.sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
    return { overdue, dueToday, doneToday };
  }, [tasks, customerById, t0]);

  const customerCount = new Set([...overdue, ...dueToday].map((t) => t.customerId)).size;
  const clear = overdue.length === 0 && dueToday.length === 0;

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
        </header>

        <div className="queue-summary" aria-label="Today summary">
          <span className={overdue.length > 0 ? 'summary-alert' : ''}><b>{overdue.length}</b> overdue</span>
          <span><b>{dueToday.length}</b> due today</span>
          <span><b>{customerCount}</b> {customerCount === 1 ? 'customer' : 'customers'}</span>
          {doneToday.length > 0 && <span><b>{doneToday.length}</b> closed today</span>}
        </div>

        {clear && (
          <div className="queue-empty">
            <span className="empty-mark is-clear" aria-hidden="true">✓</span>
            <p>Nothing overdue or due today.</p>
            <span>{doneToday.length > 0 ? 'Everything due is closed. Nice work.' : 'Tasks with a due date of today or earlier show up here.'}</span>
          </div>
        )}

        {section('Overdue', overdue, 'alert')}
        {section('Due today', dueToday)}
        {section('Closed today', doneToday, 'quiet')}
      </section>
    </div>
  );
}
