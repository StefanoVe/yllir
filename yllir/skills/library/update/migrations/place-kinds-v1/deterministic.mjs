// place-kinds-v1: lists the atlas places that still have the generic 'landmark' symbol and were
// not reviewed yet (see scripts/lib/place-kinds.mjs). The guided part does the re-classification.
// This module writes nothing: apply reports 'pending' while candidates remain.
import { placeKindCandidates } from '../../scripts/lib/place-kinds.mjs';

/** True while at least one place still needs its kind reviewed. */
export function detect(root) {
  try {
    return placeKindCandidates(root).length > 0;
  } catch {
    return false;
  }
}

/** Complete when no place is left to review; pending otherwise. Nothing is written. */
export function apply(root, { dryRun = false } = {}) {
  void dryRun;
  try {
    const candidates = placeKindCandidates(root);
    return { status: candidates.length ? 'pending' : 'complete', changed: [], errors: [] };
  } catch (err) {
    return { status: 'failed', changed: [], errors: [{ code: 'place-kinds-failed', message: err.message }] };
  }
}
