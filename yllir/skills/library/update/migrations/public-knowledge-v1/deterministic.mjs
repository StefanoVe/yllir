// public-knowledge-v1: inventory of the sheets whose public part must hold only what the players may
// know (item sheets with a Finding section or an unknown item type, and full non-item sheets without a
// Synopsis first). The inventory is the migration's own state (.campaign/state/update/public-knowledge.json);
// the guided part writes the text.
import { prepareItemDescriptions } from '../../scripts/lib/item-descriptions.mjs';

/** True when a sheet is not finished, or the inventory cannot be read. */
export function detect(root) {
  const inventory = prepareItemDescriptions(root, { persist: false, migration: 'public-knowledge-v1' });
  return inventory.status === 'failed' || inventory.items.some((item) => item.status !== 'complete');
}

/** Refreshes the inventory (not in a dry run). Pending while a sheet is not finished. */
export function apply(root, { dryRun = false } = {}) {
  const inventory = prepareItemDescriptions(root, { persist: !dryRun, migration: 'public-knowledge-v1' });
  if (inventory.status === 'failed') {
    return {
      status: 'failed',
      changed: [],
      errors: inventory.errors.map((error) => ({ code: 'item-description-scan-failed', message: error.message ?? 'item scan failed', file: error.file })),
    };
  }
  return {
    status: inventory.status === 'complete' ? 'complete' : 'pending',
    changed: inventory.items.filter((item) => item.status !== 'complete').map((item) => item.file),
    errors: [],
  };
}
