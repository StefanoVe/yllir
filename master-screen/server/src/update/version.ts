// MAJOR.MINOR.PATCH versions of the framework. Owner: update engineer.

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isVersion(text: unknown): text is string {
  return typeof text === 'string' && SEMVER_RE.test(text);
}

/** -1, 0 or 1 for a < b, a = b, a > b; null when either value is not MAJOR.MINOR.PATCH. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  if (!isVersion(a) || !isVersion(b)) return null;
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}
