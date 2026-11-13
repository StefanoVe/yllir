// Validation of a document path the agent asks the screen to open. Owner: chat engineer.
import fs from 'node:fs/promises';
import path from 'node:path';
import { containingRoot, externalFolderRoots } from '../docs/external.js';

/**
 * Returns the campaign-relative path (with "/" separators) when `rel` names an existing
 * Markdown file inside the campaign and outside `.campaign/`, or inside the real folder of an
 * external category; otherwise null. Symbolic links are resolved, so a link pointing outside
 * those roots is refused.
 */
export async function validateOpenPath(campaignRoot: string, rel: unknown): Promise<string | null> {
  if (typeof rel !== 'string') return null;
  const value = rel.trim();
  if (value === '' || value.length > 512) return null;
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return null;
  const segments = value.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  if (segments[0] === '.campaign') return null;
  if (!value.toLowerCase().endsWith('.md')) return null;

  const root = path.resolve(campaignRoot);
  const target = path.join(root, ...segments);
  const reqRel = segments.join('/');
  try {
    const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
    const base = containingRoot(realRoot, await externalFolderRoots(root), realTarget, reqRel);
    if (base === null) return null;
    const relative = path.relative(base, realTarget);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    if (relative.split(path.sep)[0] === '.campaign') return null;
    const stat = await fs.stat(realTarget);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  return reqRel;
}
