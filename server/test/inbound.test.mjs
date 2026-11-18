// Tests for the email-to-task inbox (server/inbound.mjs) with DKIM-signed
// synthetic messages and a fake DNS resolver. No network or IMAP needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dkimSign } from 'mailauth';
import { createStorage } from '../storage.mjs';
import {
  createRegistry, processMessage, parseSubject, stripSubjectPrefixes, cleanBody, SenderConflictError,
  readInboundConfig, parseNightHours, nextPollDelayMs, retentionCutoff,
} from '../inbound.mjs';

const SUB = '3f0c1a52-8d4e-4b8a-9c3f-1d2e3f4a5b6c';
const OTHER_SUB = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SENDER = 'alex@consulting.example';
// Wednesday 18 November 2026, local time.
const NOW = new Date(2026, 10, 18, 9, 0, 0);

let tmp, storage, registry, privateKey, publicKeyDer;

const resolver = async (name, type) => {
  if (type === 'TXT' && name === 'sel1._domainkey.consulting.example') {
    return [[`v=DKIM1; k=rsa; p=${publicKeyDer}`]];
  }
  throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
};

function rawMessage({ from = SENDER, subject, body, messageId = `<${crypto.randomUUID()}@consulting.example>` }) {
  return Buffer.from([
    `From: Alex Example <${from}>`,
    'To: mywork@inbox.example',
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    'Date: Wed, 18 Nov 2026 09:00:00 +0100',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    ...body.split('\n'),
    '',
  ].join('\r\n'));
}

async function signed(message, domain = 'consulting.example') {
  const { signatures } = await dkimSign(message, {
    signatureData: [{ signingDomain: domain, selector: 'sel1', privateKey }],
  });
  return Buffer.concat([Buffer.from(signatures), message]);
}

const deps = () => ({ registry, storage, resolver, now: NOW });
const board = async (sub = SUB) => JSON.parse((await storage.read(sub)).text);

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mywork-inbound-'));
  storage = createStorage(tmp);
  registry = createRegistry(tmp);
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  publicKeyDer = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  await storage.write(SUB, JSON.stringify({
    version: 1,
    customers: [
      { id: 'c-sg', name: 'Sample Group', shortName: 'sg', status: 'active', notes: '', contacts: [], createdAt: '2026-01-01T00:00:00.000Z', touchedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'c-nl', name: 'Northwind Logistics', status: 'active', notes: '', contacts: [], createdAt: '2026-01-01T00:00:00.000Z', touchedAt: '2026-01-01T00:00:00.000Z' },
    ],
    tasks: [],
  }));
  await registry.setSenders(SUB, [SENDER.toUpperCase()]);
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

test('subject prefixes from forwarding are removed', () => {
  assert.equal(stripSubjectPrefixes('VS: Fw:  sg: hello'), 'sg: hello');
  assert.equal(stripSubjectPrefixes('RE: SV: Northwind'), 'Northwind');
});

test('subject picks customer by short name or name, with quick-add tail', () => {
  const customers = [
    { id: 'a', name: 'Sample Group', shortName: 'sg', status: 'active' },
    { id: 'b', name: 'Northwind Logistics', status: 'active' },
  ];
  assert.equal(parseSubject('sg', customers, NOW).customer.id, 'a');
  assert.equal(parseSubject('northwind', customers, NOW).customer.id, 'b');
  const full = parseSubject('Fw: sg: Call about contract fre !', customers, NOW);
  assert.equal(full.customer.id, 'a');
  assert.equal(full.title, 'Call about contract');
  assert.equal(full.due, '2026-11-20');
  assert.equal(full.priority, 'high');
  assert.equal(parseSubject('unknown corp: hi', customers, NOW).customer, null);
});

test('body cleanup drops signatures and quoted text', () => {
  assert.equal(cleanBody('Hello\r\n> quoted\r\nThere\r\n-- \r\nSig'), 'Hello\nThere');
  assert.equal(cleanBody('Top\n\n\n\nNext\n________________\nFrom: someone'), 'Top\n\nNext');
});

test('a signed mail from a registered sender becomes a task on the subject customer', async () => {
  const result = await processMessage(await signed(rawMessage({
    subject: 'VS: sg',
    body: 'Can you check the invoice before Friday?\nThanks',
  })), deps());
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.sub, SUB);
  const data = await board();
  const task = data.tasks.find((t) => t.id === result.taskId);
  assert.equal(task.customerId, 'c-sg');
  assert.equal(task.title, 'Can you check the invoice before Friday?');
  assert.equal(task.description, 'Can you check the invoice before Friday?\nThanks');
  assert.equal(task.status, 'open');
  assert.equal(data.customers.find((c) => c.id === 'c-sg').touchedAt, NOW.toISOString());
});

test('title, due date and priority can come from the subject', async () => {
  const result = await processMessage(await signed(rawMessage({
    subject: 'Northwind: Follow up on rollout imorgen !',
    body: 'Message from the team chat.',
  })), deps());
  assert.equal(result.ok, true, result.reason);
  const task = (await board()).tasks.find((t) => t.id === result.taskId);
  assert.equal(task.customerId, 'c-nl');
  assert.equal(task.title, 'Follow up on rollout');
  assert.equal(task.due, '2026-11-19');
  assert.equal(task.priority, 'high');
});

test('an unknown customer goes to the Inbox customer', async () => {
  const result = await processMessage(await signed(rawMessage({ subject: 'Contoso: new request', body: 'Details' })), deps());
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.matched, false);
  const data = await board();
  const inbox = data.customers.find((c) => c.name === 'Inbox');
  assert.ok(inbox);
  assert.equal(inbox.shortName, 'inbox');
  const task = data.tasks.find((t) => t.id === result.taskId);
  assert.equal(task.customerId, inbox.id);
  assert.equal(task.title, 'Contoso: new request');
  // A second unmatched mail reuses the same Inbox customer.
  await processMessage(await signed(rawMessage({ subject: 'Other', body: 'x' })), deps());
  assert.equal((await board()).customers.filter((c) => c.name === 'Inbox').length, 1);
});

test('unregistered senders are rejected without touching the board', async () => {
  const before = (await storage.read(SUB)).etag;
  const result = await processMessage(await signed(rawMessage({ from: 'someone@consulting.example', subject: 'sg', body: 'x' })), deps());
  assert.equal(result.ok, false);
  assert.match(result.reason, /not registered/);
  assert.equal((await storage.read(SUB)).etag, before);
});

test('unsigned, forged or misaligned mail is rejected', async () => {
  const unsigned = await processMessage(rawMessage({ subject: 'sg', body: 'x' }), deps());
  assert.equal(unsigned.ok, false);
  assert.match(unsigned.reason, /DKIM/);

  const tampered = Buffer.from((await signed(rawMessage({ subject: 'sg', body: 'original' }))).toString().replace('original', 'changed!'));
  const forged = await processMessage(tampered, deps());
  assert.equal(forged.ok, false);
  assert.match(forged.reason, /DKIM/);

  // Valid signature, but for a different domain than From.
  const other = async (name, type) => resolver(name.replace('elsewhere.example', 'consulting.example'), type);
  const misaligned = await processMessage(await signed(rawMessage({ subject: 'sg', body: 'x' }), 'elsewhere.example'), { ...deps(), resolver: other });
  assert.equal(misaligned.ok, false);
  assert.match(misaligned.reason, /not aligned/);
});

test('the same Message-ID is imported only once', async () => {
  const message = await signed(rawMessage({ subject: 'sg', body: 'Once only', messageId: '<fixed-id@consulting.example>' }));
  assert.equal((await processMessage(message, deps())).ok, true);
  const again = await processMessage(message, deps());
  assert.equal(again.ok, false);
  assert.equal(again.duplicate, true);
  assert.equal((await board()).tasks.filter((t) => t.title === 'Once only').length, 1);
});

test('a sender address belongs to one user only', async () => {
  await assert.rejects(registry.setSenders(OTHER_SUB, [SENDER]), SenderConflictError);
  assert.deepEqual(await registry.sendersOf(SUB), [SENDER]);
  assert.deepEqual(await registry.setSenders(OTHER_SUB, ['b@other.example']), ['b@other.example']);
  assert.equal(await registry.ownerOf('B@Other.example'), OTHER_SUB);
});

test('night hours poll hourly and resume the day rate when the night ends', () => {
  const config = readInboundConfig({ INBOUND_IMAP_USER: 'u', INBOUND_IMAP_PASSWORD: 'p' });
  assert.deepEqual(config.nightHours, { start: 22, end: 7 });
  const at = (h, m = 0) => new Date(2026, 10, 18, h, m, 0);
  assert.equal(nextPollDelayMs(config, at(9)), 60_000);
  assert.equal(nextPollDelayMs(config, at(21, 59)), 60_000);
  assert.equal(nextPollDelayMs(config, at(22)), 3_600_000);
  assert.equal(nextPollDelayMs(config, at(2, 30)), 3_600_000);
  // 06:30 → next poll at 07:00, not 07:30.
  assert.equal(nextPollDelayMs(config, at(6, 30)), 30 * 60_000);
  assert.equal(nextPollDelayMs(config, at(6, 59)), 60_000);
  assert.equal(nextPollDelayMs(config, at(7)), 60_000);

  const off = readInboundConfig({ INBOUND_IMAP_USER: 'u', INBOUND_IMAP_PASSWORD: 'p', INBOUND_NIGHT_HOURS: '' });
  assert.equal(off.nightHours, null);
  assert.equal(nextPollDelayMs(off, at(2)), 60_000);

  assert.deepEqual(parseNightHours('1-5'), { start: 1, end: 5 });
  assert.equal(parseNightHours('22-22'), null);
  assert.equal(parseNightHours('25-07'), null);
  const sameDay = { pollSeconds: 60, nightHours: parseNightHours('1-5'), nightPollSeconds: 3600 };
  assert.equal(nextPollDelayMs(sameDay, at(0, 30)), 60_000);
  assert.equal(nextPollDelayMs(sameDay, at(4, 30)), 30 * 60_000);
});

test('processed mail is kept for INBOUND_RETENTION_DAYS (default 30, 0 = forever)', () => {
  const env = { INBOUND_IMAP_USER: 'u', INBOUND_IMAP_PASSWORD: 'p' };
  assert.equal(readInboundConfig(env).retentionDays, 30);
  assert.deepEqual(retentionCutoff(30, NOW), new Date(2026, 9, 19, 9, 0, 0));
  assert.equal(retentionCutoff(0, NOW), null);
  assert.equal(retentionCutoff(readInboundConfig({ ...env, INBOUND_RETENTION_DAYS: '0' }).retentionDays, NOW), null);
});
