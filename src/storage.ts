import { emptyData, type AppData } from './types';
import { adoptEtag, fetchData, loadData, saveData } from './api';

/** Swap this for an API-backed adapter later; the store only depends on this shape. */
export interface StorageAdapter {
  load(): Promise<AppData>;
  save(data: AppData): Promise<void>;
  /**
   * Optional: fetch the latest data when the tab regains focus, to pick up
   * changes made elsewhere (for example by Claude). Call commit() only if the
   * returned data is actually shown.
   */
  refresh?(): Promise<{ data: AppData; commit: () => void }>;
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

export const serverStorageAdapter: StorageAdapter = {
  load: loadData,
  save: saveData,
  async refresh() {
    const { data, etag } = await fetchData();
    return { data, commit: () => adoptEtag(etag) };
  },
};

export function parseImport(text: string): AppData {
  const parsed: unknown = JSON.parse(text);
  if (!isAppData(parsed)) throw new Error('This file is not a board export.');
  return parsed;
}
