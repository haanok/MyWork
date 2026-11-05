import { emptyData, type AppData } from './types';

const DATA_URL = '/api/data';
const LOGIN_URL = '/.auth/login/aad';

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

  if (!response.ok) {
    throw new Error(`SWA data request failed (${response.status}).`);
  }

  return response;
}

export async function loadData(): Promise<AppData> {
  const response = await requestData();
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('The SWA route did not return JSON. Confirm that /api/data is linked to the Function App.');
  }
  return normalizeData(await response.json());
}

export async function saveData(data: AppData): Promise<void> {
  await requestData({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}