// combat-statistics-v1: the guided part is finished when every sheet of the inventory is complete
// (.campaign/state/update/combat-statistics.json).
import { prepareCombatStatistics } from '../../scripts/lib/combat-statistics.mjs';

export async function complete(root) {
  const inventory = await prepareCombatStatistics(root, { persist: false });
  if (inventory.status === 'failed') return { status: 'failed', errors: inventory.errors };
  const open = inventory.sheets.filter((sheet) => sheet.status !== 'complete');
  if (open.length > 0) {
    return { status: 'pending', errors: open.map((sheet) => ({ code: 'combat-sheet-pending', message: `${sheet.file} is not finished`, file: sheet.file })) };
  }
  return { status: 'complete', errors: [] };
}
