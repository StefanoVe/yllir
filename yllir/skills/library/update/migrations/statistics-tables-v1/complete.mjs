// The guided part is finished when a full rescan finds no old table.
import { completePostUpdate } from '../../scripts/lib/post-update.mjs';

export function complete(root) {
  const result = completePostUpdate(root);
  const status = result.status === 'complete' ? 'complete' : result.status === 'pending' ? 'pending' : 'failed';
  return { status, errors: result.errors ?? [] };
}
