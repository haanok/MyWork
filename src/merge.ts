import type { AppData, Customer, Task } from './types';

/**
 * Three-way merge of the board, used when a save is refused because the data
 * changed elsewhere (another tab, or Claude via MCP).
 *
 * base   = the version this tab last loaded or saved
 * local  = what this tab has now (base + the user's unsaved edits)
 * remote = what the server has now (base + the other edits)
 *
 * Customers and tasks are merged by id, and field by field when both sides
 * changed the same record. When both changed the same field, the local value
 * wins, since it is what the user is looking at.
 */
export interface MergeResult {
  data: AppData;
  /** Names of records where both sides changed the same field. */
  overlaps: string[];
}

type Entity = Customer | Task;

/** JSON with sorted keys and without undefined fields, for comparisons. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
  }) ?? 'undefined';
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

function mergeRecord<T extends Entity>(base: T, local: T, remote: T): { value: T; overlap: boolean } {
  const merged: Record<string, unknown> = {};
  let overlap = false;
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    const b = (base as unknown as Record<string, unknown>)[key];
    const l = (local as unknown as Record<string, unknown>)[key];
    const r = (remote as unknown as Record<string, unknown>)[key];
    let value: unknown;
    if (same(l, b)) value = r;
    else {
      value = l;
      if (!same(r, b) && !same(r, l)) overlap = true;
    }
    if (value !== undefined) merged[key] = value;
  }
  return { value: merged as unknown as T, overlap };
}

function mergeList<T extends Entity>(base: T[], local: T[], remote: T[], label: (item: T) => string) {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  // Remote order first, then records only this tab knows about.
  const ids = [...new Set([...remote.map((item) => item.id), ...local.map((item) => item.id)])];
  const result: T[] = [];
  const overlaps: string[] = [];

  for (const id of ids) {
    const b = baseById.get(id);
    const l = localById.get(id);
    const r = remoteById.get(id);
    let value: T | undefined;
    if (same(l, b)) value = r; // untouched here: take theirs (including a deletion)
    else if (same(r, b)) value = l; // untouched there: take ours (including a deletion)
    else if (!l || !r) value = l ?? r; // deleted on one side, edited on the other: keep the edit
    else if (!b) value = l; // same id added on both sides (should not happen)
    else {
      const merged = mergeRecord(b, l, r);
      value = merged.value;
      if (merged.overlap) overlaps.push(label(value));
    }
    if (value) result.push(value);
  }
  return { items: result, overlaps };
}

export function mergeBoards(base: AppData, local: AppData, remote: AppData): MergeResult {
  const customers = mergeList(base.customers, local.customers, remote.customers, (c) => c.name);
  const tasks = mergeList(base.tasks, local.tasks, remote.tasks, (t) => t.title);
  const customerIds = new Set(customers.items.map((c) => c.id));
  // A task whose customer is gone has nowhere to show.
  const keptTasks = tasks.items.filter((task) => customerIds.has(task.customerId));
  const keptTaskIds = new Set(keptTasks.map((task) => task.id));
  const deletedTaskIds = [...new Set([
    ...(remote.deletedTaskIds ?? []),
    ...(local.deletedTaskIds ?? []),
  ])].filter((id) => !keptTaskIds.has(id));

  return {
    data: {
      ...remote,
      customers: customers.items,
      tasks: keptTasks,
      deletedTaskIds,
    },
    overlaps: [...customers.overlaps, ...tasks.overlaps],
  };
}
