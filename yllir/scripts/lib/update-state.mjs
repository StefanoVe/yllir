// Reads and writes .campaign/state/update.yaml, the state of a framework update.
// Shared by the update skill and the session check, so it lives in the framework.
//
// Current form:
//   status: in_progress | completed | cancelled
//   from_version, to_version, restore_point, started_on, completed_on
//   migrations:                       (in registry order)
//     - id: "session-layout-v1"
//       status: complete | pending | not-needed
//
// Older form (written before the migration registry): sheet_migration,
// geography_migration and world_migration, each pending or complete, plus the
// *_migration_id keys. It is read and translated to the current form; it is
// never written again.

import { parseYamlLite } from './yaml-lite.mjs';

export const UPDATE_STATE_PATH = '.campaign/state/update.yaml';

const FIELD_KEYS = ['status', 'from_version', 'to_version', 'restore_point', 'started_on', 'completed_on'];
// Written without quotes: their values never need escaping.
const UNQUOTED_KEYS = new Set(['status', 'started_on', 'completed_on']);
const MIGRATION_STATUSES = new Set(['complete', 'pending', 'not-needed']);
// Old keys and the migration each one stood for, in the order they ran before the registry.
const LEGACY_KEYS = [
  ['geography_migration', 'category-first-geography-v1'],
  ['sheet_migration', 'statistics-tables-v1'],
  ['world_migration', 'world-graph-v1'],
];

/**
 * @typedef {{
 *   status?: string, from_version?: string, to_version?: string, restore_point?: string,
 *   started_on?: string, completed_on?: string,
 *   migrations: Map<string, 'complete' | 'pending' | 'not-needed'>,
 * }} UpdateState
 */

/**
 * Parses the text of update.yaml. Old keys are translated to the current form.
 * @param {string} text
 * @returns {UpdateState | null} null when the text cannot be read
 */
export function parseUpdateState(text) {
  const parsed = parseYamlLite(text);
  if (parsed.errors.length > 0 || parsed.data === null || typeof parsed.data !== 'object') return null;
  const data = parsed.data;
  const state = { migrations: new Map() };
  for (const key of FIELD_KEYS) {
    if (data[key] !== undefined && data[key] !== null) state[key] = String(data[key]);
  }
  if (data.migrations !== undefined) {
    if (!Array.isArray(data.migrations)) return null;
    for (const item of data.migrations) {
      if (!item || typeof item.id !== 'string' || !MIGRATION_STATUSES.has(item.status)) return null;
      state.migrations.set(item.id, item.status);
    }
  }
  for (const [key, id] of LEGACY_KEYS) {
    if (state.migrations.has(id)) continue;
    if (data[key] === 'pending' || data[key] === 'complete') state.migrations.set(id, data[key]);
  }
  return state;
}

/**
 * Text of update.yaml. Fields not given are left out. migrations is a Map or
 * an array of [id, status] pairs, kept in the order given.
 * @param {{ [key: string]: string | undefined }} fields
 * @param {Iterable<[string, string]>} migrations
 */
export function formatUpdateState(fields, migrations) {
  const lines = [];
  for (const key of FIELD_KEYS) {
    if (fields[key] !== undefined) lines.push(`${key}: ${yamlScalar(key, fields[key])}`);
  }
  const pairs = [...migrations];
  lines.push(pairs.length === 0 ? 'migrations: []' : 'migrations:');
  for (const [id, status] of pairs) {
    if (!MIGRATION_STATUSES.has(status)) throw new TypeError(`unknown migration status: ${status}`);
    lines.push(`  - id: ${yamlScalar('id', id)}`, `    status: ${status}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The ids whose status is pending, in the order they are kept. */
export function pendingMigrations(state) {
  return [...state.migrations].filter(([, status]) => status === 'pending').map(([id]) => id);
}

function yamlScalar(key, value) {
  if (typeof value !== 'string' || value.includes('"') || value.includes('\n')) {
    throw new TypeError(`${key} must be a single-line string`);
  }
  return UNQUOTED_KEYS.has(key) ? value : `"${value}"`;
}
