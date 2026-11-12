// The music library: every campaign Markdown document is scanned for the music items of its
// master-only block (through the framework parser), and the result is kept in memory. The
// cache is checked against the document list and modification times, at most once per
// second per campaign, like the docs search index. Owner: music engineer.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MusicTrack } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import { headingTitle } from '../docs/markdown.js';
import { listCampaignDocuments, type CampaignDocFile } from '../docs/scan.js';
import { loadLinksModule, type LinksModule } from './framework.js';
import { classifyMusicUrl, trackId } from './provider.js';

export type LibraryResult = { ok: true; tracks: MusicTrack[] } | { ok: false; note: string };

interface CacheEntry {
  checkedAt: number;
  stamp: string;
  tracks: MusicTrack[];
}

const caches = new Map<string, CacheEntry>();
const CHECK_INTERVAL_MS = 1000;
const PREFERRED = /^(?:preferita|preferred)\s*:/i;

/** Drops the cached library of one campaign, or of every campaign when none is given. */
export function invalidateMusicLibrary(campaignRoot?: string): void {
  if (campaignRoot === undefined) caches.clear();
  else caches.delete(campaignRoot);
}

function stampOf(docs: CampaignDocFile[]): string {
  return docs.map((doc) => `${doc.rel}@${doc.mtimeMs}`).join('\n');
}

function fallbackTitle(rel: string): string {
  return path.posix.basename(rel, path.posix.extname(rel));
}

/** The tracks of one document text; links that fail the checks are dropped. */
export function tracksOfText(text: string, rel: string, links: LinksModule): MusicTrack[] {
  const { items } = links.readMusicItems(text);
  if (items.length === 0) return [];
  const docTitle = headingTitle(text) ?? fallbackTitle(rel);
  const out: MusicTrack[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const title = item.title.trim();
    const link = classifyMusicUrl(item.url);
    if (title === '' || link === null) continue;
    const id = trackId(rel, item.url);
    if (seen.has(id)) continue;
    seen.add(id);
    const preferred = PREFERRED.test(item.mood);
    out.push({
      id,
      title,
      url: item.url,
      mood: item.mood,
      provider: link.provider,
      ...(link.videoId !== undefined ? { videoId: link.videoId } : {}),
      docPath: rel,
      docTitle,
      ...(preferred ? { preferred: true } : {}),
    });
  }
  return out;
}

async function scan(root: string, docs: CampaignDocFile[], links: LinksModule): Promise<MusicTrack[]> {
  const out: MusicTrack[] = [];
  for (const doc of docs) {
    let text: string;
    try {
      text = await fs.readFile(path.join(root, doc.rel), 'utf8');
    } catch {
      continue;
    }
    out.push(...tracksOfText(text, doc.rel, links));
  }
  return out;
}

/**
 * The tracks of the campaign, or a plain note when the framework cannot read them. Never
 * throws; a rescan happens only when a document was added, removed or changed.
 */
export async function loadMusicLibrary(ctx: Ctx): Promise<LibraryResult> {
  const loaded = await loadLinksModule(ctx.frameworkRoot);
  if (!loaded.ok) return loaded;
  const root = ctx.campaignRoot;
  const now = Date.now();
  let entry = caches.get(root);
  if (!entry || now - entry.checkedAt >= CHECK_INTERVAL_MS) {
    const docs = await listCampaignDocuments(root);
    const stamp = stampOf(docs);
    if (!entry || entry.stamp !== stamp) {
      entry = { checkedAt: now, stamp, tracks: await scan(root, docs, loaded.links) };
      caches.set(root, entry);
    } else {
      entry.checkedAt = now;
    }
  }
  return { ok: true, tracks: entry.tracks };
}
