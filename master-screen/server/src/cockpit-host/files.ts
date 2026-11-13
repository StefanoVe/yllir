// File helpers of the cockpit host: the raster images of the campaign, their names and
// labels, the URL the client reads them from, and the area of a path. Owner: cockpit host.
import fs from 'node:fs/promises';
import path from 'node:path';
import { containingRoot, externalFolderRoots, type ExternalFolder } from '../docs/external.js';

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

/**
 * Every raster image of the campaign, dot folders and build folders left out. Symlinks are never
 * followed, except inside external categories: there the folder is walked through its links, each
 * real directory once, and a link is listed only when its real place is inside the campaign or
 * inside that external folder's real root.
 */
export async function listRasterImages(root: string): Promise<RasterFile[]> {
  const found: RasterFile[] = [];
  const campaignReal = await fs.realpath(root).catch(() => root);
  const externals: ExternalFolder[] = await externalFolderRoots(root).catch(() => []);
  const visited = new Set<string>();

  const walk = async (dirAbs: string, relDir: string, follow: boolean): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      const abs = path.join(dirAbs, entry.name);
      if (!follow && entry.isSymbolicLink()) continue;
      if (!follow && externals.some((external) => external.folder === rel)) continue;
      if (follow) {
        if (!(await linkedInside(abs, rel))) continue;
        const stat = await fs.stat(abs).catch(() => null);
        if (stat?.isDirectory()) {
          const real = await fs.realpath(abs).catch(() => null);
          if (real === null || visited.has(real)) continue;
          visited.add(real);
          await walk(abs, rel, true);
          continue;
        }
        if (!stat?.isFile() || !RASTER_EXTENSIONS.has(path.posix.extname(entry.name).toLowerCase())) continue;
        found.push({ rel, mtimeMs: stat.mtimeMs });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(abs, rel, false);
        continue;
      }
      if (!entry.isFile() || !RASTER_EXTENSIONS.has(path.posix.extname(entry.name).toLowerCase())) continue;
      const stat = await fs.stat(abs).catch(() => null);
      if (stat) found.push({ rel, mtimeMs: stat.mtimeMs });
    }
  };

  /** A linked entry is kept only when its real place is a root the campaign may read. */
  const linkedInside = async (abs: string, rel: string): Promise<boolean> => {
    const real = await fs.realpath(abs).catch(() => null);
    if (real === null) return false;
    return containingRoot(campaignReal, externals, real, rel) !== null;
  };

  await walk(root, '', false);
  for (const external of externals) {
    if (visited.has(external.realRoot)) continue;
    visited.add(external.realRoot);
    await walk(external.realRoot, external.folder, true);
  }
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
