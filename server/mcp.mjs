// Remote MCP endpoint (/mcp) for MyWork. Stateless Streamable HTTP: each
// request gets a fresh McpServer bound to the authenticated user. Tools read
// and change the same per-user data.json as /api/data, and the mutations
// mirror the reducer in src/store.ts (touchedAt, updatedAt, doneAt,
// deletedTaskIds) so the web app sees the same shape it writes itself.
import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const CUSTOMER_STATUSES = ['active', 'waiting', 'paused', 'archived'];
const TASK_STATUSES = ['open', 'doing', 'done'];
const PRIORITIES = ['normal', 'high'];
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

class ToolError extends Error {}

function parseDocument(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.customers)) {
    throw new ToolError('Stored data has an unexpected shape; refusing to change it.');
  }
  if (!Array.isArray(data.tasks)) data.tasks = [];
  return data;
}

function resolveCustomer(data, ref) {
  const needle = ref.trim().toLowerCase();
  const byId = data.customers.find((c) => c.id === ref.trim());
  if (byId) return byId;
  const exact = data.customers.filter((c) => (c.name ?? '').trim().toLowerCase() === needle);
  if (exact.length === 1) return exact[0];
  const partial = exact.length > 1
    ? exact
    : data.customers.filter((c) => (c.name ?? '').toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0];
  if (partial.length === 0) throw new ToolError(`No customer matches "${ref}". Use list_customers to see names.`);
  const names = partial.slice(0, 10).map((c) => `${c.name} (${c.id})`).join(', ');
  throw new ToolError(`"${ref}" matches several customers: ${names}. Use the id.`);
}

function findTask(data, id) {
  const task = data.tasks.find((t) => t.id === id);
  if (!task) throw new ToolError(`No task with id ${id}.`);
  return task;
}

function touch(data, customerId, stamp) {
  const customer = data.customers.find((c) => c.id === customerId);
  if (customer) customer.touchedAt = stamp;
}

const customerName = (data, id) => data.customers.find((c) => c.id === id)?.name ?? '(unknown customer)';

function taskView(data, task) {
  return {
    id: task.id,
    customer: customerName(data, task.customerId),
    customerId: task.customerId,
    title: task.title,
    status: task.status,
    priority: task.priority,
    ...(task.due ? { due: task.due } : {}),
    ...(task.description ? { description: task.description } : {}),
    ...(task.doneAt ? { doneAt: task.doneAt } : {}),
  };
}

function customerSummary(data, customer) {
  const today = new Date().toISOString().slice(0, 10);
  const open = data.tasks.filter((t) => t.customerId === customer.id && t.status !== 'done');
  return {
    id: customer.id,
    name: customer.name,
    status: customer.status,
    openTasks: open.length,
    overdueTasks: open.filter((t) => t.due && t.due < today).length,
    touchedAt: customer.touchedAt,
  };
}

const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

function buildServer(sub, storage) {
  const server = new McpServer(
    { name: 'mywork', version: '0.1.0' },
    {
      instructions:
        'MyWork is a single consultant\'s customer workspace: customers with notes, contacts and a status, '
        + 'and tasks per customer. Refer to customers by name or id. Dates are YYYY-MM-DD.',
    },
  );

  const load = async () => parseDocument((await storage.read(sub)).text);

  // Wraps a read-only tool body.
  const reader = (fn) => async (args) => {
    try {
      return ok(fn(await load(), args));
    } catch (error) {
      if (error instanceof ToolError) return fail(error.message);
      throw error;
    }
  };

  // Wraps a tool body that changes the document: read, mutate, write under
  // the user's lock so it cannot interleave with a save from the web app.
  const writer = (fn) => async (args) => {
    try {
      const result = await storage.withLock(sub, async () => {
        const data = await load();
        const value = fn(data, args, new Date().toISOString());
        await storage.write(sub, JSON.stringify(data));
        return value;
      });
      return ok(result);
    } catch (error) {
      if (error instanceof ToolError) return fail(error.message);
      throw error;
    }
  };

  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const additive = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  server.registerTool('list_customers', {
    title: 'List customers',
    description: 'List customers with status and open/overdue task counts. Archived customers are hidden unless status is given.',
    inputSchema: { status: z.enum(CUSTOMER_STATUSES).optional() },
    annotations: readOnly,
  }, reader((data, { status }) => data.customers
    .filter((c) => (status ? c.status === status : c.status !== 'archived'))
    .map((c) => customerSummary(data, c))));

  server.registerTool('get_customer', {
    title: 'Get customer',
    description: 'Full details for one customer: notes, contacts and tasks (open first).',
    inputSchema: { customer: z.string().min(1).describe('Customer name or id') },
    annotations: readOnly,
  }, reader((data, { customer }) => {
    const c = resolveCustomer(data, customer);
    const rank = { doing: 0, open: 1, done: 2 };
    const tasks = data.tasks
      .filter((t) => t.customerId === c.id)
      .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || (a.due ?? '9').localeCompare(b.due ?? '9'))
      .map((t) => taskView(data, t));
    return { ...customerSummary(data, c), notes: c.notes ?? '', contacts: c.contacts ?? [], createdAt: c.createdAt, tasks };
  }));

  server.registerTool('list_tasks', {
    title: 'List tasks',
    description: 'List tasks, optionally filtered. By default only tasks that are not done.',
    inputSchema: {
      customer: z.string().optional().describe('Customer name or id'),
      status: z.enum([...TASK_STATUSES, 'not_done', 'all']).optional().describe('Default not_done'),
      priority: z.enum(PRIORITIES).optional(),
      due_before: DATE.optional().describe('Only tasks due on or before this date'),
    },
    annotations: readOnly,
  }, reader((data, { customer, status = 'not_done', priority, due_before: dueBefore }) => {
    const customerId = customer ? resolveCustomer(data, customer).id : null;
    return data.tasks
      .filter((t) => !customerId || t.customerId === customerId)
      .filter((t) => status === 'all' || (status === 'not_done' ? t.status !== 'done' : t.status === status))
      .filter((t) => !priority || t.priority === priority)
      .filter((t) => !dueBefore || (t.due && t.due <= dueBefore))
      .sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'))
      .map((t) => taskView(data, t));
  }));

  server.registerTool('search', {
    title: 'Search',
    description: 'Case-insensitive text search across customer names, notes, contacts, and task titles and descriptions.',
    inputSchema: { query: z.string().min(1) },
    annotations: readOnly,
  }, reader((data, { query }) => {
    const q = query.toLowerCase();
    const has = (value) => typeof value === 'string' && value.toLowerCase().includes(q);
    return {
      customers: data.customers
        .filter((c) => has(c.name) || has(c.notes) || (c.contacts ?? []).some((k) => has(k.name) || has(k.detail)))
        .map((c) => customerSummary(data, c)),
      tasks: data.tasks.filter((t) => has(t.title) || has(t.description)).map((t) => taskView(data, t)),
    };
  }));

  server.registerTool('add_customer', {
    title: 'Add customer',
    description: 'Create a new customer.',
    inputSchema: {
      name: z.string().trim().min(1),
      status: z.enum(CUSTOMER_STATUSES).optional(),
      notes: z.string().optional(),
    },
    annotations: additive,
  }, writer((data, { name, status = 'active', notes = '' }, stamp) => {
    const customer = {
      id: crypto.randomUUID(), name, status, notes, contacts: [], createdAt: stamp, touchedAt: stamp,
    };
    data.customers.push(customer);
    return customerSummary(data, customer);
  }));

  server.registerTool('update_customer', {
    title: 'Update customer',
    description: 'Rename a customer, change its status, or replace its notes entirely. To add to the notes, use append_note.',
    inputSchema: {
      customer: z.string().min(1).describe('Customer name or id'),
      name: z.string().trim().min(1).optional(),
      status: z.enum(CUSTOMER_STATUSES).optional(),
      notes: z.string().optional().describe('Replaces all existing notes'),
    },
    annotations: { ...additive, destructiveHint: true },
  }, writer((data, { customer, name, status, notes }, stamp) => {
    const c = resolveCustomer(data, customer);
    if (name !== undefined) c.name = name;
    if (status !== undefined) c.status = status;
    if (notes !== undefined) c.notes = notes;
    c.touchedAt = stamp;
    return customerSummary(data, c);
  }));

  server.registerTool('append_note', {
    title: 'Append note',
    description: 'Add a dated paragraph to the end of a customer\'s working notes.',
    inputSchema: {
      customer: z.string().min(1).describe('Customer name or id'),
      text: z.string().trim().min(1),
    },
    annotations: additive,
  }, writer((data, { customer, text }, stamp) => {
    const c = resolveCustomer(data, customer);
    const entry = `${stamp.slice(0, 10)}: ${text}`;
    c.notes = c.notes?.trim() ? `${c.notes.replace(/\s+$/, '')}\n\n${entry}` : entry;
    c.touchedAt = stamp;
    return { customer: c.name, appended: entry };
  }));

  server.registerTool('add_contact', {
    title: 'Add contact',
    description: 'Add a contact person to a customer.',
    inputSchema: {
      customer: z.string().min(1).describe('Customer name or id'),
      name: z.string().trim().min(1),
      detail: z.string().optional().describe('Role, email, phone and so on'),
    },
    annotations: additive,
  }, writer((data, { customer, name, detail = '' }, stamp) => {
    const c = resolveCustomer(data, customer);
    const contact = { id: crypto.randomUUID(), name, detail };
    c.contacts = [...(c.contacts ?? []), contact];
    c.touchedAt = stamp;
    return { customer: c.name, contact };
  }));

  server.registerTool('add_task', {
    title: 'Add task',
    description: 'Add a task to a customer\'s ledger.',
    inputSchema: {
      customer: z.string().min(1).describe('Customer name or id'),
      title: z.string().trim().min(1),
      description: z.string().optional(),
      due: DATE.optional(),
      priority: z.enum(PRIORITIES).optional(),
    },
    annotations: additive,
  }, writer((data, { customer, title, description, due, priority = 'normal' }, stamp) => {
    const c = resolveCustomer(data, customer);
    const task = {
      id: crypto.randomUUID(),
      customerId: c.id,
      title,
      ...(description ? { description } : {}),
      status: 'open',
      priority,
      ...(due ? { due } : {}),
      createdAt: stamp,
      updatedAt: stamp,
    };
    data.tasks.push(task);
    touch(data, c.id, stamp);
    return taskView(data, task);
  }));

  server.registerTool('update_task', {
    title: 'Update task',
    description: 'Change a task: title, status (open, doing, done), due date, priority or description. Pass an empty string to clear due or description.',
    inputSchema: {
      task_id: z.string().min(1),
      title: z.string().trim().min(1).optional(),
      status: z.enum(TASK_STATUSES).optional(),
      due: z.union([DATE, z.literal('')]).optional(),
      priority: z.enum(PRIORITIES).optional(),
      description: z.string().optional(),
    },
    annotations: additive,
  }, writer((data, { task_id: id, title, status, due, priority, description }, stamp) => {
    const task = findTask(data, id);
    if (title !== undefined) task.title = title;
    if (priority !== undefined) task.priority = priority;
    if (due !== undefined) { if (due) task.due = due; else delete task.due; }
    if (description !== undefined) { if (description) task.description = description; else delete task.description; }
    if (status !== undefined) {
      task.status = status;
      if (status === 'done') task.doneAt = stamp; else delete task.doneAt;
    }
    task.updatedAt = stamp;
    touch(data, task.customerId, stamp);
    return taskView(data, task);
  }));

  server.registerTool('delete_task', {
    title: 'Delete task',
    description: 'Permanently remove a task. Prefer update_task with status done for finished work.',
    inputSchema: { task_id: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, writer((data, { task_id: id }) => {
    const task = findTask(data, id);
    data.tasks = data.tasks.filter((t) => t.id !== id);
    data.deletedTaskIds = [...new Set([...(data.deletedTaskIds ?? []), id])];
    return { deleted: taskView(data, task) };
  }));

  return server;
}

// Handles one HTTP request to /mcp for an already authenticated user.
export async function handleMcp(req, res, { sub, storage, readBody }) {
  if (req.method !== 'POST') {
    // Stateless server: no standalone SSE stream and no sessions to delete.
    res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed.');
    return;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req)).toString('utf8'));
  } catch (error) {
    if (error?.status) throw error;
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
    return;
  }

  const server = buildServer(sub, storage);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
