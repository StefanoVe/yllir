// prose-style-v1: the prose pass after a framework update. Needed while the generated documents
// have abbreviated names or spoken lines that the pass has not reviewed (its state file is pending).
// The state (.campaign/state/update/prose-style.json) is kept by lib/prose-style.mjs.
import { prepareProseStyle } from '../../scripts/lib/prose-style.mjs';

/** True when the pass has chunks that are not done. Nothing is written. */
export async function detect(root) {
  const inventory = await prepareProseStyle(root, { persist: false });
  if (inventory.status === 'failed') return false;
  return inventory.status === 'pending';
}

/** Prepares the chunks (not in a dry run). Pending while a chunk is not done. */
export async function apply(root, { dryRun = false } = {}) {
  const inventory = await prepareProseStyle(root, { persist: !dryRun });
  if (inventory.status === 'failed') {
    return {
      status: 'failed',
      changed: [],
      errors: inventory.errors.map((error) => ({ code: error.code ?? 'prose-style-failed', message: error.message ?? 'prose pass could not be prepared', file: error.file })),
    };
  }
  return { status: inventory.status === 'complete' ? 'complete' : 'pending', changed: [], errors: [] };
}
