import { parse as parseYaml } from 'yaml';
import type { AppData, Contact, Customer, CustomerStatus, Priority, Task, TaskStatus } from './types';

export interface ImportedNote {
  path: string;
  content: string;
  modifiedAt: string;
}

interface NoteParts {
  metadata: Record<string, unknown>;
  body: string;
}

export interface MarkdownImportPreview {
  data: AppData;
  importedCustomerIds: string[];
  importedTaskIds: string[];
  addedCustomers: number;
  updatedCustomers: number;
  addedTasks: number;
  updatedTasks: number;
}

export interface MarkdownMergeOptions {
  preferNewer?: boolean;
  respectDeletedTasks?: boolean;
  conflictResolution?: 'latest' | 'obsidian' | 'mywork';
}

function splitNote(content: string): NoteParts {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { metadata: {}, body: content.trim() };
  try {
    const parsed: unknown = parseYaml(match[1]);
    const metadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    return { metadata, body: content.slice(match[0].length).trim() };
  } catch {
    throw new Error(`Invalid YAML frontmatter in ${match[1].slice(0, 40)}.`);
  }
}

function valueText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function stableId(seed: string, prefix: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function customerStatus(value: unknown): CustomerStatus {
  const status = valueText(value).toLowerCase();
  return status === 'waiting' || status === 'paused' || status === 'archived' ? status : 'active';
}

function taskStatus(value: unknown, body: string): TaskStatus {
  const status = valueText(value).toLowerCase().replaceAll('_', '-');
  if (['doing', 'in-progress', 'in progress', 'active'].includes(status)) return 'doing';
  if (['done', 'complete', 'completed', 'closed'].includes(status)) return 'done';
  if (['open', 'todo', 'to-do', 'pending'].includes(status)) return 'open';
  const taskBody = body.replace(/^#\s+.+\r?\n+/, '');
  return taskBody.match(/^\s*-\s*\[[xX]\]/) ? 'done' : 'open';
}

function taskPriority(value: unknown, body: string): Priority {
  const priority = valueText(value).toLowerCase();
  return priority === 'high' || priority === 'urgent' || body.includes('⏫') ? 'high' : 'normal';
}

function dueDate(value: unknown, body: string) {
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : valueText(value);
  const date = raw || body.match(/(?:📅|due::?\s*)(\d{4}-\d{2}-\d{2})/i)?.[1] || '';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function contacts(value: unknown): Contact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item === 'string') return [{ id: stableId(`${index}:${item}`, 'contact'), name: item, detail: '' }];
    if (!item || typeof item !== 'object') return [];
    const contact = item as Record<string, unknown>;
    const name = valueText(contact.name);
    const detail = valueText(contact.detail ?? contact.email ?? contact.role);
    return [{ id: valueText(contact.id) || stableId(`${index}:${name}:${detail}`, 'contact'), name, detail }];
  });
}

function customerBody(body: string) {
  return body.replace(/^#\s+.+\r?\n+/, '').replace(/^##\s+Context\s*\r?\n+/i, '').trim();
}

function taskBody(body: string) {
  return body
    .replace(/^#\s+.+\r?\n+/, '')
    .replace(/^\s*-\s*\[[ xX]\].*\r?\n?/, '')
    .trim();
}

function fileTitle(path: string, metadata: Record<string, unknown>) {
  const title = valueText(metadata.title);
  if (title) return title;
  return path.split('/').at(-1)?.replace(/\.md$/i, '') ?? path;
}

async function normalizeFiles(files: File[]): Promise<ImportedNote[]> {
  const markdown = files.filter((file) => file.name.toLowerCase().endsWith('.md'));
  if (markdown.length === 0) throw new Error('No Markdown files found. Choose the Obsidian folder that contains customer folders.');

  const paths = markdown.map((file) => {
    const filePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (!filePath) throw new Error('Choose a folder, not individual files, so customer folders can be identified.');
    return filePath.split('/').filter(Boolean);
  });
  if (paths.some((parts) => parts[0] !== paths[0][0])) {
    throw new Error('Choose one Obsidian folder at a time.');
  }

  return await Promise.all(markdown.map(async (file, index) => {
    const parts = paths[index];
    return {
      path: parts.slice(1).join('/'),
      content: await file.text(),
      modifiedAt: new Date(file.lastModified).toISOString(),
    };
  }));
}

export async function prepareMarkdownImport(files: File[], current: AppData): Promise<MarkdownImportPreview> {
  const notes = await normalizeFiles(files);
  return mergeMarkdownNotes(notes, current);
}

export function mergeMarkdownNotes(
  notes: ImportedNote[],
  current: AppData,
  options: MarkdownMergeOptions = {},
): MarkdownImportPreview {
  const groups = new Map<string, ImportedNote[]>();

  for (const note of notes) {
    const parts = note.path.split('/');
    if (parts.length < 2 || parts.some((part) => part.startsWith('.'))) continue;
    if (parts.at(-1)?.toLowerCase() === '_customer.md' && parts.length !== 2) continue;
    const group = groups.get(parts[0]) ?? [];
    group.push(note);
    groups.set(parts[0], group);
  }

  if (groups.size === 0) throw new Error('No customer folders found. Choose the parent folder whose subfolders are customers.');

  const importedCustomers: Customer[] = [];
  const importedTasks: Task[] = [];
  const customerHasNote = new Set<string>();

  for (const [folder, group] of groups) {
    const customerFile = group.find((note) => note.path.toLowerCase() === `${folder.toLowerCase()}/_customer.md`);
    const parsedCustomer = customerFile ? splitNote(customerFile.content) : { metadata: {}, body: '' };
    const customerId = valueText(parsedCustomer.metadata.id) || stableId(folder, 'customer');
    if (customerFile) customerHasNote.add(customerId);

    importedCustomers.push({
      id: customerId,
      name: valueText(parsedCustomer.metadata.title) || folder,
      status: customerStatus(parsedCustomer.metadata.status),
      notes: customerBody(parsedCustomer.body),
      contacts: contacts(parsedCustomer.metadata.contacts),
      createdAt: valueText(parsedCustomer.metadata.createdAt) || customerFile?.modifiedAt || group[0].modifiedAt,
      touchedAt: valueText(parsedCustomer.metadata.touchedAt) || customerFile?.modifiedAt || group[0].modifiedAt,
    });

    for (const note of group) {
      if (note === customerFile) continue;
      const parts = splitNote(note.content);
      const id = valueText(parts.metadata.id) || stableId(note.path, 'task');
      const status = taskStatus(parts.metadata.status, parts.body);
      importedTasks.push({
        id,
        customerId,
        title: fileTitle(note.path, parts.metadata),
        description: taskBody(parts.body) || undefined,
        status,
        priority: taskPriority(parts.metadata.priority, parts.body),
        due: dueDate(parts.metadata.due ?? parts.metadata.dueDate, parts.body),
        createdAt: valueText(parts.metadata.createdAt) || note.modifiedAt,
        updatedAt: valueText(parts.metadata.updatedAt) || note.modifiedAt,
        doneAt: status === 'done' ? valueText(parts.metadata.doneAt) || note.modifiedAt : undefined,
      });
    }
  }

  const customers = new Map(current.customers.map((customer) => [customer.id, customer]));
  const tasks = new Map(current.tasks.map((task) => [task.id, task]));
  const deletedTaskIds = new Set(current.deletedTaskIds ?? []);
  let addedCustomers = 0;
  let updatedCustomers = 0;
  let addedTasks = 0;
  let updatedTasks = 0;

  for (const imported of importedCustomers) {
    const existing = customers.get(imported.id);
    if (!existing) {
      customers.set(imported.id, imported);
      addedCustomers += 1;
    } else {
      if (options.conflictResolution === 'mywork') continue;
      if ((options.conflictResolution === 'latest' || options.preferNewer)
        && Date.parse(imported.touchedAt) <= Date.parse(existing.touchedAt)) continue;
      customers.set(imported.id, customerHasNote.has(imported.id)
        ? { ...existing, ...imported }
        : { ...existing, name: imported.name });
      updatedCustomers += 1;
    }
  }

  for (const imported of importedTasks) {
    if (options.respectDeletedTasks
      && deletedTaskIds.has(imported.id)
      && options.conflictResolution !== 'obsidian') continue;
    if (!options.respectDeletedTasks || options.conflictResolution === 'obsidian') deletedTaskIds.delete(imported.id);
    const existing = tasks.get(imported.id);
    if (existing && options.conflictResolution === 'mywork') continue;
    if (existing && (options.conflictResolution === 'latest' || options.preferNewer)) {
      const localUpdated = Date.parse(imported.updatedAt ?? imported.createdAt);
      const cloudUpdated = Date.parse(existing.updatedAt ?? existing.doneAt ?? existing.createdAt);
      if (localUpdated <= cloudUpdated) continue;
    }
    tasks.set(imported.id, existing ? { ...existing, ...imported } : imported);
    if (existing) updatedTasks += 1;
    else addedTasks += 1;
  }

  return {
    data: {
      ...current,
      version: 1,
      customers: [...customers.values()],
      tasks: [...tasks.values()],
      deletedTaskIds: [...deletedTaskIds],
    },
    importedCustomerIds: importedCustomers.map((customer) => customer.id),
    importedTaskIds: importedTasks.map((task) => task.id),
    addedCustomers,
    updatedCustomers,
    addedTasks,
    updatedTasks,
  };
}
