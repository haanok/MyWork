// End-to-end tests for server.mjs against a local OIDC discovery + JWKS
// server and self-signed tokens. Run with: npm test (from server/).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const serverFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
const ISSUER = 'https://id.example.test';
const CLIENT_ID = 'mywork-test-client';
const SUB = '3f0c1a52-8d4e-4b8a-9c3f-1d2e3f4a5b6c';
const MCP_CLIENT = 'mywork-claude-test-client';
const MCP_SUB = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const PUBLIC = 'https://mywork.example.test';

let tmp, dataDir, distDir, idp, idpPort, app, appPort, key, otherKey;

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function startApp(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverFile], {
      env: { PATH: process.env.PATH, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const onData = (chunk) => {
      output += chunk;
      if (output.includes('OIDC discovery loaded')) resolve({ child, output: () => output });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('exit', (code) => reject(Object.assign(new Error(`exited ${code}: ${output}`), { code, output })));
    child.logs = () => output;
  });
}

function request(method, urlPath, { token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: appPort, method, path: urlPath,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function sign(claims = {}, { signer = key, iss = ISSUER, aud = CLIENT_ID, exp = '10m', sub = SUB } = {}) {
  let jwt = new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: signer.kid })
    .setIssuedAt()
    .setIssuer(iss)
    .setAudience(aud)
    .setExpirationTime(exp);
  if (sub !== null) jwt = jwt.setSubject(sub);
  return jwt.sign(signer.privateKey);
}

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mywork-test-'));
  dataDir = path.join(tmp, 'data');
  distDir = path.join(tmp, 'dist');
  await fs.mkdir(path.join(distDir, 'assets'), { recursive: true });
  await fs.mkdir(dataDir);
  await fs.writeFile(path.join(distDir, 'index.html'), '<!doctype html><title>index</title>');
  await fs.writeFile(path.join(distDir, 'assets', 'app-abc123.js'), 'console.log(1)');
  await fs.writeFile(path.join(tmp, 'secret.txt'), 'TOP-SECRET');

  const makeKey = async (kid) => ({ kid, ...(await generateKeyPair('RS256', { extractable: true })) });
  key = await makeKey('test-key');
  otherKey = await makeKey('test-key'); // same kid, different key material
  const jwk = { ...(await exportJWK(key.publicKey)), kid: key.kid, alg: 'RS256', use: 'sig' };

  idpPort = await freePort();
  idp = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/.well-known/openid-configuration') {
      res.end(JSON.stringify({
        issuer: ISSUER,
        jwks_uri: `http://127.0.0.1:${idpPort}/custom/jwks.json`,
        userinfo_endpoint: `http://127.0.0.1:${idpPort}/userinfo`,
      }));
    } else if (req.url === '/userinfo') {
      // Echoes the test-only claim "userinfo_groups" from the (unverified) token.
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const claims = JSON.parse(Buffer.from(token.split('.')[1] || 'e30', 'base64url').toString());
      res.end(JSON.stringify({ sub: claims.sub, groups: claims.userinfo_groups ?? [] }));
    } else if (req.url === '/custom/jwks.json') {
      res.end(JSON.stringify({ keys: [jwk] }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  }).listen(idpPort, '127.0.0.1');

  appPort = await freePort();
  app = await startApp({
    PORT: String(appPort),
    DATA_DIR: dataDir,
    DIST_DIR: distDir,
    POCKET_ID_URL: ISSUER,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_DISCOVERY_URL: `http://127.0.0.1:${idpPort}/.well-known/openid-configuration`,
    MAX_BODY_BYTES: String(64 * 1024),
    MCP_CLIENT_ID: MCP_CLIENT,
    PUBLIC_URL: PUBLIC,
  });
});

after(async () => {
  app?.child.kill();
  idp?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test('healthz', async () => {
  const res = await request('GET', '/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body, 'ok');
});

test('GET without data returns empty document and logs sub', async () => {
  const res = await request('GET', '/api/data', { token: await sign() });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.deepEqual(JSON.parse(res.body), { version: 1, customers: [], tasks: [] });
  assert.match(app.output(), new RegExp(`sub=${SUB}`));
});

test('PUT stores atomically at DATA_DIR/<sub>/data.json, GET reads it back', async () => {
  const token = await sign();
  const doc = { version: 1, customers: [{ id: 'c1', name: 'Acme' }], tasks: [{ id: 't1' }] };
  const put = await request('PUT', '/api/data', {
    token, body: JSON.stringify(doc), headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(put.status, 204);
  const stored = JSON.parse(await fs.readFile(path.join(dataDir, SUB, 'data.json'), 'utf8'));
  assert.deepEqual(stored, doc);
  assert.deepEqual((await fs.readdir(path.join(dataDir, SUB))), ['data.json'], 'no temp files left');

  const get = await request('GET', '/api/data', { token });
  assert.equal(get.status, 200);
  assert.deepEqual(JSON.parse(get.body), doc);
});

test('invalid PUT bodies give 400', async () => {
  const token = await sign();
  for (const body of ['not json', '{"customers":[]}', '{"customers":{},"tasks":[]}', 'null', '[]']) {
    const res = await request('PUT', '/api/data', { token, body });
    assert.equal(res.status, 400, body);
  }
});

test('oversized PUT gives 413', async () => {
  const body = JSON.stringify({ customers: ['x'.repeat(70 * 1024)], tasks: [] });
  const res = await request('PUT', '/api/data', { token: await sign(), body });
  assert.equal(res.status, 413);
});

test('rejected tokens give 401', async () => {
  const cases = {
    'no token': undefined,
    'garbage': 'abc.def.ghi',
    'wrong audience': await sign({}, { aud: 'someone-else' }),
    'wrong issuer': await sign({}, { iss: 'https://evil.example.test' }),
    'expired': await sign({}, { exp: Math.floor(Date.now() / 1000) - 120 }),
    'wrong signing key': await sign({}, { signer: otherKey }),
    'non-uuid sub': await sign({}, { sub: '../../etc' }),
    'missing sub': await sign({}, { sub: null }),
  };
  const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({
    iss: ISSUER, aud: CLIENT_ID, sub: SUB, exp: Math.floor(Date.now() / 1000) + 600,
  })).toString('base64url')}.`;
  cases['alg none'] = unsigned;

  for (const [name, token] of Object.entries(cases)) {
    const get = await request('GET', '/api/data', { token });
    assert.equal(get.status, 401, `GET ${name}`);
    const put = await request('PUT', '/api/data', { token, body: '{"customers":[],"tasks":[]}' });
    assert.equal(put.status, 401, `PUT ${name}`);
  }
});

test('identity headers from the client are ignored', async () => {
  const res = await request('GET', '/api/data', {
    headers: { 'x-ms-client-principal-id': SUB, 'x-forwarded-user': SUB, 'x-auth-request-user': SUB },
  });
  assert.equal(res.status, 401);
});

test('static files, cache headers and SPA fallback', async () => {
  const asset = await request('GET', '/assets/app-abc123.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.match(asset.headers['content-type'], /javascript/);

  assert.equal((await request('GET', '/assets/missing.js')).status, 404);

  const spa = await request('GET', '/customers/42');
  assert.equal(spa.status, 200);
  assert.match(spa.body, /<title>index<\/title>/);
  assert.equal(spa.headers['cache-control'], 'no-cache');

  assert.equal((await request('GET', '/api/obsidian/data')).status, 404);
  assert.equal((await request('GET', '/api/unknown')).status, 404);
  assert.equal((await request('POST', '/')).status, 405);
});

test('path traversal is blocked', async () => {
  const paths = [
    '/../secret.txt',
    '/assets/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/assets/..%2f..%2fsecret.txt',
    '/%2e%2e%2fsecret.txt',
    '/assets/%2e%2e%5c%2e%2e%5csecret.txt',
    '/..%5csecret.txt',
    '/%00../secret.txt',
    '/%E0%A4%A',
  ];
  for (const p of paths) {
    const res = await request('GET', p);
    assert.ok(!res.body.includes('TOP-SECRET'), `leaked via ${p}`);
    assert.ok([200, 400, 404].includes(res.status), `${p} -> ${res.status}`);
  }
});

test('/.auth routes redirect to oauth2-proxy', async () => {
  const anon = await request('GET', '/.auth/login/aad');
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.location, '/oauth2/start?rd=%2F');

  const signedIn = await request('GET', '/.auth/login/aad', { token: await sign() });
  assert.equal(signedIn.status, 302);
  assert.equal(signedIn.headers.location, '/');

  const logout = await request('GET', '/.auth/logout');
  assert.equal(logout.status, 302);
  assert.equal(logout.headers.location, '/oauth2/sign_out?rd=%2F');
});

test('OIDC_DISCOVERY_URL is refused in production', async () => {
  await assert.rejects(startApp({
    NODE_ENV: 'production',
    PORT: String(await freePort()),
    POCKET_ID_URL: ISSUER,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_DISCOVERY_URL: `http://127.0.0.1:${idpPort}/.well-known/openid-configuration`,
  }), (error) => error.code === 1 && /not allowed/.test(error.output));
});

test('ALLOWED_GROUPS restricts access', async () => {
  const port = await freePort();
  const restricted = await startApp({
    PORT: String(port),
    DATA_DIR: dataDir,
    DIST_DIR: distDir,
    POCKET_ID_URL: ISSUER,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_DISCOVERY_URL: `http://127.0.0.1:${idpPort}/.well-known/openid-configuration`,
    ALLOWED_GROUPS: 'mywork, admins',
  });
  const saved = appPort;
  appPort = port;
  try {
    assert.equal((await request('GET', '/api/data', { token: await sign({ groups: ['other'] }) })).status, 403);
    assert.equal((await request('GET', '/api/data', { token: await sign() })).status, 403);
    assert.equal((await request('GET', '/api/data', { token: await sign({ groups: ['mywork'] }) })).status, 200);
  } finally {
    appPort = saved;
    restricted.child.kill();
  }
});

// --- ETag / If-Match ---------------------------------------------------------

test('PUT with a stale If-Match gives 412 and keeps the stored data', async () => {
  const token = await sign();
  const first = await request('GET', '/api/data', { token });
  assert.match(first.headers.etag, /^"[A-Za-z0-9_-]+"$/);

  const docA = { version: 1, customers: [{ id: 'a' }], tasks: [] };
  const putA = await request('PUT', '/api/data', {
    token, body: JSON.stringify(docA), headers: { 'If-Match': first.headers.etag },
  });
  assert.equal(putA.status, 204);
  assert.notEqual(putA.headers.etag, first.headers.etag);

  const stale = await request('PUT', '/api/data', {
    token, body: JSON.stringify({ version: 1, customers: [], tasks: [] }), headers: { 'If-Match': first.headers.etag },
  });
  assert.equal(stale.status, 412);
  assert.equal(stale.headers.etag, putA.headers.etag);

  const get = await request('GET', '/api/data', { token });
  assert.deepEqual(JSON.parse(get.body), docA);
  assert.equal(get.headers.etag, putA.headers.etag);
});

// --- MCP -----------------------------------------------------------------------

const mcpToken = (claims = {}) => sign(claims, { aud: MCP_CLIENT, sub: MCP_SUB });

let rpcId = 0;
async function rpc(method, params = {}, token) {
  const res = await request('POST', '/mcp', {
    token: token ?? await mcpToken(),
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  });
  assert.equal(res.status, 200, res.body);
  const message = JSON.parse(res.body);
  assert.ok(!message.error, JSON.stringify(message.error));
  return message.result;
}

async function call(name, args) {
  const result = await rpc('tools/call', { name, arguments: args });
  return { ...result, value: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
}

test('protected resource metadata points Claude at Pocket ID', async () => {
  for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const res = await request('GET', p);
    assert.equal(res.status, 200, p);
    const meta = JSON.parse(res.body);
    assert.equal(meta.resource, `${PUBLIC}/mcp`);
    assert.deepEqual(meta.authorization_servers, [ISSUER]);
  }
});

test('other well-known paths give 404, not the SPA', async () => {
  for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration', '/.well-known/x']) {
    const res = await request('GET', p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.body, /<title>/);
  }
});

test('/mcp requires a token for the MCP client', async () => {
  const anon = await request('POST', '/mcp', { body: '{}' });
  assert.equal(anon.status, 401);
  assert.equal(anon.headers['www-authenticate'], `Bearer resource_metadata="${PUBLIC}/.well-known/oauth-protected-resource"`);

  // The web app's token (aud = OIDC_CLIENT_ID) is not accepted on /mcp,
  // and the MCP token is not accepted on /api/data.
  const web = await request('POST', '/mcp', { token: await sign(), body: '{}' });
  assert.equal(web.status, 401);
  assert.match(web.headers['www-authenticate'], /resource_metadata=/);
  assert.equal((await request('GET', '/api/data', { token: await mcpToken() })).status, 401);

  assert.equal((await request('GET', '/mcp', { token: await mcpToken() })).status, 405);
});

test('/mcp accepts a token whose audience is the resource URL', async () => {
  const token = await sign({}, { aud: `${PUBLIC}/mcp`, sub: MCP_SUB });
  const { tools } = await rpc('tools/list', {}, token);
  assert.ok(tools.length > 0);
  // ...but such a token is not valid for the web API.
  assert.equal((await request('GET', '/api/data', { token })).status, 401);
});

test('/api/mcp tells the web app how to connect', async () => {
  assert.equal((await request('GET', '/api/mcp')).status, 401);
  assert.equal((await request('GET', '/api/mcp', { token: await mcpToken() })).status, 401);
  const res = await request('GET', '/api/mcp', { token: await sign() });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), {
    enabled: true, url: `${PUBLIC}/mcp`, clientId: MCP_CLIENT, issuer: ISSUER,
  });
});

test('MCP initialize and tools/list', async () => {
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  assert.equal(init.serverInfo.name, 'mywork');
  const { tools } = await rpc('tools/list');
  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    'add_contact', 'add_customer', 'add_task', 'append_note', 'delete_task', 'get_customer',
    'list_customers', 'list_tasks', 'search', 'update_customer', 'update_task',
  ]);
  assert.equal(tools.find((tool) => tool.name === 'list_tasks').annotations.readOnlyHint, true);
  assert.equal(tools.find((tool) => tool.name === 'delete_task').annotations.destructiveHint, true);
});

test('MCP tools change the same data the web app reads', async () => {
  const acme = await call('add_customer', { name: 'Acme Synthetic AS' });
  assert.equal(acme.value.status, 'active');
  await call('add_customer', { name: 'Acme Other' });

  const ambiguous = await call('add_task', { customer: 'acme', title: 'x' });
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.value, /several customers/);

  const task = await call('add_task', { customer: 'acme synthetic as', title: 'Send offer', due: '2026-11-20', priority: 'high' });
  assert.equal(task.value.customer, 'Acme Synthetic AS');
  await call('append_note', { customer: acme.value.id, text: 'Called about renewal.' });
  await call('add_contact', { customer: acme.value.id, name: 'Kari', detail: 'CTO' });

  const open = await call('list_tasks', { customer: 'Acme Synthetic' });
  assert.deepEqual(open.value.map((t) => t.title), ['Send offer']);

  const done = await call('update_task', { task_id: task.value.id, status: 'done', due: '' });
  assert.equal(done.value.status, 'done');
  assert.ok(done.value.doneAt);
  assert.equal(done.value.due, undefined);
  assert.deepEqual((await call('list_tasks', {})).value, []);

  const found = await call('search', { query: 'renewal' });
  assert.deepEqual(found.value.customers.map((c) => c.name), ['Acme Synthetic AS']);

  const detail = await call('get_customer', { customer: acme.value.id });
  assert.match(detail.value.notes, /^\d{4}-\d{2}-\d{2}: Called about renewal\.$/);
  assert.equal(detail.value.contacts[0].name, 'Kari');

  await call('delete_task', { task_id: task.value.id });
  const missing = await call('update_task', { task_id: task.value.id, status: 'open' });
  assert.equal(missing.isError, true);

  const stored = JSON.parse(await fs.readFile(path.join(dataDir, MCP_SUB, 'data.json'), 'utf8'));
  assert.equal(stored.customers.length, 2);
  assert.deepEqual(stored.tasks, []);
  assert.deepEqual(stored.deletedTaskIds, [task.value.id]);
  assert.ok(stored.customers[0].touchedAt >= stored.customers[0].createdAt);
});

test('an MCP change makes a stale web save fail with 412', async () => {
  const webToken = await sign({}, { sub: MCP_SUB });
  const loaded = await request('GET', '/api/data', { token: webToken });
  await call('add_customer', { name: 'Added by Claude' });

  const stale = await request('PUT', '/api/data', {
    token: webToken, body: loaded.body, headers: { 'If-Match': loaded.headers.etag },
  });
  assert.equal(stale.status, 412);
  const now = JSON.parse((await request('GET', '/api/data', { token: webToken })).body);
  assert.ok(now.customers.some((c) => c.name === 'Added by Claude'));
});

test('MCP group check falls back to userinfo', async () => {
  const port = await freePort();
  const restricted = await startApp({
    PORT: String(port),
    DATA_DIR: dataDir,
    DIST_DIR: distDir,
    POCKET_ID_URL: ISSUER,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_DISCOVERY_URL: `http://127.0.0.1:${idpPort}/.well-known/openid-configuration`,
    ALLOWED_GROUPS: 'mywork',
    MCP_CLIENT_ID: MCP_CLIENT,
    PUBLIC_URL: PUBLIC,
  });
  const saved = appPort;
  appPort = port;
  try {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    const denied = await request('POST', '/mcp', { token: await mcpToken({ userinfo_groups: ['other'] }), body, headers });
    assert.equal(denied.status, 403);
    const allowed = await request('POST', '/mcp', { token: await mcpToken({ userinfo_groups: ['mywork'] }), body, headers });
    assert.equal(allowed.status, 200);
  } finally {
    appPort = saved;
    restricted.child.kill();
  }
});

test('MCP is off without MCP_CLIENT_ID', async () => {
  const port = await freePort();
  const plain = await startApp({
    PORT: String(port),
    DATA_DIR: dataDir,
    DIST_DIR: distDir,
    POCKET_ID_URL: ISSUER,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_DISCOVERY_URL: `http://127.0.0.1:${idpPort}/.well-known/openid-configuration`,
  });
  const saved = appPort;
  appPort = port;
  try {
    assert.equal((await request('POST', '/mcp', { token: await mcpToken(), body: '{}' })).status, 405);
    assert.equal((await request('GET', '/.well-known/oauth-protected-resource')).status, 404);
    const info = await request('GET', '/api/mcp', { token: await sign() });
    assert.deepEqual(JSON.parse(info.body), { enabled: false });
  } finally {
    appPort = saved;
    plain.child.kill();
  }
});
