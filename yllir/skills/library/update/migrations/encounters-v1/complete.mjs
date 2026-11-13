// encounters-v1: the guided part is finished when no event is pending.
import { prepareEncounters } from '../../scripts/lib/encounters.mjs';

export async function complete(root) {
  const inventory = await prepareEncounters(root, { persist: false });
  if (inventory.status === 'failed') return { status: 'failed', errors: inventory.errors };
  if (inventory.events.length > 0) {
    return { status: 'pending', errors: inventory.events.map((event) => ({ code: 'encounter-pending', message: `${event.file} is not finished`, file: event.file })) };
  }
  return { status: 'complete', errors: [] };
}
