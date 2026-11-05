// Per-user data.json storage shared by /api/data and /mcp. Writes are atomic
// (tmp file + rename) and serialised per user, and every version has an ETag
// so clients can detect that someone else changed the document.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const EMPTY_DOCUMENT = JSON.stringify({ version: 1, customers: [], tasks: [] });

export function etagOf(text) {
  return `"${crypto.createHash('sha256').update(text).digest('base64url')}"`;
}

export function createStorage(dataDir) {
  const locks = new Map();
  const seenUsers = new Set();

  const fileOf = (sub) => path.join(dataDir, sub, 'data.json');

  // Runs fn while holding this user's lock. Calls for the same user run one
  // after another; calls for different users run independently.
  function withLock(sub, fn) {
    const previous = locks.get(sub) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(sub, tail);
    tail.then(() => { if (locks.get(sub) === tail) locks.delete(sub); });
    return run;
  }

  // Returns { text, etag, exists }.
  async function read(sub) {
    const file = fileOf(sub);
    try {
      const text = await fs.readFile(file, 'utf8');
      return { text, etag: etagOf(text), exists: true };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!seenUsers.has(sub)) {
        seenUsers.add(sub);
        console.log(`No stored data for user sub=${sub}; expected at ${file}`);
      }
      return { text: EMPTY_DOCUMENT, etag: etagOf(EMPTY_DOCUMENT), exists: false };
    }
  }

  // Writes text (string or Buffer) atomically; returns the new ETag.
  async function write(sub, text) {
    const userDir = path.join(dataDir, sub);
    await fs.mkdir(userDir, { recursive: true, mode: 0o700 });
    const tmp = path.join(userDir, `.data.json.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
      const handle = await fs.open(tmp, 'wx', 0o600);
      try {
        await handle.writeFile(text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, fileOf(sub));
    } catch (error) {
      await fs.rm(tmp, { force: true });
      throw error;
    }
    return etagOf(text);
  }

  return { withLock, read, write };
}
