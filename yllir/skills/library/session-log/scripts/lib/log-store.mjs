// Live session log: the entries the master's table produces during a session.
// Contract (see master-screen/API.md, "Live session"): every function takes the campaign
// root first, never throws for bad input, and returns { ok: true, ... } or
// { ok: false, error: { code, message } }. The log is not canon: it never reads or writes
// campaign documents, only files under <root>/.campaign/state/live/.

import path from 'node:path';
import {
  SESSION_ID_PATTERN,
  fail,
  isCampaignRoot,
  liveDir,
  nextSessionId,
  readJson,
  sessionDir,
  writeJsonAtomic,
} from './live-files.mjs';
import { today } from '../../../../../scripts/lib/today.mjs';

const KINDS = ['fact', 'decision', 'intention', 'thread'];
const BYS = ['master', 'agent'];
const TEXT_MAX = 2000;
const TITLE_MAX = 120;
const SCENE_MAX = 300;
const SUBJECTS_MAX = 20;
const SUBJECT_MAX = 100;
const ENTRY_ID_PATTERN = /^e-\d{4,}$/;
const PATCH_KEYS = ['text', 'kind', 'scene', 'subjects', 'resolved'];

const ROOT_MESSAGE = 'This folder is not a campaign: there is no campaign file in it.';

function notCampaign() {
  return fail('not-a-campaign', ROOT_MESSAGE);
}

function localNow(now) {
  if (now instanceof Date && !Number.isNaN(now.getTime())) return now;
  return new Date();
}

// ---------------------------------------------------------------------------
// Validators. Each returns { ok: true, value } or a failure object.
// ---------------------------------------------------------------------------

function validateKind(kind) {
  if (!KINDS.includes(kind)) {
    return fail('invalid-kind', `kind must be one of: ${KINDS.join(', ')}.`);
  }
  return { ok: true, value: kind };
}

function validateText(text) {
  if (typeof text !== 'string') return fail('invalid-text', 'text must be a string.');
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > TEXT_MAX) {
    return fail('invalid-text', `text must have between 1 and ${TEXT_MAX} characters after trimming.`);
  }
  return { ok: true, value: trimmed };
}

/**
 * A campaign-relative path: no leading slash, no drive letter, no backslash, no empty
 * segment and no `..` segment. Used for scenes and for the plot session reference.
 */
function relativePathProblem(value) {
  if (typeof value !== 'string') return 'must be a text path';
  if (value.length < 1 || value.length > SCENE_MAX) return `must have between 1 and ${SCENE_MAX} characters`;
  if (value.includes('\0') || value.includes('\\')) return 'must use forward slashes only';
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return 'must be relative to the campaign folder';
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '..')) {
    return 'must not contain empty or ".." parts';
  }
  return null;
}

function validateScene(scene) {
  const problem = relativePathProblem(scene);
  if (problem) return fail('invalid-scene', `scene ${problem}.`);
  return { ok: true, value: scene };
}

function validateSessionRef(ref) {
  const problem = relativePathProblem(ref);
  if (problem) return fail('invalid-session-ref', `session reference ${problem}.`);
  return { ok: true, value: ref };
}

function validateSubjects(subjects) {
  if (!Array.isArray(subjects)) return fail('invalid-subjects', 'subjects must be a list of text values.');
  if (subjects.length > SUBJECTS_MAX) return fail('invalid-subjects', `subjects can hold at most ${SUBJECTS_MAX} values.`);
  const cleaned = [];
  for (const subject of subjects) {
    if (typeof subject !== 'string') return fail('invalid-subjects', 'every subject must be a text value.');
    const trimmed = subject.trim();
    if (trimmed.length < 1 || trimmed.length > SUBJECT_MAX) {
      return fail('invalid-subjects', `every subject must have between 1 and ${SUBJECT_MAX} characters.`);
    }
    if (!cleaned.includes(trimmed)) cleaned.push(trimmed);
  }
  return { ok: true, value: cleaned };
}

function validateResolved(resolved) {
  if (typeof resolved !== 'boolean') return fail('invalid-resolved', 'resolved must be true or false.');
  return { ok: true, value: resolved };
}

function validateBy(by) {
  if (!BYS.includes(by)) return fail('invalid-by', `by must be one of: ${BYS.join(', ')}.`);
  return { ok: true, value: by };
}

function validateTitle(title) {
  if (typeof title !== 'string') return fail('invalid-title', 'title must be a text value.');
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > TITLE_MAX || /[\r\n]/.test(trimmed)) {
    return fail('invalid-title', `title must be one line of between 1 and ${TITLE_MAX} characters.`);
  }
  return { ok: true, value: trimmed };
}

function resolvedNeedsThread(kind) {
  return fail('resolved-not-thread', `resolved applies only to threads, not to a ${kind}.`);
}

// ---------------------------------------------------------------------------
// State helpers.
// ---------------------------------------------------------------------------

const SESSION_FILE = 'session.json';
const LOG_FILE = 'log.json';
const ACTIVE_FILE = 'active.json';

function activeFile(root) {
  return path.join(liveDir(root), ACTIVE_FILE);
}

function emptyLog() {
  return { nextId: 1, entries: [] };
}

/** Reads log.json of one session. A missing file is an empty log. */
function readLog(root, sessionId) {
  const read = readJson(path.join(sessionDir(root, sessionId), LOG_FILE));
  if (!read.ok) return read;
  if (read.value === null) return { ok: true, value: emptyLog() };
  const log = read.value;
  if (!log || !Array.isArray(log.entries) || !Number.isInteger(log.nextId) || log.nextId < 1) {
    return fail('corrupt-state', `${LOG_FILE} of the live session is damaged and cannot be read.`);
  }
  return { ok: true, value: log };
}

/** The active session, or null. A session that has an end time is not active. */
function activeSession(root) {
  if (!isCampaignRoot(root)) return notCampaign();
  const read = readJson(activeFile(root));
  if (!read.ok) return read;
  const sessionId = read.value?.sessionId ?? null;
  if (sessionId === null) return { ok: true, session: null, sessionId: null };
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    return fail('corrupt-state', 'active.json names a session that cannot exist.');
  }
  const session = readJson(path.join(sessionDir(root, sessionId), SESSION_FILE));
  if (!session.ok) return session;
  if (session.value === null || session.value.endedAt) return { ok: true, session: null, sessionId: null };
  return { ok: true, session: session.value, sessionId };
}

/** Like activeSession, but a missing active session is an error for the callers that write. */
function requireActive(root) {
  const active = activeSession(root);
  if (!active.ok) return active;
  if (!active.session) return fail('no-active-session', 'No live session is open. Open one first.');
  return active;
}

// ---------------------------------------------------------------------------
// Contract functions.
// ---------------------------------------------------------------------------

/**
 * Opens a session. Fails with `already-open` when one is active. The id is the local
 * date, with -2, -3... when the same day already has sessions.
 */
export function openSession(root, { title, sessionRef, now } = {}) {
  if (!isCampaignRoot(root)) return notCampaign();
  const current = activeSession(root);
  if (!current.ok) return current;
  if (current.session) {
    return fail('already-open', `The live session ${current.sessionId} is already open. End it first.`);
  }

  const moment = localNow(now);
  const id = nextSessionId(root, today(moment));

  let sessionTitle = id;
  if (title !== undefined) {
    const checked = validateTitle(title);
    if (!checked.ok) return checked;
    sessionTitle = checked.value;
  }
  const session = { id, title: sessionTitle, startedAt: moment.toISOString() };
  if (sessionRef !== undefined) {
    const checked = validateSessionRef(sessionRef);
    if (!checked.ok) return checked;
    session.sessionRef = checked.value;
  }

  // The session files come first and the pointer last, so an interrupted open leaves no active session.
  const saved = [
    writeJsonAtomic(path.join(sessionDir(root, id), SESSION_FILE), session),
    writeJsonAtomic(path.join(sessionDir(root, id), LOG_FILE), emptyLog()),
    writeJsonAtomic(activeFile(root), { sessionId: id }),
  ].find((result) => !result.ok);
  if (saved) return saved;
  return { ok: true, session };
}

/** The active session as { session | null }. */
export function getActive(root) {
  const active = activeSession(root);
  if (!active.ok) return active;
  return { ok: true, session: active.session };
}

/**
 * Adds one entry to the active session. Ids run e-0001, e-0002... and are never reused
 * inside a session, even after a removal, because log.json keeps nextId.
 */
export function addEntry(root, { kind, text, scene, subjects, by, resolved, now } = {}) {
  const active = requireActive(root);
  if (!active.ok) return active;

  const checkedKind = validateKind(kind);
  if (!checkedKind.ok) return checkedKind;
  const checkedText = validateText(text);
  if (!checkedText.ok) return checkedText;

  const entry = { kind: checkedKind.value, text: checkedText.value };
  if (scene !== undefined) {
    const checked = validateScene(scene);
    if (!checked.ok) return checked;
    entry.scene = checked.value;
  }
  if (subjects !== undefined) {
    const checked = validateSubjects(subjects);
    if (!checked.ok) return checked;
    entry.subjects = checked.value;
  }
  if (resolved !== undefined) {
    if (kind !== 'thread') return resolvedNeedsThread(kind);
    const checked = validateResolved(resolved);
    if (!checked.ok) return checked;
    entry.resolved = checked.value;
  }
  const checkedBy = validateBy(by ?? 'master');
  if (!checkedBy.ok) return checkedBy;

  const log = readLog(root, active.sessionId);
  if (!log.ok) return log;
  const numbered = {
    id: `e-${String(log.value.nextId).padStart(4, '0')}`,
    at: localNow(now).toISOString(),
    ...entry,
    by: checkedBy.value,
  };
  const saved = writeJsonAtomic(path.join(sessionDir(root, active.sessionId), LOG_FILE), {
    nextId: log.value.nextId + 1,
    entries: [...log.value.entries, numbered],
  });
  if (!saved.ok) return saved;
  return { ok: true, entry: numbered };
}

/**
 * Changes one entry of the active session. patch: text, kind, scene, subjects, resolved.
 * A null scene or subjects removes it. resolved is kept only for threads.
 */
export function updateEntry(root, id, patch = {}) {
  const active = requireActive(root);
  if (!active.ok) return active;
  if (typeof id !== 'string' || !ENTRY_ID_PATTERN.test(id)) return fail('invalid-id', 'id must look like e-0001.');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return fail('invalid-patch', 'patch must be an object with the fields to change.');
  }
  const keys = Object.keys(patch).filter((key) => patch[key] !== undefined);
  if (keys.length === 0) return fail('invalid-patch', 'patch must change at least one field.');
  const unknown = keys.filter((key) => !PATCH_KEYS.includes(key));
  if (unknown.length > 0) return fail('invalid-patch', `patch has fields that cannot change: ${unknown.join(', ')}.`);

  const log = readLog(root, active.sessionId);
  if (!log.ok) return log;
  const index = log.value.entries.findIndex((entry) => entry.id === id);
  if (index === -1) return fail('entry-not-found', `No entry ${id} in the live session.`);

  const next = { ...log.value.entries[index] };
  if (patch.kind !== undefined) {
    const checked = validateKind(patch.kind);
    if (!checked.ok) return checked;
    next.kind = checked.value;
    if (next.kind !== 'thread') delete next.resolved;
  }
  if (patch.text !== undefined) {
    const checked = validateText(patch.text);
    if (!checked.ok) return checked;
    next.text = checked.value;
  }
  if (patch.scene !== undefined) {
    if (patch.scene === null) {
      delete next.scene;
    } else {
      const checked = validateScene(patch.scene);
      if (!checked.ok) return checked;
      next.scene = checked.value;
    }
  }
  if (patch.subjects !== undefined) {
    if (patch.subjects === null) {
      delete next.subjects;
    } else {
      const checked = validateSubjects(patch.subjects);
      if (!checked.ok) return checked;
      next.subjects = checked.value;
    }
  }
  if (patch.resolved !== undefined) {
    if (next.kind !== 'thread') return resolvedNeedsThread(next.kind);
    const checked = validateResolved(patch.resolved);
    if (!checked.ok) return checked;
    next.resolved = checked.value;
  }

  const entries = [...log.value.entries];
  entries[index] = next;
  const saved = writeJsonAtomic(path.join(sessionDir(root, active.sessionId), LOG_FILE), {
    nextId: log.value.nextId,
    entries,
  });
  if (!saved.ok) return saved;
  return { ok: true, entry: next };
}

/** Removes one entry of the active session. Its id is not given to a later entry. */
export function removeEntry(root, id) {
  const active = requireActive(root);
  if (!active.ok) return active;
  if (typeof id !== 'string' || !ENTRY_ID_PATTERN.test(id)) return fail('invalid-id', 'id must look like e-0001.');

  const log = readLog(root, active.sessionId);
  if (!log.ok) return log;
  const removed = log.value.entries.find((entry) => entry.id === id);
  if (!removed) return fail('entry-not-found', `No entry ${id} in the live session.`);

  const saved = writeJsonAtomic(path.join(sessionDir(root, active.sessionId), LOG_FILE), {
    nextId: log.value.nextId,
    entries: log.value.entries.filter((entry) => entry.id !== id),
  });
  if (!saved.ok) return saved;
  return { ok: true, entry: removed };
}

/** Entries of the active session, oldest first. Without an active session the list is empty. */
export function listEntries(root) {
  const active = activeSession(root);
  if (!active.ok) return active;
  if (!active.session) return { ok: true, entries: [] };
  const log = readLog(root, active.sessionId);
  if (!log.ok) return log;
  return { ok: true, entries: log.value.entries };
}

/** Ends the active session. Its files are kept; active.json no longer points to it. */
export function endSession(root, { now } = {}) {
  const active = requireActive(root);
  if (!active.ok) return active;

  const session = { ...active.session, endedAt: localNow(now).toISOString() };
  const saved = [
    writeJsonAtomic(path.join(sessionDir(root, active.sessionId), SESSION_FILE), session),
    writeJsonAtomic(activeFile(root), { sessionId: null }),
  ].find((result) => !result.ok);
  if (saved) return saved;
  return { ok: true, session };
}

/** Reads any session of the campaign, active or ended: { session, entries }. */
export function readSession(root, sessionId) {
  if (!isCampaignRoot(root)) return notCampaign();
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    return fail('invalid-session-id', 'session id must look like 2026-11-12 or 2026-11-12-2.');
  }
  const session = readJson(path.join(sessionDir(root, sessionId), SESSION_FILE));
  if (!session.ok) return session;
  if (session.value === null) return fail('session-not-found', `No live session ${sessionId}.`);
  const log = readLog(root, sessionId);
  if (!log.ok) return log;
  return { ok: true, session: session.value, entries: log.value.entries };
}
