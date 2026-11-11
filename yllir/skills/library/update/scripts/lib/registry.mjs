// Generic runner of the migration registry. Each migration is a folder under
// ../../migrations/<id>/ with migration.yaml (its fields are documented in
// docs/Aggiornamenti e migrazioni.md, section «Registro delle migrazioni»):
//
//   deterministic.mjs  exports detect(root) (when needed is detect) and
//                      apply(root, { dryRun }) -> { status, changed, errors }
//                      status: complete | pending (a guided part remains) | failed
//   guided.md          instructions for the agent, only when there is a guided part
//   complete.mjs       exports complete(root) -> { status, errors }: is the guided part finished
//
// Expected problems are returned as data (errors with a code); the registry never
// writes the update state, that is update-campaign.mjs's job.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../migrations');
const REGISTRY_FILE = 'registry.yaml';
const MANIFEST_FILE = 'migration.yaml';
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const FIELDS = ['id', 'after', 'introduced_in', 'needed', 'deterministic', 'guided', 'complete', 'version_record_before'];
const REQUIRED = ['id', 'after', 'introduced_in', 'needed', 'deterministic', 'guided', 'complete'];

/**
 * @typedef {{
 *   id: string, after: string[], introduced_in: string,
 *   needed: 'detect' | { from_version_below: string },
 *   deterministic: string | null, guided: string | null, complete: string | null,
 *   version_record_before: boolean, dir: string,
 * }} Migration
 */

/**
 * Loads and checks every migration of the registry, in the order they run.
 * @param {string} [dir] folder with registry.yaml and one folder per migration
 * @returns {{ supported_from: string | null, migrations: Migration[], errors: Array<{code: string, message: string}> }}
 */
export function loadRegistry(dir = MIGRATIONS_DIR) {
  const errors = [];
  const fail = (code, message) => errors.push({ code, message });
  const registry = readYaml(path.join(dir, REGISTRY_FILE), fail);
  let supported = null;
  if (registry !== null) {
    if (typeof registry.supported_from === 'string' && SEMVER_RE.test(registry.supported_from)) supported = registry.supported_from;
    else fail('registry-invalid', `${REGISTRY_FILE}: supported_from must be a MAJOR.MINOR.PATCH version`);
  }

  const migrations = [];
  let folders = [];
  try {
    folders = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (err) {
    fail('registry-invalid', `the migrations folder cannot be read: ${err.message}`);
  }
  for (const name of folders) {
    const migration = readMigration(path.join(dir, name), name, fail);
    if (migration !== null) migrations.push(migration);
  }

  const ordered = errors.length > 0 ? [] : orderMigrations(migrations, fail);
  const recordCount = migrations.filter((m) => m.version_record_before).length;
  if (recordCount > 1) fail('registry-invalid', 'only one migration may set version_record_before');
  return { supported_from: supported, migrations: errors.length > 0 ? [] : ordered, errors };
}

/** True when a campaign made with the given version can be updated. An unknown version is not refused. */
export function isSupported(registry, from) {
  if (from === null || registry.supported_from === null) return true;
  return compareVersions(from, registry.supported_from) >= 0;
}

/** -1, 0 or 1 for two MAJOR.MINOR.PATCH versions. */
export function compareVersions(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (x === null || y === null) throw new TypeError(`not a MAJOR.MINOR.PATCH version: ${a} or ${b}`);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Runs the migrations in order. For each one: it runs when its state is pending or
 * when it is needed (its detect says so, or the campaign is older than from_version_below).
 * A migration that is not needed keeps complete when it was complete, else not-needed.
 * A guided migration without a deterministic part is pending when it is needed.
 * @param {string} root campaign folder
 * @param {{
 *   registry: ReturnType<typeof loadRegistry>,
 *   state?: Map<string, string>,          the saved statuses, by id
 *   from?: string | null,                 the campaign's framework version (null when unknown)
 *   dryRun?: boolean,                     nothing is written by a dry run
 *   recordVersion?: (() => void) | null,  saves the framework version, once, at its position
 * }} options
 * @returns {Promise<{
 *   fatal: boolean,
 *   statuses: Map<string, string>,
 *   details: Record<string, { status: string, needed: boolean, changed: string[], skipped: object[], errors: Array<{code: string, message: string, file?: string}> }>,
 *   errors: Array<{code: string, message: string, file?: string}>,
 * }>}
 */
export async function runRegistry(root, { registry, state = new Map(), from = null, dryRun = false, recordVersion = null }) {
  const statuses = new Map();
  const details = {};
  const errors = [];
  let recorded = recordVersion === null || dryRun;
  const recordOnce = () => {
    if (!recorded) {
      recorded = true;
      recordVersion();
    }
  };

  for (const migration of registry.migrations) {
    if (migration.version_record_before) recordOnce();
    const previous = state.get(migration.id);
    const needed = previous === 'pending' || (await isNeeded(root, migration, from));
    let status;
    let changed = [];
    let skipped = [];
    let problems = [];
    if (!needed) {
      status = previous === 'complete' ? 'complete' : 'not-needed';
    } else if (migration.deterministic === null) {
      status = 'pending';
    } else {
      const module = await loadModule(migration, migration.deterministic, ['apply']);
      const result = await module.apply(root, { dryRun });
      status = result.status;
      changed = [...(result.changed ?? [])];
      skipped = [...(result.skipped ?? [])];
      problems = [...(result.errors ?? [])];
      if (status === 'pending' && migration.complete === null && !dryRun) {
        status = 'failed';
        problems.push({ code: 'migration-incomplete', message: `${migration.id} has no guided part to finish its work` });
      }
    }
    details[migration.id] = { status, needed, changed, skipped, errors: problems };
    if (status === 'failed') {
      const coded = problems.length > 0 ? problems : [{ code: `${migration.id}-failed`, message: `${migration.id} could not be applied` }];
      for (const problem of coded) errors.push({ ...problem, code: problem.code ?? `${migration.id}-failed`, message: problem.message ?? problem.code });
      return { fatal: true, statuses, details, errors };
    }
    statuses.set(migration.id, status);
  }
  recordOnce();
  return { fatal: false, statuses, details, errors };
}

/**
 * Checks whether the guided part of a migration is finished (its complete module).
 * @returns {Promise<{ status: 'complete' | 'pending' | 'failed', errors: Array<{code?: string, message: string, file?: string}> }>}
 */
export async function runComplete(root, migration) {
  if (migration.complete === null) {
    return { status: 'failed', errors: [{ code: 'no-guided-part', message: `${migration.id} has no guided part` }] };
  }
  const module = await loadModule(migration, migration.complete, ['complete']);
  const result = await module.complete(root);
  return { status: result.status, errors: result.errors ?? [] };
}

// ---------------------------------------------------------------- helpers

async function isNeeded(root, migration, from) {
  if (migration.needed === 'detect') {
    const module = await loadModule(migration, migration.deterministic, ['detect']);
    return (await module.detect(root)) === true;
  }
  // An unknown campaign version is treated as the oldest one.
  if (from === null) return true;
  return compareVersions(from, migration.needed.from_version_below) < 0;
}

async function loadModule(migration, file, exported) {
  const module = await import(pathToFileURL(path.join(migration.dir, file)).href);
  for (const name of exported) {
    if (typeof module[name] !== 'function') throw new TypeError(`${migration.id}: ${file} exports no ${name}`);
  }
  return module;
}

function readMigration(dir, name, fail) {
  const data = readYaml(path.join(dir, MANIFEST_FILE), fail);
  if (data === null) return null;
  const where = `${name}/${MANIFEST_FILE}`;
  let ok = true;
  const bad = (message) => {
    ok = false;
    fail('registry-invalid', `${where}: ${message}`);
  };
  for (const key of Object.keys(data)) if (!FIELDS.includes(key)) bad(`unknown field ${key}`);
  for (const key of REQUIRED) if (data[key] === undefined) bad(`missing field ${key}`);
  if (!ok) return null;
  if (data.id !== name || !ID_RE.test(name)) bad(`id must be the folder name ${name}`);
  if (!Array.isArray(data.after) || data.after.some((id) => typeof id !== 'string')) bad('after must be a list of ids');
  if (typeof data.introduced_in !== 'string' || !SEMVER_RE.test(data.introduced_in)) bad('introduced_in must be a MAJOR.MINOR.PATCH version');
  const needed = data.needed;
  const fromBelow = needed !== null && typeof needed === 'object' && !Array.isArray(needed) ? needed.from_version_below : undefined;
  if (needed !== 'detect' && !(fromBelow !== undefined && Object.keys(needed).length === 1 && typeof fromBelow === 'string' && SEMVER_RE.test(fromBelow))) {
    bad('needed must be detect, or from_version_below with a version');
  }
  for (const key of ['deterministic', 'guided', 'complete']) {
    const value = data[key];
    if (value !== null && (typeof value !== 'string' || !value.endsWith(key === 'guided' ? '.md' : '.mjs'))) bad(`${key} must be null or a file name`);
    else if (typeof value === 'string' && !fs.existsSync(path.join(dir, value))) bad(`${key} file ${value} does not exist`);
  }
  if ((data.guided === null) !== (data.complete === null)) bad('guided and complete must both be set, or both null');
  if (data.deterministic === null && needed === 'detect') bad('needed detect requires a deterministic part');
  if (data.deterministic === null && data.guided === null) bad('a migration needs a deterministic or a guided part');
  if (data.version_record_before !== undefined && typeof data.version_record_before !== 'boolean') bad('version_record_before must be true or false');
  if (!ok) return null;
  return {
    id: data.id,
    after: data.after,
    introduced_in: data.introduced_in,
    needed: needed === 'detect' ? 'detect' : { from_version_below: fromBelow },
    deterministic: data.deterministic,
    guided: data.guided,
    complete: data.complete,
    version_record_before: data.version_record_before === true,
    dir,
  };
}

/** Kahn's algorithm; ties go to the smaller id, so the order is the same on every run. */
function orderMigrations(migrations, fail) {
  const byId = new Map(migrations.map((m) => [m.id, m]));
  for (const m of migrations) {
    for (const dep of m.after) {
      if (!byId.has(dep)) fail('registry-unknown-after', `${m.id} comes after ${dep}, which is not a migration`);
    }
  }
  if (migrations.some((m) => m.after.some((dep) => !byId.has(dep)))) return [];
  const done = new Set();
  const ordered = [];
  while (ordered.length < migrations.length) {
    const ready = migrations
      .filter((m) => !done.has(m.id) && m.after.every((dep) => done.has(dep)))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (ready.length === 0) {
      const stuck = migrations.filter((m) => !done.has(m.id)).map((m) => m.id).sort();
      fail('registry-cycle', `the order of these migrations has a cycle: ${stuck.join(', ')}`);
      return [];
    }
    ordered.push(ready[0]);
    done.add(ready[0].id);
  }
  return ordered;
}

function readYaml(file, fail) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') fail('registry-invalid', `${path.basename(path.dirname(file))}/${path.basename(file)} is missing`);
    else fail('registry-invalid', `${file} cannot be read: ${err.message}`);
    return null;
  }
  const parsed = parseYamlLite(text);
  if (parsed.errors.length > 0 || parsed.data === null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    fail('registry-invalid', `${path.basename(path.dirname(file))}/${path.basename(file)}: ${parsed.errors[0]?.message ?? 'not a mapping'}`);
    return null;
  }
  return parsed.data;
}

function parseSemver(value) {
  const match = typeof value === 'string' ? SEMVER_RE.exec(value) : null;
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}
