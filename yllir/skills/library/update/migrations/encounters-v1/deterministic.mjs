// encounters-v1: the inventory of the event files whose fights must be declared (the enemies block).
// Needed while an event is pending. The inventory is .campaign/state/update/encounters.json.
import { prepareEncounters } from '../../scripts/lib/encounters.mjs';

/** True while an event is pending, or the inventory cannot be read. */
export async function detect(root) {
  const inventory = await prepareEncounters(root, { persist: false });
  return inventory.status !== 'complete';
}

/** Refreshes the inventory (not in a dry run). Pending while an event is pending. */
export async function apply(root, { dryRun = false } = {}) {
  const inventory = await prepareEncounters(root, { persist: !dryRun });
  if (inventory.status === 'failed') {
    return {
      status: 'failed',
      changed: [],
      errors: inventory.errors.map((error) => ({ code: error.code ?? 'encounter-scan-failed', message: error.message ?? 'event scan failed', file: error.file })),
    };
  }
  return {
    status: inventory.status === 'complete' ? 'complete' : 'pending',
    changed: inventory.events.map((event) => event.file),
    errors: [],
  };
}
