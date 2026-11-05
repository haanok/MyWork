export type CustomerStatus = 'active' | 'waiting' | 'paused' | 'archived';
export type TaskStatus = 'open' | 'doing' | 'done';
export type Priority = 'normal' | 'high';

export interface Contact {
  id: string;
  name: string;
  detail: string;
}

export interface Customer {
  id: string;
  name: string;
  /** Optional short name, e.g. "sg", for typing "sg: …" in quick add. */
  shortName?: string;
  status: CustomerStatus;
  notes: string;
  contacts: Contact[];
  createdAt: string;
  touchedAt: string;
}

export interface Task {
  id: string;
  customerId: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  description?: string;
  /** YYYY-MM-DD, local date */
  due?: string;
  createdAt: string;
  updatedAt?: string;
  doneAt?: string;
}

export interface AppData {
  version: 1;
  customers: Customer[];
  tasks: Task[];
  legacy?: Record<string, unknown>;
  deletedTaskIds?: string[];
}

export const emptyData = (): AppData => ({ version: 1, customers: [], tasks: [], deletedTaskIds: [] });
