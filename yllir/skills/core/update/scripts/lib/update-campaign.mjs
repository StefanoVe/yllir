// Brings an existing campaign up to the installed framework version. It only
// regenerates the files the framework generates (through instructions.mjs) and
// saves each step as git history, so every change stays recoverable. It makes
// no content decisions and never touches the master's files, except the
// generated ones, whose hand edits are saved first and then restored.
// Expected problems are returned as data; only programmer errors throw.
//
// State of an update lives in .campaign/state/update.yaml (ignored by git):
//   in_progress -> completed | cancelled
// An in_progress file means an earlier run stopped halfway: it is never started
// again by itself. The master resumes it or cancels it (restore to restore_point).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkFingerprints, generateInstructions } from '../../../../../scripts/lib/instructions.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { listVersions, restore, saveManualChanges, saveVersion, status } from '../../../../../scripts/lib/versions.mjs';

const PLUGIN_JSON = path.resolve(import.meta.dirname, '../../../../../.claude-plugin/plugin.json');
const CONFIG_PATH = 'campaign.yaml';
const VERSION_PATH = '.campaign/version.yaml';
const CUSTOMIZATIONS_PATH = '.campaign/customizations.md';
const UPDATE_PATH = '.campaign/state/update.yaml';
const NOTICE_PATH = '.campaign/state/update-notice.yaml';

// Keys written without quotes: their values never need escaping.
const UNQUOTED_KEYS = new Set(['status', 'started_on', 'completed_on', 'last_notified_on', 'snoozed_until']);
const UPDATE_KEYS = ['status', 'from_version', 'to_version', 'restore_point', 'started_on', 'completed_on'];
const DAY_MS = 86_400_000;

/**
 * @typedef {{
 *   status: 'up-to-date' | 'would-update' | 'updated' | 'cancelled' | 'failed',
 *   from: string | null,
 *   to: string,
 *   restore_point: string | null,
 *   rewritten: string[],
 *   restored_by_hand: string[],
 *   errors: Array<{ code: string, message: string, file?: string, line?: number | null }>,
 * }} UpdateResult
 */

/**
 * Updates the campaign to the installed framework version.
 * @param {string} campaignRoot
 * @param {{ dryRun?: boolean, resume?: boolean, today?: string }} [options]
 *   today is YYYY-MM-DD (defaults to the current UTC date).
 * @returns {UpdateResult}
 */
export function updateCampaign(campaignRoot, options = {}) {
  const dryRun = options.dryRun === true;
  const resume = options.resume === true;
  const today = options.today ?? utcToday();
  if (!isDate(today)) throw new TypeError('today must be a YYYY-MM-DD date');

  const root = path.resolve(campaignRoot);
  const installed = readInstalledVersion();
  const out = newResult(readCampaignVersion(root), installed ?? '');
  if (installed === null) return failWith(out, 'invalid-plugin', 'plugin.json has no version');

  try {
    return runUpdate(root, out, { dryRun, resume, today });
  } catch (err) {
    return failWith(out, err.code ?? 'update-failed', err.message);
  }
}

/**
 * Restores the campaign to the restore point of an interrupted update and marks
 * the update cancelled. Changes made since then are saved first, so nothing is lost.
 * @param {string} campaignRoot
 * @returns {UpdateResult} status 'cancelled' on success
 */
export function cancelInterruptedUpdate(campaignRoot) {
  const root = path.resolve(campaignRoot);
  const out = newResult(null, '');
  try {
    const saved = readUpdateState(root);
    if (saved === null) {
      return failWith(out, 'bad-update-state', `${UPDATE_PATH} cannot be read; check the saved versions before changing it`);
    }
    if (saved === undefined || saved.status !== 'in_progress') {
      return failWith(out, 'no-interrupted-update', 'there is no interrupted update to cancel');
    }
    out.from = stringOrNull(saved.from_version);
    out.to = stringOrNull(saved.to_version) ?? '';
    out.restore_point = stringOrNull(saved.restore_point);
    if (!isHash(out.restore_point)) {
      return failWith(out, 'bad-update-state', 'the interrupted update has no restore point');
    }
    if (!status(root).isRepo) {
      return failWith(out, 'no-repo', `${root} is not a git repository; the framework does not write without git`);
    }
    const state = {
      status: 'in_progress',
      from_version: out.from,
      to_version: out.to,
      restore_point: out.restore_point,
      started_on: stringOrNull(saved.started_on) ?? undefined,
    };
    if (rollBack(root, state, out)) {
      out.status = 'cancelled';
    }
    return out;
  } catch (err) {
    return failWith(out, err.code ?? 'update-failed', err.message);
  }
}

/**
 * Records that the master postponed the update notice. Keeps the last notified
 * version when the file already has one, else writes "".
 * @returns {{ status: 'postponed', last_notified_version: string, last_notified_on: string, snoozed_until: string }}
 */
export function postponeNotice(campaignRoot, { today = utcToday(), days = 1 } = {}) {
  if (!isDate(today)) throw new TypeError('today must be a YYYY-MM-DD date');
  if (!Number.isInteger(days) || days < 1) throw new TypeError('days must be a positive integer');
  const root = path.resolve(campaignRoot);
  const existing = readYamlOrNull(path.join(root, NOTICE_PATH));
  const lastVersion = typeof existing?.last_notified_version === 'string' ? existing.last_notified_version : '';
  const snoozed = addDays(today, days);

  const file = path.join(root, NOTICE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    formatYaml([
      ['last_notified_version', lastVersion],
      ['last_notified_on', today],
      ['snoozed_until', snoozed],
    ]),
    'utf8',
  );
  return {
    status: 'postponed',
    last_notified_version: lastVersion,
    last_notified_on: today,
    snoozed_until: snoozed,
  };
}

// ---------------------------------------------------------------- update steps

function runUpdate(root, out, { dryRun, resume, today }) {
  const to = out.to;

  // Step 1: refuse what the framework cannot handle.
  if (!status(root).isRepo) {
    return failWith(out, 'no-repo', `${root} is not a git repository; the framework does not write without git`);
  }
  if (readTextOrNull(path.join(root, CONFIG_PATH)) === null) {
    return failWith(out, 'missing-config', 'campaign.yaml not found');
  }

  // Step 8: an interrupted update is reported, never started again by itself.
  const saved = readUpdateState(root);
  if (saved === null) {
    return failWith(out, 'bad-update-state', `${UPDATE_PATH} cannot be read; check the saved versions before changing it`);
  }
  const interrupted = saved !== undefined && saved.status === 'in_progress';
  if (interrupted && !resume) {
    out.from = stringOrNull(saved.from_version);
    out.restore_point = stringOrNull(saved.restore_point);
    return failWith(
      out,
      'interrupted-update',
      'an earlier update did not finish: run it again with --resume, or undo it with --cancel',
    );
  }
  const resuming = interrupted;
  if (resuming) {
    out.from = stringOrNull(saved.from_version);
    if (!isHash(saved.restore_point)) {
      return failWith(out, 'bad-update-state', 'the interrupted update has no restore point');
    }
  }

  // Step 2: nothing to do when the versions match and no generated file was changed by hand.
  const fingerprints = checkFingerprints(root);
  if (!resuming && out.from === to && fingerprints.ok) {
    out.status = 'up-to-date';
    return out;
  }

  // Step 3: generated files changed by hand are restored (their history is kept below).
  out.restored_by_hand = [...fingerprints.changed];

  // Step 4: a dry run writes nothing, not even state. It generates into a scratch folder.
  if (dryRun) {
    const plan = planGeneration(root);
    if (plan.errors.length > 0) {
      out.errors = plan.errors;
      return out;
    }
    out.status = 'would-update';
    out.rewritten = plan.written;
    return out;
  }

  // Step 5: save pending changes, then fix the restore point and mark the update in progress.
  let state;
  if (resuming) {
    if (!status(root).clean) {
      saveManualChanges(root, `Saved changes left by an interrupted update to ${to}`);
    }
    state = {
      status: 'in_progress',
      from_version: out.from,
      to_version: to,
      restore_point: saved.restore_point,
      started_on: stringOrNull(saved.started_on) ?? today,
    };
  } else {
    if (!status(root).clean) {
      saveManualChanges(root, `Saved manual changes before updating Yllir to ${to}`);
    }
    const [head] = listVersions(root, { limit: 1 });
    if (head === undefined) {
      return failWith(out, 'no-history', 'the campaign has no saved version to go back to');
    }
    state = {
      status: 'in_progress',
      from_version: out.from,
      to_version: to,
      restore_point: head.hash,
      started_on: today,
    };
  }
  out.restore_point = state.restore_point;
  writeUpdateState(root, state);

  // Steps 6 and 7: generate, then save. Any failure after step 5 goes back to the restore point.
  try {
    const generated = generateInstructions(root);
    if (generated.errors.length === 0) {
      out.rewritten = generated.written;
      saveVersion(root, { message: `Updated Yllir to ${to}`, kind: 'framework' });
      writeUpdateState(root, { ...state, status: 'completed', completed_on: today });
      out.status = 'updated';
      return out;
    }
    out.errors = generated.errors;
  } catch (err) {
    out.errors = [{ code: err.code ?? 'update-failed', message: err.message }];
  }
  rollBack(root, state, out);
  return out;
}

/**
 * Restores the campaign to state.restore_point and marks the update cancelled.
 * Unsaved changes are saved first. Returns false (and records restore-failed)
 * when the restore fails; the state then stays in_progress.
 */
function rollBack(root, state, out) {
  try {
    if (!status(root).clean) {
      saveManualChanges(root, `Saved changes before cancelling the update to ${out.to}`);
    }
    restore(root, {
      to: state.restore_point,
      message: `Restored the campaign from before the update to ${out.to}`,
    });
  } catch (err) {
    out.errors.push({ code: 'restore-failed', message: err.message });
    return false;
  }
  writeUpdateState(root, { ...state, status: 'cancelled' });
  return true;
}

/**
 * Generates into a scratch folder that holds only what generateInstructions
 * reads, so the list of written files is exact and the campaign is not touched.
 */
function planGeneration(root) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-plan-'));
  try {
    fs.copyFileSync(path.join(root, CONFIG_PATH), path.join(scratch, CONFIG_PATH));
    const customizations = path.join(root, CUSTOMIZATIONS_PATH);
    if (fs.existsSync(customizations)) {
      fs.mkdirSync(path.dirname(path.join(scratch, CUSTOMIZATIONS_PATH)), { recursive: true });
      fs.copyFileSync(customizations, path.join(scratch, CUSTOMIZATIONS_PATH));
    }
    return generateInstructions(scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- state files

/** @returns {object|undefined|null} parsed update.yaml; undefined when missing, null when unreadable */
function readUpdateState(root) {
  const text = readTextOrNull(path.join(root, UPDATE_PATH));
  if (text === null) return undefined;
  const parsed = parseYamlLite(text);
  if (parsed.errors.length > 0 || parsed.data === null || typeof parsed.data !== 'object') return null;
  return parsed.data;
}

function writeUpdateState(root, fields) {
  const file = path.join(root, UPDATE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pairs = UPDATE_KEYS.filter((key) => fields[key] !== undefined).map((key) => [key, fields[key]]);
  fs.writeFileSync(file, formatYaml(pairs), 'utf8');
}

/** Hand-built YAML in the style of the framework's other state files. */
function formatYaml(pairs) {
  const lines = pairs.map(([key, value]) => `${key}: ${yamlScalar(key, value)}`);
  return `${lines.join('\n')}\n`;
}

function yamlScalar(key, value) {
  if (value === null) return 'null';
  if (typeof value !== 'string' || value.includes('"') || value.includes('\n')) {
    throw new TypeError(`${key} must be a single-line string`);
  }
  return UNQUOTED_KEYS.has(key) ? value : `"${value}"`;
}

function readYamlOrNull(file) {
  const text = readTextOrNull(file);
  if (text === null) return null;
  const parsed = parseYamlLite(text);
  return parsed.errors.length > 0 ? null : parsed.data;
}

function readCampaignVersion(root) {
  const data = readYamlOrNull(path.join(root, VERSION_PATH));
  const version = data?.framework_version;
  return typeof version === 'string' ? version : null;
}

function readInstalledVersion() {
  try {
    const version = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8')).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- helpers

function newResult(from, to) {
  return { status: 'failed', from, to, restore_point: null, rewritten: [], restored_by_hand: [], errors: [] };
}

function failWith(out, code, message) {
  out.status = 'failed';
  out.errors.push({ code, message });
  return out;
}

function readTextOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw err;
  }
}

function stringOrNull(value) {
  return typeof value === 'string' ? value : null;
}

function isHash(value) {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/.test(value);
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
