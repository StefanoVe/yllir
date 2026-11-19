// Locks of the atlas layers. A locked layer keeps a snapshot (the hash of each constraint,
// in order, and of every feature). Changing or removing a locked feature or a locked
// constraint is refused unless the master unlocks the layer. Adding a feature is allowed,
// except a new land that overlaps locked land; constraints may be appended after the lock.

import { canonicalJson, sha256, featureHash, vertexOverlap, isUsablePolygon } from './geometry.mjs';

export const CONSTRAINTS_ID = '(constraints)';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function featuresOf(layer) {
  return Array.isArray(layer?.features)
    ? layer.features.filter((f) => isPlainObject(f) && typeof f.id === 'string')
    : [];
}

function constraintsOf(layer) {
  return Array.isArray(layer?.constraints) ? layer.constraints : [];
}

/** One hash per constraint, in order. */
function constraintHashes(layer) {
  return constraintsOf(layer).map((c) => sha256(canonicalJson(c)));
}

/**
 * True when the constraints of a layer no longer start with the locked ones. The locked hashes
 * must be the first N constraints, in the same order; constraints appended after the lock are fine.
 */
function constraintsChanged(lockedHashes, layer) {
  if (!Array.isArray(lockedHashes)) return true;
  const current = constraintHashes(layer);
  if (current.length < lockedHashes.length) return true;
  return lockedHashes.some((hash, i) => current[i] !== hash);
}

/**
 * Snapshot of a layer object: the hash of each constraint, in order, and the hash of each feature by id.
 * @returns {{ constraints: string[], features: Record<string, string> }}
 */
export function snapshotOf(layer) {
  const features = {};
  for (const feature of featuresOf(layer)) features[feature.id] = featureHash(feature);
  return { constraints: constraintHashes(layer), features };
}

/** Compares a snapshot with the current features of a layer (ids are sorted). */
function diffFeatures(snapshotFeatures, layer) {
  const current = new Map(featuresOf(layer).map((f) => [f.id, f]));
  const changed = [];
  const removed = [];
  const added = [];
  for (const [id, hash] of Object.entries(snapshotFeatures)) {
    const feature = current.get(id);
    if (feature === undefined) removed.push(id);
    else if (featureHash(feature) !== hash) changed.push(id);
  }
  for (const id of current.keys()) {
    if (!Object.hasOwn(snapshotFeatures, id)) added.push(id);
  }
  return { changed: changed.sort(), removed: removed.sort(), added: added.sort() };
}

/**
 * Problems of the locked layers of a manifest, given the layer objects on disk.
 * A layer file that is missing counts as an empty layer, so its locked features are removed.
 * @returns {Array<{ code: string, file: string, path: string, message: string, ids: string[] }>}
 *   file is relative to the atlas folder (for example `terrain.json`).
 */
export function lockProblems(manifest, layers) {
  const problems = [];
  const entries = isPlainObject(manifest?.layers) ? manifest.layers : {};
  for (const name of Object.keys(entries).sort()) {
    const entry = entries[name];
    if (!isPlainObject(entry) || entry.locked !== true || !isPlainObject(entry.snapshot)) continue;
    const layer = layers?.[name] ?? {};
    const { changed, removed } = diffFeatures(entry.snapshot.features ?? {}, layer);
    if (constraintsChanged(entry.snapshot.constraints, layer)) changed.unshift(CONSTRAINTS_ID);
    const ids = [...changed, ...removed];
    if (ids.length === 0) continue;
    problems.push({
      code: 'locked-layer-changed',
      file: `${name}.json`,
      path: 'features',
      message: `locked layer ${name} changed: ${ids.join(', ')}`,
      ids,
    });
  }
  return problems;
}

/**
 * Checks a write of one layer against the manifest.
 * @param {object} manifest the manifest on disk
 * @param {string} layerName the layer being written
 * @param {object} candidateLayer the layer object as it would be written
 * @param {{ unlock?: boolean, current?: object|null }} [options]
 *   current is the layer on disk now; it supplies the locked land for the overlap check.
 *   For a layer that is not locked, changes are compared with current when it is given.
 * @returns {{ ok: boolean, changed: string[], removed: string[], added: string[], overlaps: string[] }}
 */
export function checkWrite(manifest, layerName, candidateLayer, { unlock = false, current = null } = {}) {
  const entry = manifest?.layers?.[layerName];
  const locked = isPlainObject(entry) && entry.locked === true && isPlainObject(entry.snapshot);
  const base = locked ? entry.snapshot : (current ? snapshotOf(current) : null);

  let changed = [];
  let removed = [];
  let added;
  if (base) {
    ({ changed, removed, added } = diffFeatures(base.features ?? {}, candidateLayer));
    if (constraintsChanged(base.constraints, candidateLayer)) changed.unshift(CONSTRAINTS_ID);
  } else {
    added = featuresOf(candidateLayer).map((f) => f.id).sort();
  }

  const overlaps = [];
  if (layerName === 'terrain' && locked && current) {
    const lockedIds = entry.snapshot.features;
    const lockedLand = featuresOf(current)
      .filter((f) => f.type === 'land' && isUsablePolygon(f.polygon) && Object.hasOwn(lockedIds, f.id))
      .map((f) => f.polygon);
    for (const feature of featuresOf(candidateLayer)) {
      if (feature.type !== 'land' || !isUsablePolygon(feature.polygon)) continue;
      if (Object.hasOwn(lockedIds, feature.id)) continue;
      if (lockedLand.some((polygon) => vertexOverlap(feature.polygon, polygon))) overlaps.push(feature.id);
    }
    overlaps.sort();
  }

  const blocked = locked && !unlock && (changed.length > 0 || removed.length > 0);
  const overlapBlocked = overlaps.length > 0 && !unlock;
  return { ok: !blocked && !overlapBlocked, changed, removed, added, overlaps };
}
