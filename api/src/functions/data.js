const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

let joseModule;
let jwks;

const accountName = process.env.STORAGE_ACCOUNT_NAME;
const blobService = new BlobServiceClient(
  `https://${accountName}.blob.core.windows.net`,
  new DefaultAzureCredential()
);
const container = blobService.getContainerClient('userdata');

// Henter brukerens objekt-ID fra den validerte innloggingen som Static Web Apps sender.
function getUserOid(req) {
  const id = req.headers.get('x-ms-client-principal-id');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return id;
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function getBearerUserOid(req) {
  const authorization = req.headers.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const tenantId = process.env.ENTRA_TENANT_ID;
  const audience = process.env.ENTRA_API_AUDIENCE;
  const pluginClientId = process.env.ENTRA_PLUGIN_CLIENT_ID;
  const requiredScope = process.env.ENTRA_API_SCOPE_NAME || 'access_as_user';
  if (!tokenMatch || !tenantId || !audience || !pluginClientId) return null;

  joseModule ??= import('jose');
  const { createRemoteJWKSet, jwtVerify } = await joseModule;
  jwks ??= createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));

  const { payload } = await jwtVerify(tokenMatch[1], jwks, {
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    audience,
  });
  const grantedScopes = typeof payload.scp === 'string' ? payload.scp.split(/\s+/) : [];
  if (payload.tid !== tenantId
    || payload.azp !== pluginClientId
    || !grantedScopes.includes(requiredScope)
    || typeof payload.oid !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(payload.oid)) {
    return null;
  }
  return payload.oid;
}

async function handleDataRequest(req, context, oid) {
  const blob = container.getBlockBlobClient(`${oid}/data.json`);

  if (req.method === 'GET') {
    if (!(await blob.exists())) {
      return { status: 200, jsonBody: { version: 1, customers: [], tasks: [] } };
    }
    const download = await blob.download();
    const text = await streamToString(download.readableStreamBody);
    return { status: 200, body: text, headers: { 'Content-Type': 'application/json' } };
  }

  const body = await req.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return { status: 400, body: 'Request body must be valid JSON.' };
  }
  if (!data || !Array.isArray(data.customers) || !Array.isArray(data.tasks)) {
    return { status: 400, body: 'Request body must include customers and tasks arrays.' };
  }

  try {
    await blob.upload(body, Buffer.byteLength(body), {
      blobHTTPHeaders: { blobContentType: 'application/json' },
    });
    return { status: 204 };
  } catch (err) {
    context.error('Upload feilet:', err.code, err.message);
    return { status: 500, body: `Upload feilet: ${err.code ?? err.message}` };
  }
}

app.http('data', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous', // Static Web Apps håndhever innlogging via routes
  route: 'data',
  handler: async (req, context) => {
    const oid = getUserOid(req);
    if (!oid) return { status: 401 };
    return handleDataRequest(req, context, oid);
  },
});

app.http('obsidianData', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'obsidian/data',
  handler: async (req, context) => {
    try {
      const oid = await getBearerUserOid(req);
      if (!oid) return { status: 403, body: 'A valid Entra access token is required.' };
      return handleDataRequest(req, context, oid);
    } catch (error) {
      context.error('Obsidian API token validation failed:', error instanceof Error ? error.message : 'unknown error');
      return { status: 403, body: 'A valid Entra access token is required.' };
    }
  },
});