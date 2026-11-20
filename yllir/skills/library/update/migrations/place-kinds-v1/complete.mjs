// place-kinds-v1: the guided part is finished when every landmark place has been reviewed
// (the review records them in the state file of scripts/lib/place-kinds.mjs).
import { placeKindCandidates } from '../../scripts/lib/place-kinds.mjs';

export function complete(root) {
  const candidates = placeKindCandidates(root);
  if (candidates.length === 0) return { status: 'complete', errors: [] };
  return {
    status: 'pending',
    errors: candidates.map((c) => ({ code: 'place-kind-pending', message: `${c.place} still has the generic landmark symbol and was not reviewed` })),
  };
}
