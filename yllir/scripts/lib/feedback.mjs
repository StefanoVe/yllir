// Append-only local log of usage feedback, one JSON object per line, in
// <root>/.campaign/state/feedback/events.jsonl. It stores no master text and no
// campaign content: only event types, counts, outcomes, frictions, timings and
// at most MAX_DETAIL characters of free text written by the assistant.
// The writing functions never throw: they return { ok, error } instead.

import fs from 'node:fs';
import path from 'node:path';

export const OUTCOMES = ['ok', 'partial', 'blocked'];
export const FRICTIONS = [
  'none',
  'slow',
  'unclear-instruction',
  'script-error',
  'too-many-steps',
  'wrong-process',
  'other',
];
export const EVENT_TYPES = ['turn', 'end', 'note'];
export const MAX_DETAIL = 200;

const MAX_RECENT_NOTES = 5;

/** Absolute path of the feedback log for a campaign root. */
export function feedbackFile(root) {
  return path.join(path.resolve(root), '.campaign', 'state', 'feedback', 'events.jsonl');
}

/** Appends one validated event. Returns { ok: true } or { ok: false, error }. Never throws. */
export function recordEvent(root, event) {
  try {
    const checked = checkEvent(event);
    if (!checked.ok) return checked;
    const { type, ...rest } = checked.fields;
    const record = { type, ts: new Date().toISOString(), ...rest };
    const file = feedbackFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + '\n');
    return { ok: true };
  } catch (error) {
    return fail(errorText(error));
  }
}

/** All events in file order. A missing file gives []; unparsable lines are skipped. */
export function readEvents(root) {
  let text;
  try {
    text = fs.readFileSync(feedbackFile(root), 'utf8');
  } catch {
    return [];
  }
  const events = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const value = JSON.parse(line);
      if (isObject(value)) events.push(value);
    } catch {
      // A corrupt line is skipped; the rest of the log stays readable.
    }
  }
  return events;
}

/** The last turn event (only one with the given session, when a session is given), or null. */
export function latestTurn(root, session) {
  try {
    const events = readEvents(root);
    const index = lastTurnIndex(events, session);
    return index === -1 ? null : events[index];
  } catch {
    return null;
  }
}

/** Session of the last turn event, or 'none'. */
export function latestSession(root) {
  try {
    const turn = latestTurn(root);
    return turn && typeof turn.session === 'string' ? turn.session : 'none';
  } catch {
    return 'none';
  }
}

/**
 * Records the end of the latest turn: duration, and status, model and files
 * from the runner's result.txt when that file was written after the turn.
 * At most one end per turn. Returns { ok: true, skipped: true } when skipped.
 * Never throws.
 */
export function recordEnd(root, { session, agent, version, process: proc } = {}) {
  try {
    const events = readEvents(root);
    const turnIndex = lastTurnIndex(events, session);
    if (turnIndex === -1) return { ok: true, skipped: true };
    const turn = events[turnIndex];
    const sessionId = typeof session === 'string' ? session : turn.session;

    const alreadyEnded = events
      .slice(turnIndex + 1)
      .some((event) => event.type === 'end' && event.session === sessionId);
    if (alreadyEnded) return { ok: true, skipped: true };

    const end = { type: 'end', session: sessionId, agent, version, process: proc };
    const elapsed = Math.floor((Date.now() - Date.parse(turn.ts)) / 1000);
    if (Number.isFinite(elapsed)) end.duration_s = Math.max(0, elapsed);
    Object.assign(end, readResult(root, turn.ts));
    return recordEvent(root, end);
  } catch (error) {
    return fail(errorText(error));
  }
}

/** Plain-text summary of events, lines joined with newlines, no trailing newline. */
export function summarize(events) {
  const list = (Array.isArray(events) ? events : []).filter(isObject);
  const turns = list.filter((event) => event.type === 'turn');
  const ends = list.filter((event) => event.type === 'end');
  const notes = list.filter((event) => event.type === 'note');

  const durations = ends
    .map((event) => event.duration_s)
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);
  const durationLine =
    durations.length === 0
      ? 'duration (s): median n/a, max n/a'
      : `duration (s): median ${median(durations)}, max ${durations[durations.length - 1]}`;

  const statuses = countLines(ends.map((event) => event.status).filter(isText));
  const frictions = countLines(notes.map((event) => event.friction).filter(isText));
  const outcomes = countLines(notes.map((event) => event.outcome).filter(isText));
  const recent = notes.slice(-MAX_RECENT_NOTES).reverse().map((note) => {
    const parts = [note.ts, note.outcome, note.friction, note.detail].filter(isText);
    return `  ${parts.join(' ')}`;
  });

  return [
    `requests: ${turns.length}`,
    `ended: ${ends.length}`,
    durationLine,
    'by status:',
    ...orNone(statuses),
    'by friction:',
    ...orNone(frictions),
    'outcomes:',
    ...orNone(outcomes),
    'recent notes:',
    ...orNone(recent),
  ].join('\n');
}

// ---------------------------------------------------------------------------

function fail(error) {
  return { ok: false, error };
}

function errorText(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0].slice(0, 200);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string' && value !== '';
}

/** Index of the last turn event (with the given session, when given), or -1. */
function lastTurnIndex(events, session) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type !== 'turn') continue;
    if (session !== undefined && session !== null && event.session !== session) continue;
    return i;
  }
  return -1;
}

/** Validates an event. Returns { ok: true, fields } with only the known fields, or { ok: false, error }. */
function checkEvent(event) {
  if (!isObject(event)) return fail('event must be an object');
  const type = event.type;
  if (!EVENT_TYPES.includes(type)) return fail(`type must be one of ${EVENT_TYPES.join(', ')}`);

  const fields = { type };
  copyStrings(event, fields, ['session', 'agent', 'version']);

  if (type === 'turn') {
    copyStrings(event, fields, ['topic']);
  }

  if (type === 'end') {
    copyStrings(event, fields, ['process', 'status', 'model']);
    for (const key of ['files', 'duration_s']) {
      if (event[key] === undefined || event[key] === null) continue;
      if (!Number.isFinite(event[key])) return fail(`${key} must be a number`);
      fields[key] = event[key];
    }
  }

  if (type === 'note') {
    if (!OUTCOMES.includes(event.outcome)) return fail(`outcome must be one of ${OUTCOMES.join(', ')}`);
    if (!FRICTIONS.includes(event.friction)) return fail(`friction must be one of ${FRICTIONS.join(', ')}`);
    fields.outcome = event.outcome;
    fields.friction = event.friction;
    if (typeof event.detail === 'string') fields.detail = cleanDetail(event.detail);
  }

  return { ok: true, fields };
}

function copyStrings(source, target, keys) {
  for (const key of keys) {
    if (typeof source[key] === 'string') target[key] = source[key];
  }
}

/** Newlines and tabs become one space, the text is trimmed and cut to MAX_DETAIL characters. */
function cleanDetail(text) {
  const flat = text.replace(/[\r\n\t]+/g, ' ').trim();
  return Array.from(flat).slice(0, MAX_DETAIL).join('').trim();
}

/** Values of result.txt when the file exists and was written at or after the turn; otherwise {}. */
function readResult(root, turnTs) {
  const file = path.join(path.resolve(root), '.campaign', 'state', 'runner', 'result.txt');
  try {
    const stat = fs.statSync(file);
    if (!(stat.mtimeMs >= Date.parse(turnTs))) return {};
    const values = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const match = /^\s*(status|model|files written)\s*:\s*(.*?)\s*$/.exec(line);
      if (match) values[match[1]] = match[2];
    }
    const out = {};
    if (isText(values.status)) out.status = values.status;
    if (isText(values.model)) out.model = values.model;
    if (isText(values['files written'])) {
      const listed = values['files written'];
      out.files =
        listed === 'none'
          ? 0
          : listed
              .split(',')
              .map((item) => item.trim())
              .filter((item) => item !== '').length;
    }
    return out;
  } catch {
    return {};
  }
}

function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value);
}

/** Lines `  <value>: <count>`, by count descending then value ascending. */
function countLines(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([value, count]) => `  ${value}: ${count}`);
}

function orNone(lines) {
  return lines.length === 0 ? ['  none'] : lines;
}
