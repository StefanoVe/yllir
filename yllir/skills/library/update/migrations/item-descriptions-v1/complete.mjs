// The guided part is finished when every item of the inventory is complete.
import { prepareItemDescriptions } from '../../scripts/lib/item-descriptions.mjs';

export function complete(root) {
  const inventory = prepareItemDescriptions(root, { persist: false });
  if (inventory.status === 'failed') return { status: 'failed', errors: inventory.errors };
  const open = inventory.items.filter((item) => item.status !== 'complete');
  if (open.length > 0) {
    return { status: 'pending', errors: open.map((item) => ({ code: 'item-pending', message: `${item.file} is not finished`, file: item.file })) };
  }
  return { status: 'complete', errors: [] };
}
