// Self-hosted backend for MyWork: serves the built frontend from dist/ and
// implements GET/PUT /api/data, authenticated by an OIDC ID token from
// Pocket ID that oauth2-proxy forwards in the Authorization header.
// Optionally also serves a remote MCP endpoint at /mcp for Claude, which
// authenticates with its own Pocket ID access token (audience MCP_CLIENT_ID).
import http from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createStorage } from './storage.mjs';
import { handleMcp } from './mcp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

const PORT = Number(process.env.PORT || 7071);
const DATA_DIR = path.resolve(process.env.DATA_DIR || '/data');
const DIST_DIR = path.resolve(process.env.DIST_DIR || path.join(here, '..', 'dist'));
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 10 * 1024 * 1024);
const ISSUER = requireEnv('POCKET_ID_URL').replace(/\/+$/, '');
const AUDIENCE = requireEnv('OIDC_CLIENT_ID');
const ALLOWED_GROUPS = (process.env.ALLOWED_GROUPS || '')
  .split(',').map((group) => group.trim()).filter(Boolean);
// MCP is enabled only when both are set.
const MCP_CLIENT_ID = process.env.MCP_CLIENT_ID?.trim() || '';
const PUBLIC_URL = (process.env.PUBLIC_URL?.trim() || '').replace(/\/+$/, '');
const MCP_ENABLED = Boolean(MCP_CLIENT_ID && PUBLIC_URL);
if (MCP_CLIENT_ID && !PUBLIC_URL) {
  console.error('MCP_CLIENT_ID is set but PUBLIC_URL is not; /mcp stays disabled.');
}
if (MCP_CLIENT_ID && MCP_CLIENT_ID === AUDIENCE) {
  console.error('MCP_CLIENT_ID must be a separate Pocket ID client from OIDC_CLIENT_ID.');
  process.exit(1);
}
const RESOURCE_METADATA_URL = `${PUBLIC_URL}/.well-known/oauth-protected-resource`;
// RFC 8707 resource indicator for /mcp. When it is registered as an API in
// Pocket ID, access tokens carry it in aud instead of the client ID.
const MCP_RESOURCE = `${PUBLIC_URL}/mcp`;

const storage = createStorage(DATA_DIR);

// The discovery URL may only be overridden outside production (used by the
// tests to point at a local JWKS). In production it is always derived from
// the issuer, and the issuer in the token is verified either way.
let discoveryUrl = `${ISSUER}/.well-known/openid-configuration`;
if (process.env.OIDC_DISCOVERY_URL) {
  if (process.env.NODE_ENV === 'production') {
    console.error('OIDC_DISCOVERY_URL is not allowed when NODE_ENV=production');
    process.exit(1);
  }
  discoveryUrl = process.env.OIDC_DISCOVERY_URL;
}

const SUB_PATTERN = /^[0-9a-f-]{36}$/i;
const ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];

let oidcPromise;
function getOidc() {
  oidcPromise ??= (async () => {
    const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`OIDC discovery returned ${response.status}`);
    const config = await response.json();
    if (typeof config.issuer !== 'string' || config.issuer.replace(/\/+$/, '') !== ISSUER) {
      throw new Error(`OIDC discovery issuer ${JSON.stringify(config.issuer)} does not match POCKET_ID_URL`);
    }
    if (typeof config.jwks_uri !== 'string') throw new Error('OIDC discovery has no jwks_uri');
    console.log(`OIDC discovery loaded; jwks_uri=${config.jwks_uri}`);
    return {
      jwks: createRemoteJWKSet(new URL(config.jwks_uri)),
      userinfoEndpoint: typeof config.userinfo_endpoint === 'string' ? config.userinfo_endpoint : null,
    };
  })().catch((error) => {
    oidcPromise = undefined; // retry on the next request
    throw error;
  });
  return oidcPromise;
}

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

// Access tokens usually carry no groups claim, so MCP group checks ask the
// userinfo endpoint. Results are cached briefly per token.
const userinfoCache = new Map();
const USERINFO_TTL_MS = 5 * 60 * 1000;

async function groupsFromUserinfo(token, userinfoEndpoint) {
  const cacheKey = crypto.createHash('sha256').update(token).digest('base64url');
  const cached = userinfoCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.groups;
  if (!userinfoEndpoint) return [];
  const response = await fetch(userinfoEndpoint, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new HttpError(401, 'Token rejected by the identity provider.');
  const info = await response.json();
  const groups = Array.isArray(info.groups) ? info.groups.filter((group) => typeof group === 'string') : [];
  for (const [key, value] of userinfoCache) if (value.expires <= Date.now()) userinfoCache.delete(key);
  userinfoCache.set(cacheKey, { groups, expires: Date.now() + USERINFO_TTL_MS });
  return groups;
}

// Verifies the bearer token for the given audience and returns the Pocket ID
// user ID (sub), or throws HttpError 401/403/503.
async function authenticate(req, { audience = AUDIENCE, challenge = {} } = {}) {
  const fail = (status, message) => new HttpError(status, message, status === 401 ? challenge : {});
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(req.headers.authorization || '');
  if (!match) throw fail(401, 'Missing bearer token.');
  const token = match[1];

  let oidc;
  try {
    oidc = await getOidc();
  } catch (error) {
    console.error('OIDC discovery failed:', error.message);
    throw new HttpError(503, 'Identity provider unavailable.');
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, oidc.jwks, {
      issuer: ISSUER,
      audience,
      algorithms: ALGORITHMS,
      clockTolerance: 30,
      requiredClaims: ['exp', 'sub'],
    }));
  } catch (error) {
    throw fail(401, 'Invalid token.');
  }

  if (typeof payload.sub !== 'string' || !SUB_PATTERN.test(payload.sub)) {
    throw fail(401, 'Invalid subject.');
  }
  if (ALLOWED_GROUPS.length > 0) {
    let groups = Array.isArray(payload.groups) ? payload.groups : null;
    if (!groups && audience !== AUDIENCE) {
      try {
        groups = await groupsFromUserinfo(token, oidc.userinfoEndpoint);
      } catch (error) {
        if (error instanceof HttpError) throw fail(error.status, error.message);
        console.error('Userinfo lookup failed:', error.message);
        throw new HttpError(503, 'Identity provider unavailable.');
      }
    }
    if (!(groups ?? []).some((group) => ALLOWED_GROUPS.includes(group))) {
      throw new HttpError(403, 'User is not in an allowed group.');
    }
  }
  return payload.sub;
}

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

function sendText(res, status, text) {
  send(res, status, text, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, 'Request body too large.'));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(new HttpError(413, 'Request body too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

async function handleData(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    send(res, 405, '', { Allow: 'GET, PUT' });
    return;
  }
  const sub = await authenticate(req);

  if (req.method === 'GET') {
    const { text, etag } = await storage.read(sub);
    send(res, 200, text, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ETag: etag,
    });
    return;
  }

  const body = await readBody(req);
  let data;
  try {
    data = JSON.parse(body.toString('utf8'));
  } catch {
    sendText(res, 400, 'Request body must be valid JSON.');
    return;
  }
  if (!data || !Array.isArray(data.customers) || !Array.isArray(data.tasks)) {
    sendText(res, 400, 'Request body must include customers and tasks arrays.');
    return;
  }

  // If-Match makes the save conditional: when the stored document changed
  // since the client loaded it (for example through /mcp), refuse with 412
  // instead of overwriting. Without If-Match the save is unconditional.
  const ifMatch = req.headers['if-match']?.trim();
  const result = await storage.withLock(sub, async () => {
    if (ifMatch && ifMatch !== '*') {
      const current = await storage.read(sub);
      const accepted = ifMatch.split(',').map((tag) => tag.trim().replace(/^W\//, ''));
      if (!accepted.includes(current.etag)) return { conflict: true, etag: current.etag };
    }
    return { etag: await storage.write(sub, body) };
  });
  if (result.conflict) {
    send(res, 412, 'The data was changed elsewhere. Reload before saving.', {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ETag: result.etag,
    });
    return;
  }
  send(res, 204, '', { ETag: result.etag });
}

function sendJson(res, status, value, headers = {}) {
  send(res, status, JSON.stringify(value), {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
}

// Tells the signed-in web app whether /mcp is on and what an MCP client needs
// to connect (URL and the Pocket ID client ID, which is not a secret).
async function handleMcpInfo(req, res) {
  if (req.method !== 'GET') {
    send(res, 405, '', { Allow: 'GET' });
    return;
  }
  await authenticate(req);
  sendJson(res, 200, MCP_ENABLED
    ? { enabled: true, url: MCP_RESOURCE, clientId: MCP_CLIENT_ID, issuer: ISSUER }
    : { enabled: false }, { 'Cache-Control': 'no-store' });
}

// RFC 9728 protected resource metadata: tells MCP clients (Claude) which
// authorization server issues tokens for /mcp.
function handleResourceMetadata(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, '', { Allow: 'GET, HEAD' });
    return;
  }
  sendJson(res, 200, {
    resource: MCP_RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: ['openid', 'profile', 'email', 'groups'],
    bearer_methods_supported: ['header'],
    resource_name: 'MyWork',
  }, { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' });
}

async function handleMcpRoute(req, res) {
  const sub = await authenticate(req, {
    audience: [MCP_CLIENT_ID, MCP_RESOURCE],
    challenge: { 'WWW-Authenticate': `Bearer resource_metadata="${RESOURCE_METADATA_URL}"` },
  });
  await handleMcp(req, res, { sub, storage, readBody });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

async function statFile(file) {
  try {
    const stat = await fs.stat(file);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

function streamFile(req, res, file, stat, cacheControl) {
  const type = MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

async function handleStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, '', { Allow: 'GET, HEAD' });
    return;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendText(res, 400, 'Bad request.');
    return;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    sendText(res, 400, 'Bad request.');
    return;
  }
  const file = path.resolve(DIST_DIR, `.${decoded}`);
  if (file !== DIST_DIR && !file.startsWith(DIST_DIR + path.sep)) {
    sendText(res, 404, 'Not found.');
    return;
  }

  const isAsset = decoded.startsWith('/assets/');
  const stat = file === DIST_DIR ? null : await statFile(file);
  if (stat) {
    const cacheControl = isAsset ? 'public, max-age=31536000, immutable' : 'no-cache';
    streamFile(req, res, file, stat, cacheControl);
    return;
  }
  if (isAsset) {
    sendText(res, 404, 'Not found.');
    return;
  }

  // SPA fallback
  const index = path.join(DIST_DIR, 'index.html');
  const indexStat = await statFile(index);
  if (!indexStat) {
    sendText(res, 404, 'Not found.');
    return;
  }
  streamFile(req, res, index, indexStat, 'no-cache');
}

async function handleLogin(req, res) {
  // Already signed in (oauth2-proxy forwarded a valid token): go to the app.
  // Otherwise start a fresh sign-in through oauth2-proxy.
  let target = '/oauth2/start?rd=%2F';
  try {
    await authenticate(req);
    target = '/';
  } catch {
    // not signed in
  }
  send(res, 302, '', { Location: target, 'Cache-Control': 'no-store' });
}

async function route(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/healthz') return sendText(res, 200, 'ok');
  if (pathname === '/api/data') return handleData(req, res);
  if (pathname === '/api/mcp') return handleMcpInfo(req, res);
  if (MCP_ENABLED) {
    if (pathname === '/mcp') return handleMcpRoute(req, res);
    if (pathname === '/.well-known/oauth-protected-resource'
      || pathname === '/.well-known/oauth-protected-resource/mcp') {
      return handleResourceMetadata(req, res);
    }
  }
  // MCP clients probe other well-known documents here (for example
  // oauth-authorization-server). Answer 404 instead of the SPA so they fall
  // back to the authorization server named in the resource metadata.
  if (pathname.startsWith('/.well-known/')) return sendText(res, 404, 'Not found.');
  if (pathname === '/api' || pathname.startsWith('/api/')) return sendText(res, 404, 'Not found.');
  if (pathname === '/.auth/login/aad') return handleLogin(req, res);
  if (pathname === '/.auth/logout') {
    return send(res, 302, '', { Location: '/oauth2/sign_out?rd=%2F', 'Cache-Control': 'no-store' });
  }
  if (pathname.startsWith('/.auth/')) return sendText(res, 404, 'Not found.');
  if (pathname === '/staticwebapp.config.json') return sendText(res, 404, 'Not found.');
  return handleStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (error instanceof HttpError) {
      if (error.status === 413) {
        // Stop reading the oversized body once the response is out.
        res.setHeader('Connection', 'close');
        res.on('finish', () => req.destroy());
      }
      if (!res.headersSent) {
        for (const [name, value] of Object.entries(error.headers ?? {})) res.setHeader(name, value);
        sendText(res, error.status, error.message);
      }
      else res.destroy();
      return;
    }
    console.error('Request failed:', req.method, req.url, error);
    if (!res.headersSent) sendText(res, 500, 'Internal server error.');
    else res.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`MyWork listening on :${PORT} (data=${DATA_DIR}, dist=${DIST_DIR}, issuer=${ISSUER})`);
  console.log(MCP_ENABLED ? `MCP enabled at ${PUBLIC_URL}/mcp (client ${MCP_CLIENT_ID})` : 'MCP disabled (set MCP_CLIENT_ID and PUBLIC_URL to enable)');
  getOidc().catch((error) => console.error('Initial OIDC discovery failed (will retry):', error.message));
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
