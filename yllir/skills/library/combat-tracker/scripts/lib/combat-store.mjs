// Keeps the combat of the active live session. Reads and writes
// <root>/.campaign/state/live/<sessionId>/combat.json and never touches a canon
// document. Every rule comes from the adapter's encounter rules file (the
// `encounter_ops` setting of its adapter.yaml); this module only finds them, checks
// the result and saves it.
//
// Every function returns { ok: true, ... } or { ok: false, error: { code, message } }.
// applyOp is asynchronous because the rules file is loaded with a dynamic import.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAdapter, pluginRootFromHere } from '../../../../../scripts/lib/adapter.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';

const LIVE = path.join('.campaign', 'state', 'live');
const SESSION_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;
const RULES_FILE_RE = /^[A-Za-z0-9_-]+\.mjs$/;
// The adapter loader checks setting names against a fixed list that does not know
// encounter_ops yet. That one error is expected and ignored here, nothing else.
const EXPECTED_ADAPTER_ERROR = (error) => error.code === 'unknown-key' && error.path === 'encounter_ops';

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

function activeSession(root) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(root, LIVE, 'active.json'), 'utf8'));
  } catch {
    return fail('no-live-session', 'no game is in progress');
  }
  const id = data?.sessionId;
  if (typeof id !== 'string' || !SESSION_RE.test(id)) return fail('no-live-session', 'no game is in progress');
  return { ok: true, sessionId: id };
}

function combatFile(root, sessionId) {
  return path.join(root, LIVE, sessionId, 'combat.json');
}

function readCombat(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, combat: null };
    return fail('unreadable', 'the combat file cannot be read');
  }
  try {
    return { ok: true, combat: JSON.parse(text) };
  } catch {
    return fail('unreadable', 'the combat file is damaged');
  }
}

// Writes through a temporary file and a rename, so a reader never sees half a file.
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, text, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
}

// The adapter's encounter rules module, loaded with its functions checked.
async function encounterRules(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8');
  } catch {
    return fail('no-adapter', 'the game rules are not set for this campaign');
  }
  const parsed = parseYamlLite(text);
  const id = parsed.errors.length === 0 ? parsed.data?.system?.adapter : undefined;
  if (typeof id !== 'string' || id === '' || id === 'none') {
    return fail('no-adapter', 'the game rules are not set for this campaign');
  }
  const pluginRoot = pluginRootFromHere();
  const loaded = loadAdapter(pluginRoot, id);
  const problems = loaded.errors.filter((error) => !EXPECTED_ADAPTER_ERROR(error));
  if (!loaded.adapter || problems.length > 0) {
    return fail('no-adapter', `the game rules ${id} cannot be loaded`);
  }
  const adapter = loaded.adapter;
  const file = adapter.encounter_ops;
  if (typeof file !== 'string' || !RULES_FILE_RE.test(file)) {
    return fail('no-adapter', `the game rules ${id} have no combat rules`);
  }
  const modulePath = path.join(pluginRoot, 'modules', 'systems', id, file);
  let rules;
  try {
    rules = await import(pathToFileURL(modulePath).href);
  } catch (err) {
    return fail('encounter-unavailable', `the combat rules of ${id} cannot be loaded: ${err.message}`);
  }
  const needed = ['initEncounter', 'startEncounter', 'recordEvent', 'advanceTurn', 'endEncounter', 'validateState'];
  if (needed.some((name) => typeof rules[name] !== 'function')) {
    return fail('encounter-unavailable', `the combat rules of ${id} are incomplete`);
  }
  return { ok: true, adapter, rules };
}

// A sheet, when given, is a campaign-relative path to an existing file, without "..".
function sheetProblem(root, sheet) {
  const bad = () => fail('bad-sheet', 'the sheet must be a file of the campaign, named by a path inside the campaign folder');
  if (typeof sheet !== 'string' || sheet === '' || path.isAbsolute(sheet) || sheet.includes('\\') || sheet.split('/').includes('..')) {
    return bad();
  }
  try {
    if (!fs.statSync(path.join(root, sheet)).isFile()) return bad();
  } catch {
    return bad();
  }
  return null;
}

/**
 * The combat of the active session.
 * @returns {{ok: true, sessionId: string, combat: object|null} | {ok: false, error: object}}
 */
export function getCombat(root) {
  const session = activeSession(path.resolve(root));
  if (!session.ok) return session;
  const read = readCombat(combatFile(path.resolve(root), session.sessionId));
  if (!read.ok) return read;
  return { ok: true, sessionId: session.sessionId, combat: read.combat };
}

/**
 * Applies one CombatOp to the combat of the active session and saves the result.
 * Nothing is saved when the rules refuse the operation or the result is invalid.
 * @returns {Promise<{ok: true, sessionId: string, combat: object, notices: object[]} | {ok: false, error: object}>}
 */
export async function applyOp(root, op, { now = new Date().toISOString() } = {}) {
  const base = path.resolve(root);
  const session = activeSession(base);
  if (!session.ok) return session;
  if (!op || typeof op !== 'object' || typeof op.op !== 'string') return fail('bad-op', 'the operation needs a name');
  if (op.sheet !== undefined) {
    const problem = sheetProblem(base, op.sheet);
    if (problem) return problem;
  }
  const rules = await encounterRules(base);
  if (!rules.ok) return rules;
  const file = combatFile(base, session.sessionId);
  const read = readCombat(file);
  if (!read.ok) return read;
  const current = read.combat;

  const { adapter, rules: encounter } = rules;
  const context = { now };
  let result;
  if (op.op === 'start') {
    if (current?.active) return fail('already-active', 'a combat is already running: end it first');
    result = encounter.startEncounter(adapter, current, context);
  } else if (op.op === 'next') {
    if (current === null) return fail('no-combat', 'no combat has started yet');
    result = encounter.advanceTurn(adapter, current, context);
  } else if (op.op === 'end') {
    if (current === null) return fail('no-combat', 'no combat has started yet');
    result = encounter.endEncounter(adapter, current, context);
  } else {
    if (current === null) return fail('no-combat', 'no combat has started yet');
    result = encounter.recordEvent(adapter, current, op, context);
  }
  if (!result.ok) return result;

  const problems = encounter.validateState(adapter, result.state);
  if (problems.length > 0) return fail('invalid-state', problems[0].message);

  writeAtomic(file, `${JSON.stringify(result.state, null, 2)}\n`);
  return { ok: true, sessionId: session.sessionId, combat: result.state, notices: result.notices ?? [] };
}
