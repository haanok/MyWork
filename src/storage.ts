import { emptyData, type AppData } from './types';
import { loadData, saveData } from './api';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Customer, CustomerStatus, Task, TaskStatus } from './types';

/** Swap this for an API-backed adapter later; the store only depends on this shape. */
export interface StorageAdapter {
  load(): Promise<AppData>;
  save(data: AppData): Promise<void>;
}

const KEY = 'mywork-board:v1';

function isAppData(value: unknown): value is AppData {
  const v = value as AppData | null;
  return !!v && v.version === 1 && Array.isArray(v.customers) && Array.isArray(v.tasks);
}

export const localStorageAdapter: StorageAdapter = {
  async load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return emptyData();
      const parsed: unknown = JSON.parse(raw);
      return isAppData(parsed) ? parsed : emptyData();
    } catch {
      return emptyData();
    }
  },
  async save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  },
};

export const swaStorageAdapter: StorageAdapter = {
  load: loadData,
  save: saveData,
};

interface ParsedNote {
  metadata: Record<string, unknown>;
  body: string;
}

interface VaultIndex {
  root: string | null;
  files: Map<string, VaultMarkdownFile>;
  customerPaths: Map<string, string>;
  taskPaths: Map<string, string>;
  customerMetadata: Map<string, Record<string, unknown>>;
  taskMetadata: Map<string, Record<string, unknown>>;
  data: AppData;
}

const emptyIndex = (): VaultIndex => ({
  root: null,
  files: new Map(),
  customerPaths: new Map(),
  taskPaths: new Map(),
  customerMetadata: new Map(),
  taskMetadata: new Map(),
  data: emptyData(),
});

function parseNote(content: string): ParsedNote {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { metadata: {}, body: content.trim() };
  try {
    const parsed: unknown = parseYaml(match[1]);
    const metadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    return { metadata, body: content.slice(match[0].length).trim() };
  } catch {
    return { metadata: {}, body: content.trim() };
  }
}

function serializeNote(metadata: Record<string, unknown>, body: string) {
  const frontmatter = stringifyYaml(metadata).trimEnd();
  return `---\n${frontmatter}\n---\n${body.trim()}\n`;
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function stableId(seed: string, prefix: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function normalizeCustomerStatus(value: unknown): CustomerStatus {
  const status = text(value).toLowerCase();
  if (status === 'waiting' || status === 'paused' || status === 'archived') return status;
  return 'active';
}

function normalizeTaskStatus(value: unknown, body: string): TaskStatus {
  const status = text(value).toLowerCase().replaceAll('_', '-');
  if (['doing', 'in-progress', 'in progress', 'active'].includes(status)) return 'doing';
  if (['done', 'complete', 'completed', 'closed'].includes(status)) return 'done';
  if (['open', 'todo', 'to-do', 'pending'].includes(status)) return 'open';
  const taskBody = body.replace(/^#\s+.+\r?\n+/, '');
  const checkbox = taskBody.match(/^\s*-\s*\[([ xX])\]/);
  return checkbox?.[1].toLowerCase() === 'x' ? 'done' : 'open';
}

function normalizeDue(value: unknown, body: string) {
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : text(value);
  const due = raw || body.match(/(?:📅|due::?\s*)(\d{4}-\d{2}-\d{2})/i)?.[1] || '';
  return /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : undefined;
}

function normalizePriority(value: unknown, body: string): Task['priority'] {
  const priority = text(value).toLowerCase();
  return priority === 'high' || priority === 'urgent' || body.includes('⏫') ? 'high' : 'normal';
}

function noteDescription(body: string) {
  return body.replace(/^#\s+.+\r?\n+/, '').replace(/^\s*-\s*\[[ xX]\].*\r?\n?/, '').trim();
}

function customerNotes(body: string) {
  return body.replace(/^#\s+.+\r?\n+/, '').replace(/^##\s+Context\s*\r?\n+/i, '').trim();
}

function noteTitle(metadata: Record<string, unknown>, relativePath: string) {
  const title = text(metadata.title);
  if (title) return title;
  const fileName = relativePath.split('/').at(-1) ?? relativePath;
  return fileName.replace(/\.md$/i, '');
}

function normalizeContacts(value: unknown): Customer['contacts'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (typeof entry === 'string') {
      return [{ id: stableId(`${index}:${entry}`, 'contact'), name: entry, detail: '' }];
    }
    if (!entry || typeof entry !== 'object') return [];
    const contact = entry as Record<string, unknown>;
    const name = text(contact.name);
    const detail = text(contact.detail ?? contact.email ?? contact.role);
    return [{ id: text(contact.id) || stableId(`${index}:${name}:${detail}`, 'contact'), name, detail }];
  });
}

function cloneData(data: AppData): AppData {
  return JSON.parse(JSON.stringify(data)) as AppData;
}

function slug(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}

function notePath(folder: string, title: string, id: string) {
  return `${folder}/${slug(title)}-${id.slice(-6)}.md`;
}

function buildIndex(root: string | null, files: VaultMarkdownFile[]): VaultIndex {
  const index = emptyIndex();
  index.root = root;
  index.files = new Map(files.map((file) => [file.path, file]));

  const groups = new Map<string, VaultMarkdownFile[]>();
  for (const file of files) {
    const parts = file.path.split('/');
    if (parts.length < 2 || parts[0].startsWith('.')) continue;
    const group = groups.get(parts[0]) ?? [];
    group.push(file);
    groups.set(parts[0], group);
  }

  const customers: Customer[] = [];
  const tasks: Task[] = [];
  for (const [folder, group] of groups) {
    const customerFile = group.find((file) => {
      const parts = file.path.split('/');
      const base = parts.at(-1)?.toLowerCase();
      return parts.length === 2 && base === '_customer.md';
    });
    const customerNote = customerFile ? parseNote(customerFile.content) : { metadata: {}, body: '' };
    const customerId = text(customerNote.metadata.id) || stableId(folder, 'customer');
    const customer: Customer = {
      id: customerId,
      name: text(customerNote.metadata.title) || folder,
      status: normalizeCustomerStatus(customerNote.metadata.status),
      notes: customerNotes(customerNote.body),
      contacts: normalizeContacts(customerNote.metadata.contacts),
      createdAt: text(customerNote.metadata.createdAt) || customerFile?.modifiedAt || group[0].modifiedAt,
      touchedAt: text(customerNote.metadata.touchedAt) || customerFile?.modifiedAt || group[0].modifiedAt,
    };
    customers.push(customer);
    index.customerPaths.set(customer.id, folder);
    index.customerMetadata.set(customer.id, customerNote.metadata);
    if (customerFile) index.customerPaths.set(customer.id, folder);

    for (const file of group) {
      if (file === customerFile) continue;
      const parsed = parseNote(file.content);
      const taskId = text(parsed.metadata.id) || stableId(file.path, 'task');
      const status = normalizeTaskStatus(parsed.metadata.status, parsed.body);
      tasks.push({
        id: taskId,
        customerId,
        title: noteTitle(parsed.metadata, file.path),
        description: noteDescription(parsed.body) || undefined,
        status,
        priority: normalizePriority(parsed.metadata.priority, parsed.body),
        due: normalizeDue(parsed.metadata.due ?? parsed.metadata.dueDate, parsed.body),
        createdAt: text(parsed.metadata.createdAt) || file.modifiedAt,
        doneAt: status === 'done' ? text(parsed.metadata.doneAt) || file.modifiedAt : undefined,
      });
      index.taskPaths.set(taskId, file.path);
      index.taskMetadata.set(taskId, parsed.metadata);
    }
  }

  index.data = { version: 1, customers, tasks };
  return index;
}

export const obsidianStorageAdapter: StorageAdapter & {
  chooseCustomerRoot(): Promise<string | null>;
  getCustomerRoot(): Promise<string | null>;
  onVaultChanged(callback: () => void): () => void;
} = {
  async chooseCustomerRoot() {
    if (!window.customerBoard) return null;
    return window.customerBoard.chooseCustomerRoot();
  },
  async getCustomerRoot() {
    if (!window.customerBoard) return null;
    return window.customerBoard.getCustomerRoot();
  },
  onVaultChanged(callback) {
    return window.customerBoard?.onVaultChanged(callback) ?? (() => undefined);
  },
  async load() {
    if (!window.customerBoard) return emptyData();
    const root = await window.customerBoard.getCustomerRoot();
    if (!root) return emptyData();
    const files = await window.customerBoard.listMarkdown();
    const index = buildIndex(root, files);
    Object.assign(vaultIndex, index);
    return cloneData(index.data);
  },
  async save(data) {
    if (!window.customerBoard || !vaultIndex.root) return;
    const next = cloneData(data);
    const previousCustomers = new Map(vaultIndex.data.customers.map((customer) => [customer.id, customer]));
    const previousTasks = new Map(vaultIndex.data.tasks.map((task) => [task.id, task]));
    const nextTaskIds = new Set(next.tasks.map((task) => task.id));

    for (const customer of next.customers) {
      let folder = vaultIndex.customerPaths.get(customer.id);
      if (!folder) {
        const base = slug(customer.name);
        const taken = new Set([...vaultIndex.customerPaths.values()]);
        folder = taken.has(base) ? `${base}-${customer.id.slice(-6)}` : base;
        vaultIndex.customerPaths.set(customer.id, folder);
      }
      const previous = previousCustomers.get(customer.id);
      if (previous && JSON.stringify(previous) === JSON.stringify(customer)) continue;
      const relativePath = `${folder}/_customer.md`;
      const metadata = {
        ...(vaultIndex.customerMetadata.get(customer.id) ?? {}),
        id: customer.id,
        title: customer.name,
        status: customer.status,
        contacts: customer.contacts.map(({ id, name, detail }) => ({ id, name, detail })),
        createdAt: customer.createdAt,
        touchedAt: customer.touchedAt,
      };
      const body = customer.notes ? `## Context\n\n${customer.notes}` : '';
      await window.customerBoard.writeMarkdown(relativePath, serializeNote(metadata, body));
      vaultIndex.customerMetadata.set(customer.id, metadata);
    }

    for (const task of next.tasks) {
      const previous = previousTasks.get(task.id);
      if (previous && JSON.stringify(previous) === JSON.stringify(task)) continue;
      const folder = vaultIndex.customerPaths.get(task.customerId);
      if (!folder) continue;
      const relativePath = vaultIndex.taskPaths.get(task.id) ?? notePath(folder, task.title, task.id);
      const metadata = {
        ...(vaultIndex.taskMetadata.get(task.id) ?? {}),
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        due: task.due,
        createdAt: task.createdAt,
        doneAt: task.doneAt,
      };
      const checkbox = task.status === 'done' ? 'x' : ' ';
      const dueMarker = task.due ? ` 📅 ${task.due}` : '';
      const body = `# ${task.title}\n\n- [${checkbox}] ${task.title}${dueMarker}${task.description ? `\n\n${task.description}` : ''}`;
      await window.customerBoard.writeMarkdown(relativePath, serializeNote(metadata, body));
      vaultIndex.taskPaths.set(task.id, relativePath);
      vaultIndex.taskMetadata.set(task.id, metadata);
    }

    for (const [id, relativePath] of vaultIndex.taskPaths) {
      if (previousTasks.has(id) && !nextTaskIds.has(id)) {
        await window.customerBoard.trashMarkdown(relativePath);
        vaultIndex.taskPaths.delete(id);
        vaultIndex.taskMetadata.delete(id);
      }
    }

    const root = await window.customerBoard.getCustomerRoot();
    Object.assign(vaultIndex, buildIndex(root, await window.customerBoard.listMarkdown()));
  },
};

const vaultIndex = emptyIndex();

export function parseImport(text: string): AppData {
  const parsed: unknown = JSON.parse(text);
  if (!isAppData(parsed)) throw new Error('This file is not a board export.');
  return parsed;
}
