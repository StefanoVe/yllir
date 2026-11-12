// File helpers of the cockpit host: the raster images of the campaign, their names and
// labels, the URL the client reads them from, and the area of a path. Owner: cockpit host.
import fs from 'node:fs/promises';
import path from 'node:path';

export const RASTER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
/** Folders never walked for images (dot folders are skipped by name). */
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'test-results']);

/** Returns the category folder that contains a campaign-relative path, if any. */
export type FolderOf = (rel: string) => string | undefined;

export interface RasterFile {
  /** Campaign-relative path with "/" separators. */
  rel: string;
  mtimeMs: number;
}

/** A battle map or other "variant" suffix: "-senza-griglia" or "-senza-etichette". */
export const VARIANT = /-senza-(etichette|griglia)$/i;
/** The stem the images skill gives a battle map: "<slug>-map", "<slug>-map-2", "<slug>-map-grid". */
export const SKILL_MAP = /-map(-\d+)?(-grid)?$/i;
/** The grid version of a battle map made by the images skill. */
export const SKILL_GRID = /-map(-\d+)?-grid$/i;
export const THUMBNAIL = /-thumbnail$/i;

const TYPE_SUFFIX = /-(veduta|pianta|mappa|carta)$/i;

/** Every raster image of the campaign, dot folders and build folders left out, symlinks never followed. */
export async function listRasterImages(root: string): Promise<RasterFile[]> {
  const found: RasterFile[] = [];
  const walk = async (dirAbs: string, relDir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      const abs = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile() || !RASTER_EXTENSIONS.has(path.posix.extname(entry.name).toLowerCase())) continue;
      const stat = await fs.stat(abs).catch(() => null);
      if (stat) found.push({ rel, mtimeMs: stat.mtimeMs });
    }
  };
  await walk(root, '');
  return found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** The URL the client reads a campaign file from: the existing file route, never /api/asset. */
export function fileUrl(rel: string): string {
  return `/api/file?path=${encodeURIComponent(rel)}`;
}

/** Path without its extension. */
export function stemOf(rel: string): string {
  return rel.slice(0, rel.length - path.posix.extname(rel).length);
}

/**
 * The area of a file: the folders between its category folder and the file, without
 * the "img" and "Master" folders. "Mondo/Morvalle/img/x.png" in category "Mondo" is "Morvalle".
 */
export function areaOf(rel: string, categoryFolder: string | undefined): string {
  const directories = rel.split('/').slice(0, -1);
  const skip = categoryFolder ? categoryFolder.split('/').length : 0;
  return directories
    .slice(skip)
    .filter((part) => part !== 'img' && part !== 'Master')
    .join(' / ');
}

/** A readable label from a file stem: the battle map, variant, thumbnail and type suffixes are dropped. */
export function labelOf(stem: string): string {
  const base = stem
    .replace(/^battlemap-/i, '')
    .replace(THUMBNAIL, '')
    .replace(VARIANT, '')
    .replace(SKILL_MAP, '')
    .replace(TYPE_SUFFIX, '');
  const words = base
    .split(/[-_\s]+/)
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toLocaleUpperCase('it') + word.slice(1));
  return words.join(' ') || stem;
}

/** Compares two campaign paths by code units, so the order does not depend on the locale. */
export function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
