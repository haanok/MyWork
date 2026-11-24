import { toISODate } from './dates';
import type { Customer, Task } from './types';

const byPriorityThenTitle = (a: Task, b: Task) =>
  Number(b.priority === 'high') - Number(a.priority === 'high') || a.title.localeCompare(b.title);

/** A task belongs to exactly one section; planning never changes its deadline. */
export function todayTasks(customers: Customer[], tasks: Task[], day: string) {
  const live = new Set(customers.filter((c) => c.status !== 'archived').map((c) => c.id));
  const overdue: Task[] = [];
  const dueToday: Task[] = [];
  const planned: Task[] = [];
  const waiting: Task[] = [];
  const doneToday: Task[] = [];
  for (const task of tasks) {
    if (!live.has(task.customerId)) continue;
    if (task.status === 'done') {
      if (task.doneAt && toISODate(new Date(task.doneAt)) === day) doneToday.push(task);
      continue;
    }
    const due = !!task.due && task.due <= day;
    const plan = !!task.plannedFor && task.plannedFor <= day;
    if (task.status === 'waiting') {
      if (due || plan || (task.followUp && task.followUp <= day)) waiting.push(task);
    } else if (task.due && task.due < day) overdue.push(task);
    else if (task.due === day) dueToday.push(task);
    else if (plan) planned.push(task);
  }
  overdue.sort((a, b) => a.due!.localeCompare(b.due!) || byPriorityThenTitle(a, b));
  dueToday.sort(byPriorityThenTitle);
  planned.sort(byPriorityThenTitle);
  waiting.sort((a, b) => (a.followUp ?? a.due ?? '9').localeCompare(b.followUp ?? b.due ?? '9') || byPriorityThenTitle(a, b));
  doneToday.sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  const pending = [...overdue, ...dueToday, ...planned, ...waiting];
  return { overdue, dueToday, planned, waiting, doneToday, pending };
}
