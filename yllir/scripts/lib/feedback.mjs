// Append-only local log of usage feedback, one JSON object per line, in
// <root>/.campaign/state/feedback/. Legacy turn/end/note fields are compact
// metadata. New skill invocation fields and transcripts may contain campaign
// text and are deliberately retained only in this local state folder.
// Feedback is off by default: nothing is recorded unless the environment sets
// YLLIR_FEEDBACK=1 (development, testbench) or the file
// <root>/.campaign/state/feedback/on exists (the master asked for it).
// The writing functions never throw: they return { ok, error } instead, and
// { ok: true, skipped: true } when feedback is off.

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
export const EVENT_TYPES = ['turn', 'end', 'note', 'skill-start', 'skill-end'];
export const MAX_DETAIL = 200;

const MAX_RECENT_NOTES = 5;
const SKIPPED = { ok: true, skipped: true };

/** Absolute path of the feedback log for a campaign root. */
export function feedbackFile(root) {
  return path.join(path.resolve(root), '.campaign', 'state', 'feedback', 'events.jsonl');
}

/** True when feedback is switched on: YLLIR_FEEDBACK=1, or the `on` file exists in the feedback folder. */
export function feedbackEnabled(root) {
  if (process.env.YLLIR_FEEDBACK === '1') return true;
  try {
    return fs.existsSync(path.join(path.dirname(feedbackFile(root)), 'on'));
  } catch {
    return false;
  }
}

export function skillTranscriptFile(root, invocation) {
  if (!validInvocation(invocation)) throw new Error('invalid invocation id');
  return path.join(path.dirname(feedbackFile(root)), 'transcripts', `${invocation}.json`);
}

/** Record one skill invocation boundary. Details stay in the local log. */
export function recordSkillStart(root, fields) {
  if (!feedbackEnabled(root)) return SKIPPED;
  if (!validInvocation(fields?.invocation)) return fail('invalid invocation id');
  if (readEvents(root).some((event) => event.invocation === fields.invocation)) return fail('invocation id already exists');
  return recordEvent(root, { ...fields, type: 'skill-start' });
}

/** Finish an invocation, optionally saving the caller's input/output transcript locally. */
export function recordSkillEnd(root, fields) {
  if (!feedbackEnabled(root)) return SKIPPED;
  try {
    if (!validInvocation(fields?.invocation)) return fail('invalid invocation id');
    const existing = readEvents(root);
    if (!existing.some((event) => event.type === 'skill-start' && event.invocation === fields.invocation)) return fail('skill start record is missing');
    if (existing.some((event) => event.type === 'skill-end' && event.invocation === fields.invocation)) return fail('invocation already ended');
    if (!['ok', 'partial', 'failed', 'blocked', 'question'].includes(fields.status)) return fail('invalid skill status');
    if (fields.transcriptStatus !== undefined && !['unavailable', 'empty', 'not-provided'].includes(fields.transcriptStatus)) return fail('invalid transcript status');
    const start = existing.find((event) => event.type === 'skill-start' && event.invocation === fields.invocation);
    for (const key of ['skill', 'parent', 'session']) {
      if (fields[key] !== undefined && start[key] !== fields[key]) return fail(`${key} does not match skill start record`);
    }
    const transcript = typeof fields.transcript === 'string' ? fields.transcript : undefined;
    const invocation = fields.invocation;
    const safe = { ...fields };
    delete safe.transcript;
    if (transcript !== undefined) {
      if (typeof invocation !== 'string' || invocation === '') return fail('invocation is required for a transcript');
      try {
        const parsed = JSON.parse(transcript);
        if (!parsed || typeof parsed !== 'object' || !Object.hasOwn(parsed, 'input') || !Object.hasOwn(parsed, 'output')) return fail('transcript JSON must contain input and output');
      } catch { return fail('transcript must be valid JSON'); }
      const file = skillTranscriptFile(root, invocation);
      ensureTranscriptDirectory(root);
      if (fs.existsSync(file)) return fail('transcript already exists for this invocation');
      fs.writeFileSync(file, `${transcript.replace(/\r\n/g, '\n')}\n`, { mode: 0o600, flag: 'wx' });
      safe.transcript = { status: 'captured-local', file: path.relative(path.dirname(feedbackFile(root)), file).split(path.sep).join('/') };
    } else if (safe.transcriptStatus === undefined) {
      safe.transcript = { status: 'unavailable' };
    } else {
      safe.transcript = { status: safe.transcriptStatus };
    }
    delete safe.transcriptStatus;
    safe.parent ??= start.parent;
    safe.model ??= start.model;
    return recordEvent(root, { ...safe, session: fields.session ?? start.session, type: 'skill-end' });
  } catch (error) {
    return fail(errorText(error));
  }
}

/** Full local per-skill report; transcript bodies are read only from local files. */
export function skillReport(root, events, { includeTranscripts = false } = {}) {
  const starts = new Map();
  const rows = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (event.type === 'skill-start') starts.set(event.invocation, event);
    if (event.type !== 'skill-end') continue;
    const start = starts.get(event.invocation);
    let transcript = '';
    if (includeTranscripts && event.transcript?.status === 'captured-local' && typeof event.transcript.file === 'string') {
      try {
        const expected = `transcripts/${event.invocation}.json`;
        if (event.transcript.file !== expected) throw new Error('invalid transcript reference');
        const base = ensureTranscriptDirectory(root, { create: false });
        const file = fs.realpathSync(path.join(path.dirname(feedbackFile(root)), event.transcript.file));
        if (!file.startsWith(`${base}${path.sep}`)) throw new Error('transcript path escapes local storage');
        transcript = fs.readFileSync(file, 'utf8');
      } catch { transcript = '[transcript unavailable]'; }
    }
    const durationS = start ? Math.max(0, Math.floor((Date.parse(event.ts) - Date.parse(start.ts)) / 1000)) : null;
    rows.push({ start: start ?? null, end: event, duration_s: Number.isFinite(durationS) ? durationS : null, ...(includeTranscripts ? { transcript } : {}) });
  }
  const pending = [...starts.values()].filter((start) => !rows.some((row) => row.end.invocation === start.invocation));
  const bySkill = Object.create(null);
  for (const row of rows) {
    const name = row.end.skill;
    bySkill[name] ??= { count: 0, failed: 0, blocked: 0, duration_s: 0 };
    bySkill[name].count += 1;
    if (row.end.status === 'failed') bySkill[name].failed += 1;
    if (row.end.status === 'blocked') bySkill[name].blocked += 1;
    bySkill[name].duration_s += row.duration_s ?? 0;
  }
  return { by_skill: bySkill, invocations: rows, incomplete: pending };
}

/** Appends one validated event. Returns { ok: true } or { ok: false, error }. Never throws. */
export function recordEvent(root, event) {
  if (!feedbackEnabled(root)) return SKIPPED;
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
  if (!feedbackEnabled(root)) return SKIPPED;
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

function validInvocation(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value);
}

function ensureTranscriptDirectory(root, { create = true } = {}) {
  const feedbackDir = path.dirname(feedbackFile(root));
  const directory = path.join(feedbackDir, 'transcripts');
  if (!fs.existsSync(directory)) {
    if (!create) throw new Error('transcript directory is missing');
    fs.mkdirSync(directory, { recursive: false });
  }
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('transcript directory must not be a symlink');
  const realFeedback = fs.realpathSync(feedbackDir);
  const expectedFeedback = path.join(fs.realpathSync(path.resolve(root)), '.campaign', 'state', 'feedback');
  if (realFeedback !== expectedFeedback) throw new Error('feedback directory escapes the campaign folder');
  const realDirectory = fs.realpathSync(directory);
  if (realDirectory !== path.join(realFeedback, 'transcripts')) throw new Error('transcript directory escapes local storage');
  return realDirectory;
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

  if (type === 'skill-start' || type === 'skill-end') {
    copyStrings(event, fields, ['invocation', 'parent', 'skill', 'session', 'model']);
    if (!fields.invocation || !fields.skill) return fail('invocation and skill are required');
    if (type === 'skill-start') copyStrings(event, fields, ['input']);
    if (type === 'skill-end') {
      if (!['ok', 'partial', 'failed', 'blocked', 'question'].includes(event.status)) return fail('status must be ok, partial, failed, blocked, or question');
      fields.status = event.status;
      copyStrings(event, fields, ['artifacts', 'issues']);
      if (event.transcript && typeof event.transcript === 'object') {
        fields.transcript = {};
        copyStrings(event.transcript, fields.transcript, ['status', 'file']);
      }
    }
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
