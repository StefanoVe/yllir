// public-knowledge-v1: the guided part is finished when every sheet of the inventory is complete
// (.campaign/state/update/public-knowledge.json).
import { prepareItemDescriptions } from '../../scripts/lib/item-descriptions.mjs';

export function complete(root) {
  const inventory = prepareItemDescriptions(root, { persist: false, migration: 'public-knowledge-v1' });
  if (inventory.status === 'failed') return { status: 'failed', errors: inventory.errors };
  const open = inventory.items.filter((item) => item.status !== 'complete');
  if (open.length > 0) {
    return { status: 'pending', errors: open.map((item) => ({ code: 'sheet-pending', message: `${item.file} is not finished`, file: item.file })) };
  }
  return { status: 'complete', errors: [] };
}
