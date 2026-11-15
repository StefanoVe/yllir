// links-review-v1: the link pass after a framework update. Needed while the campaign has mentions
// that the engine did not link and the pass has not been completed (its state file is pending).
// The state (.campaign/state/update/links-review.json) is kept by lib/links-review.mjs.
import { prepareLinksReview } from '../../scripts/lib/links-review.mjs';

/** True when the pass has chunks that are not done. Nothing is written. */
export async function detect(root) {
  const inventory = await prepareLinksReview(root, { persist: false });
  if (inventory.status === 'failed') return false;
  return inventory.status === 'pending';
}

/** Prepares the chunks (not in a dry run). Pending while a chunk is not done. */
export async function apply(root, { dryRun = false } = {}) {
  const inventory = await prepareLinksReview(root, { persist: !dryRun });
  if (inventory.status === 'failed') {
    return {
      status: 'failed',
      changed: [],
      errors: inventory.errors.map((error) => ({ code: error.code ?? 'links-review-failed', message: error.message ?? 'links review could not be prepared', file: error.file })),
    };
  }
  return { status: inventory.status === 'complete' ? 'complete' : 'pending', changed: [], errors: [] };
}
