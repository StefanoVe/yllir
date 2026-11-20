// Places of the campaign that are in the scope of the atlas but have no feature in the
// places layer yet. The places themselves come from the world index (the sheets).

import path from 'node:path';
import { buildWorldIndex } from '../../../../../scripts/lib/world-graph.mjs';
import { isUrbanScope } from './model.mjs';

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

/**
 * The place ids already in the atlas. A geographic atlas counts its places layer; an urban one counts
 * the buildings and the districts (a place is placed by either of them).
 */
function placedIds(atlas, scope) {
  const featuresOf = (name) => (Array.isArray(atlas.layers?.[name]?.features) ? atlas.layers[name].features : []);
  const layerNames = isUrbanScope(scope.kind) ? ['buildings', 'districts'] : ['places'];
  return new Set(layerNames.flatMap(featuresOf).map((f) => f?.place).filter((id) => typeof id === 'string'));
}

/**
 * In-scope places (`{ id, title, file }`, sorted by id) with no feature for them yet.
 * Urban scope: no buildings or districts feature for the place, and not listed in scope.places.
 * @param {string} root campaign folder
 * @param {{ manifest: object|null, layers: object }} atlas as read by readAtlas
 * @param {{ subjects: object[] }} [worldIndex] built when omitted
 */
export function pendingPlaces(root, atlas, worldIndex) {
  const scope = atlas?.manifest?.scope;
  if (!scope || typeof scope !== 'object') return [];
  const index = worldIndex ?? buildWorldIndex(root);
  const placed = placedIds(atlas, scope);
  const urban = isUrbanScope(scope.kind);
  const listed = Array.isArray(scope.places) ? scope.places : [];
  return index.subjects
    .filter((s) => s.kind === 'place' && !placed.has(s.id) && inScope(s, scope, index))
    .filter((s) => !urban || !listed.includes(s.id))
    .map((s) => ({ id: s.id, title: s.title, file: s.file }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
