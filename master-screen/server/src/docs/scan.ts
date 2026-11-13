// Campaign file access for the docs routes: listing of the Markdown documents, safe
// resolution of a requested path inside the campaign, and the framework modules the
// docs code reuses at run time. Owner: docs engineer.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from '../context.js';
import { loadFrameworkModule } from '../engine.js';
import { containingRoot, externalFolderRoots, isUnderFolder } from './external.js';

export interface PublicTextModule {
  MASTER_MARKER: string;
  isPublicDocument(relPath: string, config: unknown): boolean;
}
export interface FrontmatterModule {
  parseFrontmatter(text: string): { body: string };
}
export interface FoldModule {
  foldForm(s: string): string;
  foldText(s: string): { folded: string; map: number[] };
}
export interface YamlModule {
  parseYamlLite(text: string): { data: unknown; errors: unknown[] };
}
export interface SubjectsModule {
  buildSubjectIndex(root: string): {
    subjects: Array<{ id: string; sheet: string; category: string }>;
  };
}

export interface DocModules {
  publicText: PublicTextModule;
  frontmatter: FrontmatterModule;
  fold: FoldModule;
  yaml: YamlModule;
  subjects: SubjectsModule;
}

export async function loadDocModules(ctx: Pick<Ctx, 'frameworkRoot'>): Promise<DocModules> {
  const [publicText, frontmatter, fold, yaml, subjects] = await Promise.all([
    loadFrameworkModule<PublicTextModule>(ctx, 'public-text'),
    loadFrameworkModule<FrontmatterModule>(ctx, 'frontmatter'),
    loadFrameworkModule<FoldModule>(ctx, 'fold'),
    loadFrameworkModule<YamlModule>(ctx, 'yaml-lite'),
    loadFrameworkModule<SubjectsModule>(ctx, 'subjects'),
  ]);
  return { publicText, frontmatter, fold, yaml, subjects };
}

export interface CampaignConfig {
  /** False when campaign.yaml is missing or invalid; then nothing is public. */
  ok: boolean;
  data: Record<string, unknown>;
  /** Whether a campaign-relative document may be shown to the players. */
  isPublic(rel: string): boolean;
  /** The folders of the structure list, normalized, with their category type. */
  structure: Array<{ folder: string; type: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readCampaignConfig(ctx: Pick<Ctx, 'campaignRoot'>, mods: DocModules): Promise<CampaignConfig> {
  const closed: CampaignConfig = { ok: false, data: {}, isPublic: () => false, structure: [] };
  let text: string;
  try {
    text = await fs.readFile(path.join(ctx.campaignRoot, 'campaign.yaml'), 'utf8');
  } catch {
    return closed;
  }
  const parsed = mods.yaml.parseYamlLite(text);
  if (parsed.errors.length > 0 || !isRecord(parsed.data)) return closed;
  const data = parsed.data;
  const structure: CampaignConfig['structure'] = [];
  if (Array.isArray(data.structure)) {
    for (const entry of data.structure) {
      if (!isRecord(entry) || typeof entry.folder !== 'string') continue;
      const folder = path.posix.normalize(entry.folder.replace(/\\/g, '/')).replace(/\/+$/, '');
      if (folder === '' || folder === '.') continue;
      structure.push({ folder, type: typeof entry.type === 'string' ? entry.type : '' });
    }
  }
  return {
    ok: true,
    data,
    isPublic: (rel) => mods.publicText.isPublicDocument(rel, data),
    structure,
  };
}

/** The structure folder that contains a document (longest match), or "" when none. */
export function categoryOf(rel: string, structure: CampaignConfig['structure']): string {
  let best = '';
  for (const entry of structure) {
    if (rel.startsWith(`${entry.folder}/`) && entry.folder.length > best.length) best = entry.folder;
  }
  return best;
}

export interface CampaignDocFile {
  rel: string;
  mtimeMs: number;
}

const SKIPPED_NAMES = new Set(['.git', 'node_modules']);
// Generated agent instructions at the campaign root: not campaign documents.
const ROOT_EXCLUDED_NAMES = new Set(['CLAUDE.md', 'AGENTS.md']);

/**
 * Every Markdown file of the campaign, sorted by path. `.campaign/`, `.git` and
 * node_modules are skipped, and so are CLAUDE.md and AGENTS.md at the campaign root
 * (generated agent instructions). Symlinked files count only when their target is
 * inside the campaign, or inside the real folder of an external category (where symlinked
 * folders are followed too, each real folder once). Outside external folders symlinked
 * folders are not followed. Listed paths are the campaign-relative ones, through the links.
 */
export async function listCampaignDocuments(root: string): Promise<CampaignDocFile[]> {
  const realRoot = await fs.realpath(root);
  const externals = await externalFolderRoots(root);
  const inExternal = (rel: string): boolean => externals.some((entry) => isUnderFolder(rel, entry.folder));
  // Real folders already entered through a link: a link back to one of them is not followed again.
  const entered = new Set<string>([realRoot]);
  const out: CampaignDocFile[] = [];

  async function walk(dirAbs: string, relDir: string, atRoot: boolean): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (SKIPPED_NAMES.has(name) || (atRoot && (name === '.campaign' || ROOT_EXCLUDED_NAMES.has(name)))) continue;
      const rel = relDir === '' ? name : `${relDir}/${name}`;
      const abs = path.join(dirAbs, name);
      if (entry.isDirectory()) {
        await walk(abs, rel, false);
        continue;
      }
      if (entry.isSymbolicLink() && inExternal(rel) && (await isDirectory(abs))) {
        if (name === 'img' || name.startsWith('.')) continue;
        try {
          const real = await fs.realpath(abs);
          if (entered.has(real) || containingRoot(realRoot, externals, real, rel) === null) continue;
          entered.add(real);
        } catch {
          continue;
        }
        await walk(abs, rel, false);
        continue;
      }
      if (!(entry.isFile() || entry.isSymbolicLink())) continue;
      if (!name.toLowerCase().endsWith('.md')) continue;
      try {
        const real = await fs.realpath(abs);
        const base = containingRoot(realRoot, externals, real, rel);
        if (base === null) continue;
        if (isForbidden(path.relative(base, real).split(path.sep))) continue;
        const stat = await fs.stat(real);
        if (!stat.isFile()) continue;
        out.push({ rel, mtimeMs: stat.mtimeMs });
      } catch {
        // Broken link or unreadable file: not a document.
      }
    }
  }

  await walk(root, '', true);
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return out;
}

async function isDirectory(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isDirectory();
  } catch {
    return false;
  }
}

function isForbidden(segments: string[]): boolean {
  return segments[0] === '.campaign' || segments.includes('.git');
}

export interface ResolvedFile {
  /** Real absolute path of the file. */
  abs: string;
  /** Requested campaign-relative path, normalized with "/" separators. */
  rel: string;
}

/**
 * Resolves a client-supplied path to a regular file inside the campaign, or inside the real
 * folder of an external category when the path starts with that folder. Returns null
 * for anything absolute, containing "..", inside `.campaign/` or `.git`, missing, not a
 * regular file, or whose real location (after symlinks) is outside those roots.
 */
export async function resolveCampaignFile(root: string, rel: unknown): Promise<ResolvedFile | null> {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) return null;
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null;
  const segments = rel.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.');
  if (segments.length === 0 || segments.includes('..') || isForbidden(segments)) return null;
  try {
    const realRoot = await fs.realpath(root);
    const real = await fs.realpath(path.join(root, ...segments));
    const reqRel = segments.join('/');
    const base = containingRoot(realRoot, await externalFolderRoots(root), real, reqRel);
    if (base === null) return null;
    if (isForbidden(path.relative(base, real).split(path.sep))) return null;
    const stat = await fs.stat(real);
    if (!stat.isFile()) return null;
    return { abs: real, rel: reqRel };
  } catch {
    return null;
  }
}
