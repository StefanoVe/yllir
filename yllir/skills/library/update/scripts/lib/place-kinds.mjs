// Places of the atlas that still have the generic 'landmark' symbol and were not reviewed yet.
// Used by the place-kinds-v1 migration: the deterministic part lists them, the guided part
// re-classifies them from their sheets, and markReviewed records that the review is done.
// A kind the master chose (provenance 'master') is never a candidate.
import fs from 'node:fs';
import path from 'node:path';
import { readAtlas } from '../../../atlas/scripts/lib/model.mjs';

export const STATE_FILE = '.campaign/state/update/place-kinds.json';

/** The ids already reviewed, from the state file. A missing or invalid file counts as empty. */
function reviewedIds(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), 'utf8'));
    const list = parsed && Array.isArray(parsed.reviewed) ? parsed.reviewed : [];
    return list.filter((id) => typeof id === 'string');
  } catch {
    return [];
  }
}

/** The places still to review: { id, place } for each landmark not chosen by the master and not yet reviewed. */
export function placeKindCandidates(root) {
  const { dir, labels } = readAtlas(root);
  if (dir === null || !labels || !Array.isArray(labels.places)) return [];
  const reviewed = new Set(reviewedIds(root));
  return labels.places
    .filter((item) => item !== null && typeof item === 'object')
    .filter((item) => typeof item.id === 'string')
    .filter((item) => item.kind === 'landmark' && item.provenance !== 'master' && !reviewed.has(item.id))
    .map((item) => ({ id: item.id, place: typeof item.place === 'string' ? item.place : item.id }));
}

/** Records the ids of every current candidate as reviewed (merged with the ids already there). */
export function markReviewed(root) {
  const candidates = placeKindCandidates(root);
  const before = reviewedIds(root);
  const added = candidates.map((c) => c.id).filter((id) => !before.includes(id));
  const all = [...new Set([...before, ...added])].sort();
  const file = path.join(root, STATE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ reviewed: all }, null, 2)}\n`);
  return { status: 'complete', reviewed: [...new Set(added)].sort() };
}
