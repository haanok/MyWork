import { emptyData, type AppData } from './types';

const DATA_URL = '/api/data';
const LOGIN_URL = '/.auth/login/aad';

/** Thrown when the server refuses a save because the data changed elsewhere (HTTP 412). */
export class DataConflictError extends Error {
  constructor() {
    super('The data was changed elsewhere.');
    this.name = 'DataConflictError';
  }
}

// ETag of the version this tab last loaded or saved. The self-hosted server
// sends one; Azure Static Web Apps does not, and then saves stay unconditional.
let currentEtag: string | null = null;

function normalizeData(value: unknown): AppData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The SWA API returned invalid customer data.');
  }

  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 0) return emptyData();
  if (!Array.isArray(record.customers)) {
    const fields = Object.keys(record);
    if (fields.length > 0 && fields.every((field) => field === 'test' || field === 'tid')) {
      return { ...emptyData(), legacy: record };
    }
    const fieldList = fields.slice(0, 8).join(', ') || '(none)';
    throw new Error(`SWA data has an unexpected shape (fields: ${fieldList}); expected a customers array. No changes were saved.`);
  }

  return {
    version: 1,
    customers: record.customers as AppData['customers'],
    tasks: Array.isArray(record.tasks) ? record.tasks as AppData['tasks'] : [],
    deletedTaskIds: Array.isArray(record.deletedTaskIds)
      ? record.deletedTaskIds.filter((id): id is string => typeof id === 'string')
      : [],
    ...(record.legacy && typeof record.legacy === 'object' && !Array.isArray(record.legacy)
      ? { legacy: record.legacy as Record<string, unknown> }
      : {}),
  };
}

async function requestData(init?: RequestInit) {
  const response = await fetch(DATA_URL, {
    credentials: 'same-origin',
    ...init,
  });

  if (response.status === 401 || response.redirected) {
    window.location.assign(LOGIN_URL);
    throw new Error('Your SWA session has expired. Redirecting to sign in.');
  }

  if (response.status === 412) {
    throw new DataConflictError();
  }

  if (!response.ok) {
    throw new Error(`SWA data request failed (${response.status}).`);
  }

  return response;
}

/** Fetches the stored data and its ETag without adopting the ETag for later saves. */
export async function fetchData(): Promise<{ data: AppData; etag: string | null }> {
  const response = await requestData();
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('The SWA route did not return JSON. Confirm that /api/data is linked to the Function App.');
  }
  return { data: normalizeData(await response.json()), etag: response.headers.get('etag') };
}

/** Makes later saves conditional on this version (call once the data is shown). */
export function adoptEtag(etag: string | null) {
  currentEtag = etag;
}

export async function loadData(): Promise<AppData> {
  const { data, etag } = await fetchData();
  adoptEtag(etag);
  return data;
}

export async function saveData(data: AppData): Promise<void> {
  const response = await requestData({
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(currentEtag ? { 'If-Match': currentEtag } : {}),
    },
    body: JSON.stringify(data),
  });
  currentEtag = response.headers.get('etag');
}
export type McpInfo = { enabled: false } | { enabled: true; url: string; clientId: string; issuer: string };

/** Asks the self-hosted server whether the remote MCP endpoint is on. Resolves to null when it cannot tell. */
export async function fetchMcpInfo(): Promise<McpInfo | null> {
  try {
    const response = await fetch('/api/mcp', { credentials: 'same-origin' });
    if (!response.ok || response.redirected) return null;
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) return null;
    return await response.json() as McpInfo;
  } catch {
    return null;
  }
}
