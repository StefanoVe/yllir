// Brings an existing campaign up to the installed framework version. It only
// regenerates the files the framework generates (through instructions.mjs) and
// saves each step as git history, so every change stays recoverable. It makes
// no content decisions and never touches the master's files, except the
// generated ones, whose hand edits are saved first and then restored.
// The migrations run in the order of the registry (registry.mjs): each one is a
// folder under ../../migrations/. Expected problems are returned as data; only
// programmer errors throw.
//
// State of an update lives in .campaign/state/update.yaml (ignored by git):
//   in_progress -> completed | cancelled
// An in_progress file means an earlier run stopped halfway: it is never started
// again by itself. The master resumes it or cancels it (restore to restore_point).
// Its migrations list holds the status of each migration: complete, pending
// (a guided part remains) or not-needed. See scripts/lib/update-state.mjs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkFingerprints, generateInstructions } from '../../../../../scripts/lib/instructions.mjs';
import { UPDATE_STATE_PATH, formatUpdateState, parseUpdateState } from '../../../../../scripts/lib/update-state.mjs';
import { listVersions, restore, saveManualChanges, saveVersion, status } from '../../../../../scripts/lib/versions.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { isSupported, loadRegistry, runComplete, runRegistry } from './registry.mjs';

const PLUGIN_JSON = path.resolve(import.meta.dirname, '../../../../../.claude-plugin/plugin.json');
const CONFIG_PATH = 'campaign.yaml';
const VERSION_PATH = '.campaign/version.yaml';
const CUSTOMIZATIONS_PATH = '.campaign/customizations.md';
const UPDATE_PATH = UPDATE_STATE_PATH;
const NOTICE_PATH = '.campaign/state/update-notice.yaml';
const DAY_MS = 86_400_000;
const UNSUPPORTED_MESSAGE = 'This campaign is too old to be updated automatically. Nothing was changed.';
const STATE_FIELDS = ['status', 'from_version', 'to_version', 'restore_point', 'started_on', 'completed_on'];

/**
 * @typedef {{
 *   status: 'up-to-date' | 'would-update' | 'updated' | 'cancelled' | 'failed',
 *   from: string | null,
 *   to: string,
 *   restore_point: string | null,
 *   rewritten: string[],
 *   restored_by_hand: string[],
 *   migrated: string[],
 *   migrations: Record<string, 'complete' | 'pending' | 'not-needed' | 'failed'>,
 *   pending_migrations: string[],
 *   world_migration_files: string[],
 *   details: Record<string, { status: string, changed: string[], skipped: object[], errors: object[] }>,
 *   errors: Array<{ code: string, message: string, file?: string, line?: number | null }>,
 * }} UpdateResult
 */

/**
 * Updates the campaign to the installed framework version.
 * @param {string} campaignRoot
 * @param {{ dryRun?: boolean, resume?: boolean, today?: string, registryDir?: string }} [options]
 *   today is YYYY-MM-DD (defaults to the current UTC date). registryDir replaces the
 *   migrations folder (tests only).
 * @returns {Promise<UpdateResult>}
 */
export async function updateCampaign(campaignRoot, options = {}) {
  const dryRun = options.dryRun === true;
  const resume = options.resume === true;
  const today = options.today ?? utcToday();
  if (!isDate(today)) throw new TypeError('today must be a YYYY-MM-DD date');

  const root = path.resolve(campaignRoot);
  const installed = readInstalledVersion();
  const out = newResult(readCampaignVersion(root), installed ?? '');
  if (installed === null) return failWith(out, 'invalid-plugin', 'plugin.json has no version');

  try {
    return await runUpdate(root, out, { dryRun, resume, today, registryDir: options.registryDir });
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
    out.from = saved.from_version ?? null;
    out.to = saved.to_version ?? '';
    out.restore_point = saved.restore_point ?? null;
    if (!isHash(out.restore_point)) {
      return failWith(out, 'bad-update-state', 'the interrupted update has no restore point');
    }
    if (!status(root).isRepo) {
      return failWith(out, 'no-repo', `${root} is not a git repository; the framework does not write without git`);
    }
    const state = { ...saved, status: 'in_progress' };
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
    `last_notified_version: "${lastVersion}"\nlast_notified_on: ${today}\nsnoozed_until: ${snoozed}\n`,
    'utf8',
  );
  return {
    status: 'postponed',
    last_notified_version: lastVersion,
    last_notified_on: today,
    snoozed_until: snoozed,
  };
}

/**
 * Finishes the guided part of one migration: runs its complete check and, when the
 * check passes, records the migration as complete. Status 'pending' keeps it pending.
 * @param {string} campaignRoot
 * @param {string} id a migration id of the registry
 * @returns {Promise<{ status: 'complete' | 'pending' | 'failed', migration: string, errors: object[] }>}
 */
export async function completeMigration(campaignRoot, id) {
  const root = path.resolve(campaignRoot);
  const out = { status: 'failed', migration: id, errors: [] };
  const registry = loadRegistry();
  if (registry.errors.length > 0) {
    out.errors = registry.errors;
    return out;
  }
  const migration = registry.migrations.find((entry) => entry.id === id);
  if (migration === undefined) {
    out.errors.push({ code: 'unknown-migration', message: `there is no migration ${id}` });
    return out;
  }
  const saved = readUpdateState(root);
  if (saved === null) {
    out.errors.push({ code: 'bad-update-state', message: `${UPDATE_PATH} cannot be read` });
    return out;
  }
  if (saved === undefined || saved.migrations.get(id) !== 'pending') {
    out.errors.push({ code: 'not-pending', message: `${id} is not pending` });
    return out;
  }
  const result = await runComplete(root, migration);
  out.errors = result.errors;
  if (result.status === 'failed') return out;
  if (result.status === 'complete') {
    saved.migrations.set(id, 'complete');
    writeUpdateState(root, saved);
  }
  out.status = result.status;
  return out;
}

// ---------------------------------------------------------------- update steps

async function runUpdate(root, out, { dryRun, resume, today, registryDir }) {
  const to = out.to;

  // Step 1: refuse what the framework cannot handle.
  if (!status(root).isRepo) {
    return failWith(out, 'no-repo', `${root} is not a git repository; the framework does not write without git`);
  }
  if (readTextOrNull(path.join(root, CONFIG_PATH)) === null) {
    return failWith(out, 'missing-config', 'campaign.yaml not found');
  }
  const registry = loadRegistry(registryDir);
  if (registry.errors.length > 0) {
    return failWith(out, 'registry-invalid', registry.errors[0].message);
  }

  // Step 2: an interrupted update is reported, never started again by itself.
  const saved = readUpdateState(root);
  if (saved === null) {
    return failWith(out, 'bad-update-state', `${UPDATE_PATH} cannot be read; check the saved versions before changing it`);
  }
  const interrupted = saved !== undefined && saved.status === 'in_progress';
  if (interrupted && !resume) {
    out.from = saved.from_version ?? null;
    out.restore_point = saved.restore_point ?? null;
    return failWith(
      out,
      'interrupted-update',
      'an earlier update did not finish: run it again with --resume, or undo it with --cancel',
    );
  }
  const resuming = interrupted;
  if (resuming) {
    out.from = saved.from_version ?? null;
    if (!isHash(saved.restore_point)) {
      return failWith(out, 'bad-update-state', 'the interrupted update has no restore point');
    }
  }
  if (!isSupported(registry, out.from)) {
    return failWith(out, 'unsupported-version', UNSUPPORTED_MESSAGE);
  }

  const savedMigrations = saved?.migrations ?? new Map();

  // Step 3: nothing to write when the versions match and no generated file was changed by hand.
  const fingerprints = checkFingerprints(root);
  // A dry probe decides. A migration that is needed changes campaign files unless it is
  // a pending guided part (which writes only ignored state): then the full update runs,
  // with its restore point and its saved framework version. Otherwise only the statuses
  // are recorded here, so no campaign file is ever left unsaved.
  if (!resuming && out.from === to && fingerprints.ok) {
    const probe = await runRegistry(root, { registry, state: savedMigrations, from: out.from, dryRun: true });
    if (probe.fatal) {
      setResult(out, probe);
      return failWithErrors(out, probe.errors);
    }
    const alignment = registry.migrations.some(
      (m) => probe.details[m.id].needed && !(m.complete !== null && savedMigrations.get(m.id) === 'pending'),
    );
    if (!alignment) {
      const run = dryRun ? probe : await runRegistry(root, { registry, state: savedMigrations, from: out.from });
      setResult(out, run);
      if (run.fatal) return failWithErrors(out, run.errors);
      if (!dryRun && (saved !== undefined || [...run.statuses.values()].some((value) => value !== 'not-needed'))) {
        writeUpdateState(root, { ...(saved ?? {}), migrations: run.statuses });
      }
      out.status = 'up-to-date';
      return out;
    }
  }

  // Step 4: generated files changed by hand are restored (their history is kept below).
  out.restored_by_hand = [...fingerprints.changed];

  // Step 5: a dry run writes nothing, not even state. It generates into a scratch folder.
  if (dryRun) {
    const plan = planGeneration(root);
    if (plan.errors.length > 0) {
      out.errors = plan.errors;
      return out;
    }
    out.rewritten = plan.written;
    const run = await runRegistry(root, { registry, state: savedMigrations, from: out.from, dryRun: true });
    setResult(out, run);
    if (run.fatal) {
      out.errors = run.errors;
      return out;
    }
    out.status = 'would-update';
    return out;
  }

  // Step 6: save pending changes, then fix the restore point and mark the update in progress.
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
      started_on: saved.started_on ?? today,
      migrations: savedMigrations,
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
      migrations: savedMigrations,
    };
  }
  out.restore_point = state.restore_point;
  writeUpdateState(root, state);

  // Step 7: generate, run the migrations (the framework version is saved at its own
  // position in the registry), then finish. Any failure after step 6 goes back to the restore point.
  try {
    const generated = generateInstructions(root);
    if (generated.errors.length > 0) {
      out.errors = generated.errors;
    } else {
      out.rewritten = generated.written;
      const run = await runRegistry(root, {
        registry,
        state: savedMigrations,
        from: out.from,
        recordVersion: () => saveVersion(root, { message: `Updated Yllir to ${to}`, kind: 'framework' }),
      });
      setResult(out, run);
      if (!run.fatal) {
        out.errors = Object.values(run.details).flatMap((detail) => detail.errors);
        // Migrations after the recorded version (for example metadata-comment-v1 after
        // world-graph-v1) change files too, and an update never leaves campaign files unsaved.
        // The update state lives in .campaign/state, which git ignores, so it never dirties the tree.
        if (!status(root).clean) {
          saveVersion(root, { message: `Updated Yllir to ${to}`, kind: 'framework' });
        }
        writeUpdateState(root, { ...state, status: 'completed', completed_on: today, migrations: run.statuses });
        out.status = 'updated';
        return out;
      }
      out.errors = run.errors;
    }
  } catch (err) {
    out.errors = [{ code: err.code ?? 'update-failed', message: err.message }];
  }
  rollBack(root, state, out);
  return out;
}

/** Copies the result of the registry run into the update result. */
function setResult(out, run) {
  out.migrations = Object.fromEntries(run.statuses);
  out.pending_migrations = [...run.statuses].filter(([, value]) => value === 'pending').map(([id]) => id);
  out.details = run.details;
  out.migrated = run.details['session-layout-v1']?.changed ?? [];
  out.world_migration_files = run.details['world-graph-v1']?.changed ?? [];
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

/** @returns {ReturnType<typeof parseUpdateState> | undefined | null} undefined when missing, null when unreadable */
function readUpdateState(root) {
  const text = readTextOrNull(path.join(root, UPDATE_PATH));
  if (text === null) return undefined;
  return parseUpdateState(text);
}

/** Writes update.yaml from a state object: its fields, and its migrations (a Map, in registry order). */
function writeUpdateState(root, state) {
  const file = path.join(root, UPDATE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fields = {};
  for (const key of STATE_FIELDS) {
    if (typeof state[key] === 'string') fields[key] = state[key];
  }
  fs.writeFileSync(file, formatUpdateState(fields, state.migrations ?? new Map()), 'utf8');
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
  return {
    status: 'failed',
    from,
    to,
    restore_point: null,
    rewritten: [],
    restored_by_hand: [],
    migrated: [],
    migrations: {},
    pending_migrations: [],
    details: {},
    world_migration_files: [],
    errors: [],
  };
}

function failWith(out, code, message) {
  out.status = 'failed';
  out.errors.push({ code, message });
  return out;
}

function failWithErrors(out, errors) {
  out.status = 'failed';
  out.errors = errors;
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
