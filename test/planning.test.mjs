import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Node 24+ strips TypeScript; resolve the app's extensionless source imports.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/src/') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { todayTasks } = await import('../src/taskPlanning.ts');
const { mergeBoards } = await import('../src/merge.ts');
const { toISODate } = await import('../src/dates.ts');

const day = '2026-11-17';
const customers = [{ id: 'a', name: 'Synthetic customer', status: 'active' }, { id: 'z', name: 'Archived', status: 'archived' }];
const task = (id, fields = {}) => ({ id, customerId: 'a', title: id, status: 'open', priority: 'normal', createdAt: `${day}T10:00:00Z`, ...fields });
const ids = (tasks) => tasks.map((t) => t.id);

test('Today separates deadlines, planned work and waiting without duplicates', () => {
  const tasks = [
    task('overdue', { due: '2026-11-16', plannedFor: day }),
    task('deadline', { due: day, plannedFor: day }),
    task('no-deadline', { plannedFor: day }),
    task('future-deadline', { plannedFor: day, due: '2026-12-01' }),
    task('follow-up', { status: 'waiting', waitingFor: 'Synthetic contact', followUp: day, due: day, plannedFor: day }),
    task('unplanned'), task('future-plan', { plannedFor: '2026-11-18' }),
    task('future-follow-up', { status: 'waiting', followUp: '2026-11-18' }),
    task('archived', { customerId: 'z', plannedFor: day }),
    task('orphan', { customerId: 'missing', due: day }),
  ];
  const original = structuredClone(tasks);
  const result = todayTasks(customers, tasks, day);
  assert.deepEqual(ids(result.overdue), ['overdue']);
  assert.deepEqual(ids(result.dueToday), ['deadline']);
  assert.deepEqual(ids(result.planned), ['future-deadline', 'no-deadline']);
  assert.deepEqual(ids(result.waiting), ['follow-up']);
  assert.equal(result.pending.length, 5);
  assert.equal(new Set(ids(result.pending)).size, 5);
  assert.deepEqual(tasks, original, 'grouping must never change deadlines or plans');
});

test('unfinished plans and follow-ups carry forward, with waiting deadlines still visible', () => {
  const result = todayTasks(customers, [
    task('old-plan', { plannedFor: '2026-11-10' }),
    task('old-follow-up', { status: 'waiting', followUp: '2026-11-10' }),
    task('waiting-deadline', { status: 'waiting', due: day, followUp: '2026-11-20' }),
    task('unblocked', { status: 'doing', followUp: day }),
  ], day);
  assert.deepEqual(ids(result.planned), ['old-plan']);
  assert.deepEqual(ids(result.waiting), ['old-follow-up', 'waiting-deadline']);
  assert.equal(result.pending.length, 3);
});

test('completed tasks without deadlines remain visible on their local completion day', () => {
  const completed = new Date(2026, 10, 17, 23, 30).toISOString();
  assert.equal(toISODate(new Date(completed)), day);
  const result = todayTasks(customers, [
    task('finished', { status: 'done', doneAt: completed }),
    task('future-deadline-finished', { status: 'done', due: '2026-12-01', doneAt: completed }),
    task('yesterday', { status: 'done', plannedFor: day, doneAt: new Date(2026, 10, 16, 12).toISOString() }),
  ], day);
  assert.deepEqual(ids(result.doneToday), ['finished', 'future-deadline-finished']);
  assert.equal(result.pending.length, 0);
});

test('concurrent browser and MCP edits preserve next steps, planning and waiting fields', () => {
  const base = { version: 1, customers: [customers[0]], tasks: [task('t', { due: '2026-12-01' })] };
  const local = structuredClone(base);
  local.customers[0].nextStep = 'Test remote access';
  local.tasks[0].plannedFor = day;
  const remote = structuredClone(base);
  remote.tasks[0] = { ...remote.tasks[0], status: 'waiting', waitingFor: 'Access from Synthetic contact', followUp: '2026-11-18' };
  const merged = mergeBoards(base, local, remote);
  assert.equal(merged.data.customers[0].nextStep, 'Test remote access');
  assert.deepEqual(merged.data.tasks[0], { ...remote.tasks[0], plannedFor: day });
  assert.deepEqual(merged.overlaps, []);
  const cleared = structuredClone(merged.data);
  delete cleared.tasks[0].plannedFor;
  delete cleared.customers[0].nextStep;
  const changedElsewhere = structuredClone(merged.data);
  changedElsewhere.tasks[0].title = 'Updated elsewhere';
  const next = mergeBoards(merged.data, cleared, changedElsewhere).data;
  assert.equal(next.tasks[0].plannedFor, undefined);
  assert.equal(next.customers[0].nextStep, undefined);
  assert.equal(next.tasks[0].title, 'Updated elsewhere');
  assert.equal(next.tasks[0].due, '2026-12-01');
});
