// item-descriptions-v1: inventory of the item sheets whose descriptions must be
// adapted to the current sheet format. The inventory is the migration's own state
// (.campaign/state/update/item-descriptions.json); the guided part writes the text.
import { prepareItemDescriptions } from '../../scripts/lib/item-descriptions.mjs';

/** True when an item sheet is not finished, or the inventory cannot be read. */
export function detect(root) {
  const inventory = prepareItemDescriptions(root, { persist: false });
  return inventory.status === 'failed' || inventory.items.some((item) => item.status !== 'complete');
}

/** Refreshes the inventory (not in a dry run). Pending while an item is not finished. */
export function apply(root, { dryRun = false } = {}) {
  const inventory = prepareItemDescriptions(root, { persist: !dryRun });
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
