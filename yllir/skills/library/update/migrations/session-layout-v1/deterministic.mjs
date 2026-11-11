// session-layout-v1: converts the sessions of the old layout (one file per session)
// to session folders with one file per scene, and rewrites the session maps.
// Deterministic. The conversion itself is scripts/lib/migrate-sessions.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { migrateSessions } from '../../scripts/lib/migrate-sessions.mjs';
import { plotMap } from '../../../../../scripts/lib/plot/plot-map.mjs';
import { renderSessionMap, writeSessionMaps } from '../../../../../scripts/lib/plot/session-map.mjs';

/** True when an old session file is left, or a session map is missing or out of date. */
export function detect(root) {
  const dry = migrateSessions(root, { dryRun: true });
  if (dry.migrated.length > 0 || dry.errors.some((error) => error.code !== 'migrate-skipped')) return true;
  return staleSessionMaps(root);
}

/** Converts the sessions, then writes the session maps. A dry run writes nothing. */
export function apply(root, { dryRun = false } = {}) {
  const migration = migrateSessions(root, { dryRun });
  if (migration.errors.some((error) => error.code !== 'migrate-skipped')) {
    return { status: 'failed', changed: migration.migrated, errors: migration.errors };
  }
  if (!dryRun) writeSessionMaps(root, plotMap(root).sessions);
  return { status: 'complete', changed: migration.migrated, errors: migration.errors };
}

function staleSessionMaps(root) {
  for (const session of plotMap(root).sessions) {
    let current = null;
    try {
      current = fs.readFileSync(path.join(root, session.file), 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (current !== renderSessionMap(session)) return true;
  }
  return false;
}
