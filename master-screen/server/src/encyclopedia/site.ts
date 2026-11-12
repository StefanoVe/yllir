// Resolves the built static site (<campaign>/.campaign/cache/encyclopedia/) and a request path
// inside it. Every answer is a real path that is provably inside the site folder: dotfiles,
// `..`, NUL bytes and symlinks that leave the folder are refused. Owner: master-screen server.
import fs from 'node:fs/promises';
import path from 'node:path';

export function siteDirOf(campaignRoot: string): string {
  return path.join(campaignRoot, '.campaign', 'cache', 'encyclopedia');
}

/** Whether `child` is `parent` or inside it (both already real paths). */
export function isInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}

/** The real path of the built site, or null when no build exists (no index.html). */
export async function resolveSiteRoot(campaignRoot: string): Promise<string | null> {
  try {
    const real = await fs.realpath(siteDirOf(campaignRoot));
    await fs.stat(path.join(real, 'index.html'));
    return real;
  } catch {
    return null;
  }
}

/**
 * The real file a request path points to inside `siteRoot` (a real path), or null. A folder
 * means its index.html. Nothing outside the site, no dotfile and no directory listing.
 */
export async function resolveSiteFile(siteRoot: string, requestPath: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment.startsWith('.'))) return null;
  try {
    let real = await fs.realpath(path.join(siteRoot, ...segments));
    if (!isInside(siteRoot, real)) return null;
    if ((await fs.stat(real)).isDirectory()) {
      real = await fs.realpath(path.join(real, 'index.html'));
      if (!isInside(siteRoot, real)) return null;
    }
    return (await fs.stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}
