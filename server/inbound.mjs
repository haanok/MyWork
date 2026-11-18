// Email-to-task inbox. A dedicated mailbox (for example on Purelymail) is
// polled over IMAP. Each message becomes a task when:
//   - its From address is registered by a MyWork user (/api/inbound), and
//   - it carries a valid DKIM signature aligned with the From domain
//     (verified here from the raw message, so forged senders are refused).
// The subject picks the customer with the same syntax as quick add:
//   "acme"                      → task on Acme, title from the first body line
//   "acme: call Per fri !"      → title "call Per", due Friday, high priority
// Unknown customers land on an "Inbox" customer. Forward prefixes (Fw:, VS:…)
// are ignored. Processed messages are moved to MyWork/Imported or
// MyWork/Rejected so the inbox only holds what is still to do.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { simpleParser } from 'mailparser';
import { dkimVerify } from 'mailauth';

const MAX_DESCRIPTION = 8000;
const MAX_TITLE = 160;
const MAX_SENDERS = 10;
const MAX_REMEMBERED_IDS = 300;
export const INBOX_CUSTOMER_NAME = 'Inbox';

// ---------------------------------------------------------------------------
// Dates (local YYYY-MM-DD, like src/dates.ts). Set TZ for the container.

const toISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (days, now) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return toISODate(d);
};

const WEEKDAYS = {
  sun: 0, sunday: 0, 'søn': 0, 'søndag': 0,
  mon: 1, monday: 1, man: 1, mandag: 1,
  tue: 2, tues: 2, tuesday: 2, tir: 2, tirsdag: 2,
  wed: 3, wednesday: 3, ons: 3, onsdag: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, tor: 4, torsdag: 4,
  fri: 5, friday: 5, fre: 5, fredag: 5,
  sat: 6, saturday: 6, 'lør': 6, 'lørdag': 6,
};

// Same rules as parseDueWord in src/quickAddParse.ts.
export function parseDueWord(word, now = new Date()) {
  const w = word.toLowerCase().replace(/[.,;]$/, '');
  if (w === 'today' || w === 'idag') return addDays(0, now);
  if (w === 'tomorrow' || w === 'tmr' || w === 'imorgen' || w === 'imorra') return addDays(1, now);
  if (w in WEEKDAYS) return addDays((WEEKDAYS[w] - now.getDay() + 7) % 7 || 7, now);
  const rel = /^\+(\d{1,3})d?$/.exec(w) ?? /^(\d{1,3})d$/.exec(w);
  if (rel) return addDays(Number(rel[1]), now);
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return Number.isNaN(Date.parse(w)) ? undefined : w;
  const dm = /^(\d{1,2})[./](\d{1,2})$/.exec(w);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]) - 1;
    if (month < 0 || month > 11 || day < 1 || day > 31) return undefined;
    let d = new Date(now.getFullYear(), month, day);
    if (d.getMonth() !== month) return undefined;
    if (toISODate(d) < toISODate(now)) d = new Date(now.getFullYear() + 1, month, day);
    return toISODate(d);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Subject parsing

const FORWARD_PREFIX = /^\s*(?:(?:fwd?|fw|vs|vb|wg|tr|re|sv|aw|antw)\s*:\s*)+/i;

export function stripSubjectPrefixes(subject) {
  return (subject ?? '').replace(FORWARD_PREFIX, '').replace(/\s+/g, ' ').trim();
}

// Mirrors findCustomer in src/quickAddParse.ts: short name, exact name,
// start of the name, then any part of it. Returns null unless exactly one.
export function findCustomer(text, customers) {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  const live = customers.filter((c) => c.status !== 'archived');
  const pool = live.length ? live : customers;
  const short = customers.filter((c) => (c.shortName ?? '').toLowerCase() === q);
  if (short.length === 1) return short[0];
  if (short.length > 1) return null;
  const exact = pool.filter((c) => (c.name ?? '').trim().toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const starts = pool.filter((c) => (c.name ?? '').toLowerCase().startsWith(q));
  const matches = starts.length ? starts : pool.filter((c) => (c.name ?? '').toLowerCase().includes(q));
  return matches.length === 1 ? matches[0] : null;
}

// Splits trailing "!" and due words off a title, like quick add.
function parseTitleTail(text, now) {
  let words = text.trim().split(/\s+/).filter(Boolean);
  let priority = 'normal';
  let due;
  for (let i = 0; i < 3 && words.length > 0; i++) {
    const last = words[words.length - 1];
    if (last === '!') { priority = 'high'; words = words.slice(0, -1); continue; }
    if (last.endsWith('!') && last.length > 1 && priority === 'normal') {
      priority = 'high';
      words[words.length - 1] = last.slice(0, -1);
      continue;
    }
    if (!due && words.length > 1) {
      const parsed = parseDueWord(last, now);
      if (parsed) { due = parsed; words = words.slice(0, -1); continue; }
    }
    break;
  }
  return { title: words.join(' '), due, priority };
}

/**
 * Reads the subject: "customer" or "customer: title [due] [!]". Returns the
 * matched customer (or null), the customer text and the title parts.
 */
export function parseSubject(subject, customers, now = new Date()) {
  const clean = stripSubjectPrefixes(subject);
  const colon = clean.indexOf(':');
  if (colon > 0) {
    const customerText = clean.slice(0, colon).trim();
    const customer = findCustomer(customerText, customers);
    if (customer) return { customer, customerText, ...parseTitleTail(clean.slice(colon + 1), now) };
  }
  const customer = findCustomer(clean, customers);
  if (customer) return { customer, customerText: clean, title: '', priority: 'normal' };
  return { customer: null, customerText: colon > 0 ? clean.slice(0, colon).trim() : clean, ...parseTitleTail(clean, now) };
}

// ---------------------------------------------------------------------------
// Body

/** Plain text of the message, without signatures and quoted replies. */
export function cleanBody(text) {
  const lines = (text ?? '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^-- ?$/.test(line)) break; // signature separator
    if (/^_{8,}\s*$/.test(line)) break; // Outlook reply separator
    if (/^-{2,}\s*(original message|opprinnelig melding|videresendt melding|forwarded message)/i.test(line)) break;
    if (/^>/.test(line)) continue;
    out.push(line.replace(/\s+$/, ''));
  }
  const joined = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return joined.length > MAX_DESCRIPTION ? `${joined.slice(0, MAX_DESCRIPTION - 1)}…` : joined;
}

function firstLine(text) {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line;
}

// ---------------------------------------------------------------------------
// Sender registry: /data/inbound.json maps sender addresses to Pocket ID subs
// and remembers recently imported Message-IDs per user.

export const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();
const EMAIL_PATTERN = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
export const isEmail = (value) => EMAIL_PATTERN.test(value) && value.length <= 254;

export class SenderConflictError extends Error {}

export function createRegistry(dataDir) {
  const file = path.join(dataDir, 'inbound.json');
  let chain = Promise.resolve();
  const locked = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  async function load() {
    try {
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      return {
        senders: value && typeof value.senders === 'object' && value.senders ? value.senders : {},
        seen: value && typeof value.seen === 'object' && value.seen ? value.seen : {},
      };
    } catch (error) {
      if (error.code === 'ENOENT') return { senders: {}, seen: {} };
      throw error;
    }
  }

  async function save(value) {
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  return {
    async sendersOf(sub) {
      const { senders } = await load();
      return Object.entries(senders).filter(([, owner]) => owner === sub).map(([email]) => email).sort();
    },
    async ownerOf(email) {
      const { senders } = await load();
      return senders[normalizeEmail(email)] ?? null;
    },
    /** Replaces the user's senders. Throws SenderConflictError if another user has one. */
    setSenders(sub, emails) {
      return locked(async () => {
        const value = await load();
        const wanted = [...new Set(emails.map(normalizeEmail))];
        const taken = wanted.filter((email) => value.senders[email] && value.senders[email] !== sub);
        if (taken.length) throw new SenderConflictError(`Already registered by another user: ${taken.join(', ')}`);
        for (const [email, owner] of Object.entries(value.senders)) if (owner === sub) delete value.senders[email];
        for (const email of wanted) value.senders[email] = sub;
        await save(value);
        return wanted.sort();
      });
    },
    hasSeen(sub, messageId) {
      return locked(async () => (await load()).seen[sub]?.includes(messageId) ?? false);
    },
    markSeen(sub, messageId) {
      return locked(async () => {
        const value = await load();
        const list = (value.seen[sub] ?? []).filter((id) => id !== messageId);
        list.push(messageId);
        value.seen[sub] = list.slice(-MAX_REMEMBERED_IDS);
        await save(value);
      });
    },
  };
}

export const MAX_SENDERS_PER_USER = MAX_SENDERS;

// ---------------------------------------------------------------------------
// One message → one task

function domainOf(email) {
  return email.split('@').pop() ?? '';
}

function parseDocument(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.customers)) throw new Error('Stored data has an unexpected shape.');
  if (!Array.isArray(data.tasks)) data.tasks = [];
  return data;
}

function inboxCustomer(data, stamp) {
  const existing = data.customers.find((c) => (c.name ?? '').trim().toLowerCase() === INBOX_CUSTOMER_NAME.toLowerCase());
  if (existing) {
    if (existing.status === 'archived') existing.status = 'active';
    return existing;
  }
  const shortTaken = data.customers.some((c) => (c.shortName ?? '').toLowerCase() === 'inbox');
  const customer = {
    id: crypto.randomUUID(),
    name: INBOX_CUSTOMER_NAME,
    ...(shortTaken ? {} : { shortName: 'inbox' }),
    status: 'active',
    notes: 'Tasks from email whose subject did not match a customer. Move them to the right customer.',
    contacts: [],
    createdAt: stamp,
    touchedAt: stamp,
  };
  data.customers.push(customer);
  return customer;
}

/**
 * Turns one raw RFC 822 message into a task. Returns
 * { ok: true, sub, taskId, customer } or { ok: false, reason }.
 * `resolver` is passed to DKIM verification (tests use a fake DNS).
 */
export async function processMessage(raw, { registry, storage, requireDkim = true, resolver, now = new Date() }) {
  const mail = await simpleParser(raw, { skipImageLinks: true });
  const from = normalizeEmail(mail.from?.value?.[0]?.address);
  if (!from || !isEmail(from)) return { ok: false, reason: 'no valid From address' };
  if (mail.from?.value?.length !== 1) return { ok: false, reason: 'message has several From addresses' };

  const sub = await registry.ownerOf(from);
  if (!sub) return { ok: false, reason: `sender ${from} is not registered` };

  if (requireDkim) {
    const dkim = await dkimVerify(raw, resolver ? { resolver } : {});
    const fromDomain = domainOf(from);
    const passed = (dkim.results ?? []).some((r) => r.status?.result === 'pass' && r.status?.aligned);
    if (!passed) {
      const seen = (dkim.results ?? []).map((r) => `${r.signingDomain || '?'}=${r.status?.result}${r.status?.aligned ? '' : ' (not aligned)'}`).join(', ');
      return { ok: false, reason: `no valid DKIM signature for ${fromDomain}${seen ? ` (${seen})` : ' (unsigned)'}` };
    }
  }

  const messageId = (mail.messageId || crypto.createHash('sha256').update(raw).digest('hex')).trim();
  if (await registry.hasSeen(sub, messageId)) return { ok: false, reason: 'already imported', duplicate: true };

  const body = cleanBody(mail.text || '');
  const result = await storage.withLock(sub, async () => {
    const data = parseDocument((await storage.read(sub)).text);
    const stamp = now.toISOString();
    const parsed = parseSubject(mail.subject ?? '', data.customers, now);
    const customer = parsed.customer ?? inboxCustomer(data, stamp);
    let title = parsed.title || firstLine(body) || stripSubjectPrefixes(mail.subject) || `Email from ${mail.from.value[0].name || from}`;
    if (!parsed.customer && parsed.customerText && !parsed.title) title = parsed.customerText;
    if (title.length > MAX_TITLE) title = `${title.slice(0, MAX_TITLE - 1)}…`;
    const task = {
      id: crypto.randomUUID(),
      customerId: customer.id,
      title,
      ...(body ? { description: body } : {}),
      status: 'open',
      priority: parsed.priority ?? 'normal',
      ...(parsed.due ? { due: parsed.due } : {}),
      createdAt: stamp,
      updatedAt: stamp,
    };
    data.tasks.push(task);
    customer.touchedAt = stamp;
    await storage.write(sub, JSON.stringify(data));
    return { taskId: task.id, customer: customer.name, matched: Boolean(parsed.customer) };
  });
  await registry.markSeen(sub, messageId);
  return { ok: true, sub, ...result };
}

// ---------------------------------------------------------------------------
// IMAP poller

const IMPORTED_FOLDER = 'MyWork/Imported';
const REJECTED_FOLDER = 'MyWork/Rejected';

export function readInboundConfig(env = process.env) {
  const user = env.INBOUND_IMAP_USER?.trim() || '';
  const password = env.INBOUND_IMAP_PASSWORD || '';
  const enabled = Boolean(user && password);
  return {
    enabled,
    host: env.INBOUND_IMAP_HOST?.trim() || 'imap.purelymail.com',
    port: Number(env.INBOUND_IMAP_PORT || 993),
    user,
    password,
    address: env.INBOUND_ADDRESS?.trim() || user,
    pollSeconds: Number(env.INBOUND_POLL_SECONDS ?? 60),
    nightHours: parseNightHours(env.INBOUND_NIGHT_HOURS ?? '22-07'),
    nightPollSeconds: Number(env.INBOUND_NIGHT_POLL_SECONDS ?? 3600),
    retentionDays: Number(env.INBOUND_RETENTION_DAYS ?? 30),
    requireDkim: !/^(0|false|no)$/i.test(env.INBOUND_REQUIRE_DKIM?.trim() || 'true'),
  };
}

/** Parses "22-07" (local hours, end exclusive) into { start, end }; empty or invalid → null (no night mode). */
export function parseNightHours(value) {
  const match = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > 23 || end > 23 || start === end) return null;
  return { start, end };
}

function inNight(hours, hour) {
  return hours.start < hours.end
    ? hour >= hours.start && hour < hours.end
    : hour >= hours.start || hour < hours.end;
}

/**
 * Milliseconds until the next poll. During night hours (local time, TZ) the
 * night interval applies, but never past the end of the night, so the first
 * daytime poll happens at e.g. 07:00 sharp.
 */
export function nextPollDelayMs(config, now = new Date()) {
  const day = Math.max(15, config.pollSeconds) * 1000;
  const hours = config.nightHours;
  if (!hours || !(config.nightPollSeconds > config.pollSeconds) || !inNight(hours, now.getHours())) return day;
  const nightEnd = new Date(now);
  nightEnd.setHours(hours.end, 0, 0, 0);
  if (nightEnd <= now) nightEnd.setDate(nightEnd.getDate() + 1);
  return Math.max(day, Math.min(config.nightPollSeconds * 1000, nightEnd - now));
}

async function ensureFolder(client, folder) {
  try {
    await client.mailboxCreate(folder.split('/'));
  } catch (error) {
    if (!/exist/i.test(`${error.responseText ?? ''} ${error.message ?? ''}`) && error.serverResponseCode !== 'ALREADYEXISTS') throw error;
  }
}

/** Cut-off for retention: messages that arrived before this date are deleted; null = keep forever. */
export function retentionCutoff(retentionDays, now = new Date()) {
  if (!(retentionDays > 0)) return null;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

/** Permanently deletes messages that arrived before `cutoff` from the Imported/Rejected folders. Never touches INBOX. */
async function purgeOldMessages(client, cutoff) {
  let deleted = 0;
  for (const folder of [IMPORTED_FOLDER, REJECTED_FOLDER]) {
    const lock = await client.getMailboxLock(folder);
    try {
      const uids = await client.search({ before: cutoff }, { uid: true });
      if (uids?.length) {
        await client.messageDelete(uids, { uid: true });
        deleted += uids.length;
      }
    } finally {
      lock.release();
    }
  }
  return deleted;
}

/**
 * Connects, imports every unseen message in INBOX, and logs out. With
 * `options.purge`, also deletes old messages from the MyWork folders
 * (INBOUND_RETENTION_DAYS); a failed purge is logged, not thrown.
 */
export async function pollOnce(config, deps, options = {}) {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.port === 993,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  await client.connect();
  const summary = { imported: 0, rejected: 0 };
  try {
    await ensureFolder(client, IMPORTED_FOLDER);
    await ensureFolder(client, REJECTED_FOLDER);
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of uids || []) {
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!message?.source) continue;
        let outcome;
        try {
          outcome = await processMessage(message.source, { ...deps, requireDkim: config.requireDkim });
        } catch (error) {
          console.error(`Inbound mail uid=${uid} failed:`, error.message);
          continue; // left unseen in INBOX; retried next poll
        }
        if (outcome.ok) {
          summary.imported++;
          console.log(`Inbound mail uid=${uid} → task ${outcome.taskId} on ${outcome.customer}${outcome.matched ? '' : ' (no customer matched)'}`);
        } else if (outcome.duplicate) {
          console.log(`Inbound mail uid=${uid} already imported; moving it`);
        } else {
          summary.rejected++;
          console.log(`Inbound mail uid=${uid} rejected: ${outcome.reason}`);
        }
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        await client.messageMove(String(uid), outcome.ok || outcome.duplicate ? IMPORTED_FOLDER : REJECTED_FOLDER, { uid: true });
      }
    } finally {
      lock.release();
    }
    const cutoff = options.purge ? retentionCutoff(config.retentionDays) : null;
    if (cutoff) {
      try {
        summary.purged = await purgeOldMessages(client, cutoff);
        if (summary.purged) console.log(`Inbound mail: deleted ${summary.purged} message(s) older than ${config.retentionDays} days from MyWork folders`);
      } catch (error) {
        console.error('Inbound mail cleanup failed:', error.message);
      }
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return summary;
}

/** Polls every config.pollSeconds; 0 disables polling. Returns a stop function. */
export function startInboundPoller(config, deps) {
  if (!config.enabled || !(config.pollSeconds > 0)) return () => {};
  let timer;
  let stopped = false;
  let failures = 0;
  let lastPurge = 0;
  const tick = async () => {
    try {
      // Clean up at most once a day (first successful poll after start, then every 24 h).
      const purge = config.retentionDays > 0 && Date.now() - lastPurge >= 24 * 3600 * 1000;
      await pollOnce(config, deps, { purge });
      if (purge) lastPurge = Date.now(); // a failed cleanup is retried tomorrow, not every poll
      if (failures) console.log('Inbound mail: connection restored');
      failures = 0;
    } catch (error) {
      failures++;
      if (failures === 1 || failures % 30 === 0) console.error(`Inbound mail poll failed (${failures}x):`, error.message);
    }
    if (!stopped) timer = setTimeout(tick, nextPollDelayMs(config));
  };
  timer = setTimeout(tick, 2000);
  console.log(`Inbound mail enabled: ${config.address} via ${config.host} every ${config.pollSeconds}s${config.nightHours && config.nightPollSeconds > config.pollSeconds ? ` (${config.nightPollSeconds}s between ${String(config.nightHours.start).padStart(2, '0')}-${String(config.nightHours.end).padStart(2, '0')})` : ''}${config.retentionDays > 0 ? `, keeping MyWork folders ${config.retentionDays} days` : ''}${config.requireDkim ? '' : ' (DKIM NOT required)'}`);
  return () => { stopped = true; clearTimeout(timer); };
}
