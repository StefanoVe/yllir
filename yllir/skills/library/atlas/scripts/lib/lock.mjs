// Locks of the atlas. Two things can be locked: the painted base (`base`) and the land mask
// (`land`). A locked item carries its hash in atlas.json; the caller checks the file on disk
// against it. Changing the land of a locked atlas is refused unless the master unlocks it, or
// the change only adds land (extend) and loses none.

export const LOCKABLE = ['base', 'land'];

/** Changes of the land below this many pixels, on each side, are noise and are not counted. */
const NOISE_PIXELS = 25;
const HEX64 = /^[0-9a-f]{64}$/;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Problems of the locks in a manifest that do not need the files: a locked item without a sha256.
 * @returns {Array<{ code: string, file: string, path: string, message: string }>}
 */
export function lockProblems(manifest) {
  const problems = [];
  if (!isPlainObject(manifest)) return problems;
  for (const name of LOCKABLE) {
    const entry = manifest[name];
    if (!isPlainObject(entry) || entry.locked !== true) continue;
    if (!HEX64.test(entry.sha256 ?? '')) {
      problems.push({
        code: 'locked-without-hash',
        file: 'atlas.json',
        path: `${name}.sha256`,
        message: `${name} is locked but has no sha256`,
      });
    }
  }
  return problems;
}

/**
 * A new manifest with the lock flag of each named item set. Pure: the given manifest is never changed.
 * Locking an item that does not exist throws; unlocking one that does not exist changes nothing.
 * @param {object} manifest the manifest on disk
 * @param {string[]} names items to change, each one of LOCKABLE
 * @param {boolean} locked the new state
 * @returns {object} the new manifest
 */
export function setLock(manifest, names, locked) {
  if (!isPlainObject(manifest)) throw new TypeError('setLock expects the manifest object');
  const next = structuredClone(manifest);
  for (const name of names) {
    if (!LOCKABLE.includes(name)) throw new RangeError(`cannot lock ${name}: not one of ${LOCKABLE.join(', ')}`);
    if (!isPlainObject(next[name])) {
      if (locked) throw new Error(`cannot lock ${name}: it does not exist yet`);
      continue;
    }
    next[name].locked = locked;
  }
  return next;
}

/**
 * Whether a change of the land is allowed by the lock.
 * @param {{ manifest: object, diff?: { gained: number, lost: number }, extend?: boolean, unlock?: boolean }} change
 *   diff counts the land pixels gained (sea to land) and lost (land to sea) by the change.
 *   extend allows a change that only gains land. unlock is the master's explicit request.
 * @returns {{ ok: true } | { ok: false, reason: 'land-locked' }}
 */
export function checkLandChange({ manifest, diff = { gained: 0, lost: 0 }, extend = false, unlock = false }) {
  if (manifest?.land?.locked !== true) return { ok: true };
  if (unlock) return { ok: true };
  const gained = diff.gained >= NOISE_PIXELS ? diff.gained : 0;
  const lost = diff.lost >= NOISE_PIXELS ? diff.lost : 0;
  if (extend && lost === 0) return { ok: true };
  if (gained + lost > 0) return { ok: false, reason: 'land-locked' };
  return { ok: true };
}
