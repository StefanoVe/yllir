// Districts generator of the urban atlas: a thin wrapper of the political generator (lib/political.mjs).
// The districts are the realms of the political generator, computed on a synthetic terrain: the land is
// the canvas rectangle, or the path of the first closed wall when there is one, and the lakes are the
// water polygons of the ground layer, so districts stay inside the walls and out of the water.
// Each `district` constraint is passed to the political generator as a `realm` with the same id;
// the resulting features become `district` features and copy the character of their constraint.
// Locked districts are passed as realms (their land is kept) and returned unchanged.
// Problems are { code, file, path, message }.

import { isUsablePolygon } from '../geometry.mjs';
import { polygonsOf, isPlainObject } from '../landmask.mjs';
import { generatePolitical } from '../political.mjs';

const FILE = 'districts.json';
const POLITICAL_FILE = 'political.json';
const REALM_KEYS = ['color', 'seeds', 'cuts', 'reach', 'place', 'name', 'provenance', 'sources', 'note', 'visibility'];

/** Land of the synthetic terrain: the first closed wall's path, or the whole canvas. */
function landPolygon(canvas, walls) {
  const features = Array.isArray(walls?.features) ? walls.features.filter(isPlainObject) : [];
  const wall = features.find((f) => f.type === 'wall' && f.closed === true && isUsablePolygon(f.path));
  if (wall) return wall.path;
  return [[0, 0], [canvas.width, 0], [canvas.width, canvas.height], [0, canvas.height]];
}

/** Synthetic terrain layer: one land feature and one lake per water polygon of the ground layer. */
function syntheticTerrain(canvas, layers) {
  const ground = Array.isArray(layers.ground?.features) ? layers.ground.features.filter(isPlainObject) : [];
  const lakes = ground
    .filter((f) => f.type === 'water')
    .flatMap(polygonsOf)
    .map((polygon, k) => ({ id: `water-${k + 1}`, type: 'lake', polygon }));
  return {
    layer: 'terrain',
    features: [{ id: 'city-land', type: 'land', polygon: landPolygon(canvas, layers.walls) }, ...lakes],
  };
}

/** A district constraint seen by the political generator as a realm with the same id. */
function asRealm(constraint) {
  const realm = { kind: 'realm', id: constraint.id };
  for (const key of REALM_KEYS) {
    if (constraint[key] !== undefined) realm[key] = constraint[key];
  }
  return realm;
}

/**
 * Generates the districts layer from the district constraints.
 * @param {{ canvas: { width: number, height: number }, seed: number, constraints?: object[],
 *   layers?: Record<string, { features?: object[] }>, locked?: { features: object[], constraintCount: number } | null }} input
 * @returns {{ features: object[], problems: object[] }}
 */
export function generateDistricts({ canvas, seed, constraints = [], layers = {}, locked = null } = {}) {
  const list = Array.isArray(constraints) ? constraints : [];
  const districtById = new Map();
  const callConstraints = list.map((c) => {
    if (!isPlainObject(c) || c.kind !== 'district') return c;
    districtById.set(c.id, c);
    return asRealm(c);
  });

  const lockedFeatures = locked && Array.isArray(locked.features) ? locked.features.filter(isPlainObject) : [];
  const lockedById = new Map(lockedFeatures.map((f) => [f.id, f]));
  const callLocked = locked
    ? { ...locked, features: lockedFeatures.map((f) => ({ ...f, type: 'realm' })) }
    : null;

  const result = generatePolitical({
    canvas,
    seed,
    constraints: callConstraints,
    layers: { terrain: syntheticTerrain(canvas, layers) },
    locked: callLocked,
  });

  const features = result.features.map((f) => {
    if (lockedById.has(f.id)) return { ...lockedById.get(f.id) };
    const { type, ...rest } = f;
    const feature = { ...rest, type: 'district' };
    const source = districtById.get(f.id);
    if (source?.character !== undefined) feature.character = source.character;
    return feature;
  });

  const problems = result.problems.map((p) => (p.file === POLITICAL_FILE ? { ...p, file: FILE } : p));
  return { features, problems };
}
