// Self-hosted backend for MyWork: serves the built frontend from dist/ and
// implements GET/PUT /api/data, authenticated by an OIDC ID token from
// Pocket ID that oauth2-proxy forwards in the Authorization header.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRemoteJWKSet, jwtVerify } from 'jose';

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

let jwksPromise;
function getJwks() {
  jwksPromise ??= (async () => {
    const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`OIDC discovery returned ${response.status}`);
    const config = await response.json();
    if (typeof config.issuer !== 'string' || config.issuer.replace(/\/+$/, '') !== ISSUER) {
      throw new Error(`OIDC discovery issuer ${JSON.stringify(config.issuer)} does not match POCKET_ID_URL`);
    }
    if (typeof config.jwks_uri !== 'string') throw new Error('OIDC discovery has no jwks_uri');
    console.log(`OIDC discovery loaded; jwks_uri=${config.jwks_uri}`);
    return createRemoteJWKSet(new URL(config.jwks_uri));
  })().catch((error) => {
    jwksPromise = undefined; // retry on the next request
    throw error;
  });
  return jwksPromise;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Returns the verified Pocket ID user ID (sub), or throws HttpError 401/403.
async function authenticate(req) {
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(req.headers.authorization || '');
  if (!match) throw new HttpError(401, 'Missing bearer token.');

  let jwks;
  try {
    jwks = await getJwks();
  } catch (error) {
    console.error('OIDC discovery failed:', error.message);
    throw new HttpError(503, 'Identity provider unavailable.');
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(match[1], jwks, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ALGORITHMS,
      clockTolerance: 30,
      requiredClaims: ['exp', 'sub'],
    }));
  } catch (error) {
    throw new HttpError(401, 'Invalid token.');
  }

  if (typeof payload.sub !== 'string' || !SUB_PATTERN.test(payload.sub)) {
    throw new HttpError(401, 'Invalid subject.');
  }
  if (ALLOWED_GROUPS.length > 0) {
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    if (!groups.some((group) => ALLOWED_GROUPS.includes(group))) {
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

const seenUsers = new Set();

async function handleData(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    send(res, 405, '', { Allow: 'GET, PUT' });
    return;
  }
  const sub = await authenticate(req);
  const userDir = path.join(DATA_DIR, sub);
  const file = path.join(userDir, 'data.json');

  if (req.method === 'GET') {
    let text;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!seenUsers.has(sub)) {
        seenUsers.add(sub);
        console.log(`No stored data for user sub=${sub}; expected at ${file}`);
      }
      text = JSON.stringify({ version: 1, customers: [], tasks: [] });
    }
    send(res, 200, text, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
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

  await fs.mkdir(userDir, { recursive: true, mode: 0o700 });
  const tmp = path.join(userDir, `.data.json.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await fs.open(tmp, 'wx', 0o600);
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
  send(res, 204);
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
      if (!res.headersSent) sendText(res, error.status, error.message);
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
  getJwks().catch((error) => console.error('Initial OIDC discovery failed (will retry):', error.message));
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
