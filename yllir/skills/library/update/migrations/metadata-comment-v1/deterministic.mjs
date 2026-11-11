// metadata-comment-v1: converts the metadata block of campaign Markdown files from the
// YAML frontmatter form (--- lines) to the comment form (<!-- yllir ... -->), which
// Markdown previews hide. Deterministic and idempotent; the whole logic is in
// scripts/lib/migrate-metadata.mjs. It saves no version: the update runner does that.
import { applyMetadataMigration, planMetadataMigration } from '../../scripts/lib/migrate-metadata.mjs';

/** True while at least one listed file still has the old form. */
export function detect(root) {
  return planMetadataMigration(root).status !== 'complete';
}

/** A dry run plans the changes; a real run converts the files. */
export function apply(root, { dryRun = false } = {}) {
  const result = dryRun ? planMetadataMigration(root) : applyMetadataMigration(root);
  return { status: result.status, changed: result.changed, errors: result.errors };
}
