// scene-checks-v1: inventory of the plot event files (scenes) whose checks must be written in the
// new form. The inventory is the migration's own state (.campaign/state/update/scene-checks.json);
// the guided part writes the scenes.
import { prepareSceneChecks } from '../../scripts/lib/scene-checks.mjs';

/** True when a scene is not finished, or the inventory cannot be read. */
export async function detect(root) {
  const inventory = await prepareSceneChecks(root, { persist: false });
  return inventory.status === 'failed' || inventory.scenes.some((scene) => scene.status !== 'complete');
}

/** Refreshes the inventory (not in a dry run). Pending while a scene is not finished. */
export async function apply(root, { dryRun = false } = {}) {
  const inventory = await prepareSceneChecks(root, { persist: !dryRun });
  if (inventory.status === 'failed') {
    return {
      status: 'failed',
      changed: [],
      errors: inventory.errors.map((error) => ({ code: 'scene-scan-failed', message: error.message ?? 'scene scan failed', file: error.file })),
    };
  }
  return {
    status: inventory.status === 'complete' ? 'complete' : 'pending',
    changed: inventory.scenes.filter((scene) => scene.status !== 'complete').map((scene) => scene.file),
    errors: [],
  };
}
