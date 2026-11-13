// External category folders: a folder of campaign.yaml with `type: external` is a shared world kept
// outside the campaign (a symbolic link, or a folder holding links). Its real location is a READ-ONLY
// root: the docs and the assistant may read it, nothing may write into it. Owner: docs engineer.
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDocModules, readCampaignConfig } from './scan.js';

/** The Yllir plugin folder, whose scripts/lib holds the campaign.yaml parser. Set once at start-up. */
let frameworkRoot: string | null = null;

export function setExternalFrameworkRoot(dir: string | null): void {
  frameworkRoot = dir === null ? null : path.resolve(dir);
}

export interface ExternalFolder {
  /** Campaign-relative folder, normalized, with "/" separators. */
  folder: string;
  /** Real absolute path the folder resolves to. */
  realRoot: string;
}

/** True when `rel` (campaign-relative, "/" separators) is the folder or inside it. */
export function isUnderFolder(rel: string, folder: string): boolean {
  return rel === folder || rel.startsWith(`${folder}/`);
}

function isSafeFolder(folder: string): boolean {
  if (folder.includes('\0') || path.posix.isAbsolute(folder) || /^[a-zA-Z]:/.test(folder)) return false;
  const segments = folder.split('/');
  if (segments.includes('..') || segments.includes('.git')) return false;
  return segments[0] !== '.campaign';
}

/** The campaign-relative folders of the structure entries with type `external`; [] when campaign.yaml is missing or invalid. */
export async function externalFolders(root: string): Promise<string[]> {
  if (frameworkRoot === null) return [];
  let config;
  try {
    const mods = await loadDocModules({ frameworkRoot });
    config = await readCampaignConfig({ campaignRoot: root }, mods);
  } catch {
    return [];
  }
  if (!config.ok) return [];
  const out: string[] = [];
  for (const entry of config.structure) {
    if (entry.type !== 'external' || !isSafeFolder(entry.folder) || out.includes(entry.folder)) continue;
    out.push(entry.folder);
  }
  return out;
}

/** Each external folder with its real path; folders that do not exist or are not directories are left out. */
export async function externalFolderRoots(root: string): Promise<ExternalFolder[]> {
  const out: ExternalFolder[] = [];
  for (const folder of await externalFolders(root)) {
    try {
      const realRoot = await fs.realpath(path.join(root, folder));
      if ((await fs.stat(realRoot)).isDirectory()) out.push({ folder, realRoot });
    } catch {
      // Missing or unresolvable: not a root.
    }
  }
  return out;
}

/** The real paths of the external folders (see externalFolderRoots). */
export async function externalRealRoots(root: string): Promise<string[]> {
  return (await externalFolderRoots(root)).map((entry) => entry.realRoot);
}

/**
 * The root that a real path belongs to, for a campaign-relative request `rel`: the campaign's real
 * root, or the real root of an external folder that `rel` starts with. Null when neither holds.
 */
export function containingRoot(
  campaignRealRoot: string,
  externals: ExternalFolder[],
  real: string,
  rel: string,
): string | null {
  // The root itself counts as inside (a linked folder is entered at its root); files never equal a root.
  const inside = (base: string): boolean => {
    const relative = path.relative(base, real);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  if (inside(campaignRealRoot)) return campaignRealRoot;
  const match = externals.find((entry) => isUnderFolder(rel, entry.folder) && inside(entry.realRoot));
  return match?.realRoot ?? null;
}
