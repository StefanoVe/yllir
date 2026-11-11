// scene-checks-v1: the guided part is finished when every scene of the inventory is complete
// (.campaign/state/update/scene-checks.json).
import { prepareSceneChecks } from '../../scripts/lib/scene-checks.mjs';

export async function complete(root) {
  const inventory = await prepareSceneChecks(root, { persist: false });
  if (inventory.status === 'failed') return { status: 'failed', errors: inventory.errors };
  const open = inventory.scenes.filter((scene) => scene.status !== 'complete');
  if (open.length > 0) {
    return { status: 'pending', errors: open.map((scene) => ({ code: 'scene-pending', message: `${scene.file} is not finished`, file: scene.file })) };
  }
  return { status: 'complete', errors: [] };
}
