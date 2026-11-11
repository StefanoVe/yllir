// world-graph-v1: brings a campaign written before the world graph up to the current
// document format. Deterministic and idempotent; the whole logic is in
// scripts/lib/migrate-world.mjs. Its own saved version is made after the framework
// version is saved (version_record_before in migration.yaml).
import { applyWorldMigration, planWorldMigration } from '../../scripts/lib/migrate-world.mjs';

/**
 * True while the world migration has work: an old document, an old campaign.yaml key, a
 * generated AGENTS.md (removed since 0.31.0) or old topics. A campaign at 0.30.x needs it too.
 */
export function detect(root) {
  return planWorldMigration(root).status !== 'complete';
}

/** A dry run plans the changes; a real run applies them and saves its own version. */
export function apply(root, { dryRun = false } = {}) {
  const result = dryRun ? planWorldMigration(root) : applyWorldMigration(root);
  return { status: result.status, changed: result.changed, skipped: result.skipped, errors: result.errors };
}
