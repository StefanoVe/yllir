// atlas-site-v2: rebuilds the cached atlas sites (.campaign/cache/atlas/<audience>/) that were
// rendered before 0.95.0, when the base picture had no feathered edges, so the sea blends at the
// edge without a manual render. A site is stale when its index.html inlines a non-null sea (a
// "sea" object in the page data) and the file does not contain the text feather-mx. A site with
// "sea":null, with no sea key, or already containing feather-mx is kept as it is. Only the derived
// cache is touched; a site that cannot be rebuilt is skipped and the old one stays in place.
// Deterministic and idempotent.
import fs from 'node:fs';
import path from 'node:path';
import { exportAtlas } from '../../../atlas/scripts/lib/export.mjs';

const AUDIENCES = ['master', 'players'];
const SITE_CACHE = path.join('.campaign', 'cache', 'atlas');
const SEA_OBJECT = /"sea"\s*:\s*\{/;
const FEATHERED = 'feather-mx';

/** The audiences whose cached site exists, has a sea object and was rendered without feathered edges. */
function staleAudiences(root) {
  return AUDIENCES.filter((audience) => {
    const file = path.join(root, SITE_CACHE, audience, 'index.html');
    if (!fs.existsSync(file)) return false;
    const html = fs.readFileSync(file, 'utf8');
    return SEA_OBJECT.test(html) && !html.includes(FEATHERED);
  });
}

/** True while at least one cached atlas site is stale. */
export function detect(root) {
  try {
    return staleAudiences(root).length > 0;
  } catch {
    return false;
  }
}

/** A dry run lists the sites it would rebuild; a real run rebuilds them through the atlas export. */
export function apply(root, { dryRun = false } = {}) {
  let stale;
  try {
    stale = staleAudiences(root);
  } catch (err) {
    return { status: 'failed', changed: [], skipped: [], errors: [{ code: 'atlas-site-failed', message: err.message }] };
  }
  const relPath = (audience) => path.posix.join('.campaign', 'cache', 'atlas', audience, 'index.html');
  if (dryRun) return { status: 'complete', changed: stale.map(relPath), errors: [] };

  const changed = [];
  const skipped = [];
  for (const audience of stale) {
    try {
      const result = exportAtlas(root, { audience });
      if (result.ok) changed.push(relPath(audience));
      else skipped.push({ audience, reason: result.problems?.[0]?.message ?? 'the atlas could not be rebuilt' });
    } catch (err) {
      skipped.push({ audience, reason: err.message });
    }
  }
  return { status: 'complete', changed, skipped, errors: [] };
}
