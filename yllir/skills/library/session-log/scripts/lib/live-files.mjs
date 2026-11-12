// File layer of the live session log: paths under <root>/.campaign/state/live/,
// atomic JSON writes and the session id rules. Nothing here knows about entries.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** A session id is the date, optionally with a -2, -3... suffix for the same day. */
export const SESSION_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/;

/** Returns a failure object in the framework shape. */
export function fail(code, message) {
  return { ok: false, error: { code, message } };
}

/** Folder that holds every live file of the campaign. Never anything outside it. */
export function liveDir(root) {
  return path.join(root, '.campaign', 'state', 'live');
}

/** Folder of one session. The id must already be validated by the caller. */
export function sessionDir(root, sessionId) {
  return path.join(liveDir(root), sessionId);
}

/** A campaign is a folder with a campaign.yaml file. Nothing is written without it. */
export function isCampaignRoot(root) {
  if (typeof root !== 'string' || root === '') return false;
  try {
    return fs.statSync(path.join(root, 'campaign.yaml')).isFile();
  } catch {
    return false;
  }
}

/**
 * Reads a JSON file. A missing file is not an error: it returns `{ ok: true, value: null }`.
 * A file that is not valid JSON returns the code `corrupt-state`.
 */
export function readJson(file) {
  const name = path.basename(file);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, value: null };
    return fail('read-failed', `Could not read ${name}: ${err.message}`);
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return fail('corrupt-state', `${name} is damaged and cannot be read.`);
  }
}

/**
 * Writes a JSON file atomically: a temporary file in the same folder, then a rename.
 * The file gets mode 0600. The temporary file is removed when anything fails.
 */
export function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  const name = path.basename(file);
  const tmp = path.join(dir, `.${name}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // The temporary file could not be removed; the save error below is what matters.
    }
    return fail('write-failed', `Could not save ${name}: ${err.message}`);
  }
}

/** Orders session ids by date, then by suffix (no suffix counts as 1). */
export function compareSessionIds(a, b) {
  const ma = SESSION_ID_PATTERN.exec(a);
  const mb = SESSION_ID_PATTERN.exec(b);
  if (ma[1] !== mb[1]) return ma[1] < mb[1] ? -1 : 1;
  return Number(ma[2] ?? 1) - Number(mb[2] ?? 1);
}

/** Every session folder of the campaign, oldest first. */
export function listSessionIds(root) {
  let names;
  try {
    names = fs.readdirSync(liveDir(root));
  } catch {
    return [];
  }
  return names
    .filter((name) => SESSION_ID_PATTERN.test(name) && fs.statSync(path.join(liveDir(root), name)).isDirectory())
    .sort(compareSessionIds);
}

/** First free id for a date: the date itself, then the date with -2, -3... */
export function nextSessionId(root, date) {
  let candidate = date;
  let n = 2;
  while (fs.existsSync(sessionDir(root, candidate))) {
    candidate = `${date}-${n}`;
    n += 1;
  }
  return candidate;
}
