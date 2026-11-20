// Places of the campaign that are in the scope of the atlas but are not on the map yet. The places
// themselves come from the world index (the sheets); a place is on the map when labels.json has a
// places item that names it.

import path from 'node:path';
import { buildWorldIndex } from '../../../../../scripts/lib/world-graph.mjs';

/**
 * The folder of a place whose file is `A/B/B.md` (the file name equals the parent folder),
 * with a trailing slash. Otherwise null: the place has no sub-folder.
 */
export function folderOfPlace(subject) {
  const dir = path.posix.dirname(subject.file);
  const base = path.posix.basename(subject.file, '.md');
  return base === path.posix.basename(dir) ? `${dir}/` : null;
}

/**
 * True when a subject is in the scope. An empty scope.places means every place is in scope;
 * otherwise a subject is in scope when its id is listed, or its file lies under the folder of a listed place.
 */
export function inScope(subject, scope, worldIndex) {
  const listed = Array.isArray(scope?.places) ? scope.places : [];
  if (listed.length === 0) return true;
  if (listed.includes(subject.id)) return true;
  return listed.some((id) => {
    const place = worldIndex.subjects.find((s) => s.id === id && s.kind === 'place');
    const folder = place ? folderOfPlace(place) : null;
    return folder !== null && subject.file.startsWith(folder);
  });
}

/** The place ids on the map: the `place` of each item of labels.places. */
function placedIds(atlas) {
  const items = Array.isArray(atlas.labels?.places) ? atlas.labels.places : [];
  return new Set(items.map((item) => item?.place).filter((id) => typeof id === 'string'));
}

/**
 * In-scope places (`{ id, title, file }`, sorted by id) that are not on the map yet. A place is on the map
 * when labels.places names it, or when it is listed in scope.places.
 * @param {string} root campaign folder
 * @param {{ manifest: object|undefined, labels: object|undefined }} atlas as read by readAtlas
 * @param {{ subjects: object[] }} [worldIndex] built when omitted
 */
export function pendingPlaces(root, atlas, worldIndex) {
  const scope = atlas?.manifest?.scope;
  if (!scope || typeof scope !== 'object') return [];
  const index = worldIndex ?? buildWorldIndex(root);
  const placed = placedIds(atlas);
  const listed = Array.isArray(scope.places) ? scope.places : [];
  return index.subjects
    .filter((s) => s.kind === 'place' && !placed.has(s.id) && !listed.includes(s.id) && inScope(s, scope, index))
    .map((s) => ({ id: s.id, title: s.title, file: s.file }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
