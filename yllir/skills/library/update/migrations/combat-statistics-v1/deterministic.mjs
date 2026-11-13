// combat-statistics-v1: inventory of the characters and enemies (npc, vendor and enemy sheets) whose
// combat statistics must be written, and whose rolled amounts must be dice only. The inventory is the
// migration's own state (.campaign/state/update/combat-statistics.json); the guided part writes the sheets.
import { prepareCombatStatistics } from '../../scripts/lib/combat-statistics.mjs';

/** True when a sheet is not finished, or the inventory cannot be read. */
export async function detect(root) {
  const inventory = await prepareCombatStatistics(root, { persist: false });
  return inventory.status === 'failed' || inventory.sheets.some((sheet) => sheet.status !== 'complete');
}

/** Refreshes the inventory (not in a dry run). Pending while a sheet is not finished. */
export async function apply(root, { dryRun = false } = {}) {
  const inventory = await prepareCombatStatistics(root, { persist: !dryRun });
  if (inventory.status === 'failed') {
    return {
      status: 'failed',
      changed: [],
      errors: inventory.errors.map((error) => ({ code: 'combat-scan-failed', message: error.message ?? 'combat statistics scan failed', file: error.file })),
    };
  }
  return {
    status: inventory.status === 'complete' ? 'complete' : 'pending',
    changed: inventory.sheets.filter((sheet) => sheet.status !== 'complete').map((sheet) => sheet.file),
    errors: [],
  };
}
