// The atlas folders of a campaign, and the built master site (<campaign>/.campaign/cache/atlas/master/).
// Files of the site are resolved with the encyclopedia's resolver, which refuses dotfiles, `..`, NUL
// bytes and symlinks that leave the site folder. Owner: master-screen server.
import fs from 'node:fs/promises';
import path from 'node:path';

/** The strict CSP of the atlas viewer. Only these responses carry it, never the main app. */
export const ATLAS_SITE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

export function atlasCacheDir(campaignRoot: string): string {
  return path.join(campaignRoot, '.campaign', 'cache', 'atlas');
}

export function atlasSiteDir(campaignRoot: string): string {
  return path.join(atlasCacheDir(campaignRoot), 'master');
}

export function atlasPreviewFile(campaignRoot: string): string {
  return path.join(atlasCacheDir(campaignRoot), 'preview.png');
}

/** The real path of the built master site, or null when no build exists (no index.html). */
export async function resolveAtlasSiteRoot(campaignRoot: string): Promise<string | null> {
  try {
    const real = await fs.realpath(atlasSiteDir(campaignRoot));
    await fs.stat(path.join(real, 'index.html'));
    return real;
  } catch {
    return null;
  }
}
