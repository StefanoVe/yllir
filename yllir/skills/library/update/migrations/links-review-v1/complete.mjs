// links-review-v1: the guided part is finished when every chunk of the pass is done
// (.campaign/state/update/links-review.json).
import { prepareLinksReview } from '../../scripts/lib/links-review.mjs';

export async function complete(root) {
  const inventory = await prepareLinksReview(root, { persist: false });
  if (inventory.status === 'failed') return { status: 'failed', errors: inventory.errors };
  const open = inventory.chunks.filter((chunk) => chunk.status !== 'done');
  if (open.length > 0) {
    return { status: 'pending', errors: open.map((chunk) => ({ code: 'chunk-pending', message: `${chunk.id} is not done`, file: chunk.files[0] })) };
  }
  return { status: 'complete', errors: [] };
}
