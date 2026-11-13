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
import type { MusicEntry } from './search.js';

export type LibraryResult = { ok: true; tracks: MusicTrack[] } | { ok: false; note: string };
export type EntriesResult = { ok: true; entries: MusicEntry[] } | { ok: false; note: string };

interface CacheEntry {
  checkedAt: number;
  stamp: string;
  entries: MusicEntry[];
}

const caches = new Map<string, CacheEntry>();
const CHECK_INTERVAL_MS = 1000;
const PREFERRED = /^(?:preferita|preferred)\s*:/i;
/** The music heading of a sheet (campaign language or English); its lines are not passages. */
const MUSIC_HEADING = /^###\s+(?:musica|music)\s*$/i;
const HEADING = /^#{1,6}\s+(.*)$/;
const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s+/;
const MAX_SENTENCES = 80;
const MAX_PASSAGE_CHARS = 240;
const MIN_SENTENCE_WORDS = 3;

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

/** Plain text of a Markdown line: links and images keep their label, markup and URLs go. */
function plainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_`~]+/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A sentence cut to the passage length at a word boundary; null when too short to be useful. */
function fitSentence(sentence: string): string | null {
  let text = sentence;
  if (text.length > MAX_PASSAGE_CHARS) {
    text = text.slice(0, MAX_PASSAGE_CHARS).replace(/\s+\S*$/, '');
  }
  const words = text.split(' ').filter((word) => /[\p{L}\p{N}]/u.test(word));
  return words.length >= MIN_SENTENCE_WORDS ? text : null;
}

/**
 * The search passages of one sheet, in order: its headings (sheet title included) and its
 * sentences, public and master-only alike, with Markdown cleaned. The music section and the
 * HTML comments (the framework markers and front matter) are left out. Sentences are capped.
 */
export function passagesOf(text: string): string[] {
  const out: string[] = [];
  let sentences = 0;
  let inMusic = false;
  let paragraph: string[] = [];

  const addText = (plain: string): void => {
    for (const piece of plain.split(/(?<=[.!?…])\s+/)) {
      if (sentences >= MAX_SENTENCES) return;
      const fitted = fitSentence(piece.trim());
      if (fitted === null) continue;
      out.push(fitted);
      sentences += 1;
    }
  };
  const flush = (): void => {
    if (paragraph.length === 0) return;
    addText(plainText(paragraph.join(' ')));
    paragraph = [];
  };

  for (const raw of text.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      inMusic = MUSIC_HEADING.test(line);
      const title = plainText(heading[1]);
      if (!inMusic && title !== '' && title.length <= MAX_PASSAGE_CHARS) out.push(title);
      continue;
    }
    if (inMusic) continue;
    if (line === '') {
      flush();
      continue;
    }
    if (LIST_ITEM.test(line) || line.startsWith('>')) flush();
    paragraph.push(line.replace(LIST_ITEM, '').replace(/^>\s?/, ''));
  }
  flush();
  return out;
}

/** The area of a sheet: the name of its parent folder, or '' for a sheet at the top level. */
function areaOf(rel: string): string {
  const dir = path.posix.dirname(rel);
  return dir === '.' ? '' : path.posix.basename(dir);
}

/** The music entries of one document text; links that fail the checks are dropped. */
export function entriesOfText(text: string, rel: string, links: LinksModule): MusicEntry[] {
  const { items } = links.readMusicItems(text);
  if (items.length === 0) return [];
  const docTitle = headingTitle(text) ?? fallbackTitle(rel);
  const area = areaOf(rel);
  const passages = passagesOf(text);
  const out: MusicEntry[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const title = item.title.trim();
    const link = classifyMusicUrl(item.url);
    if (title === '' || link === null) continue;
    const id = trackId(rel, item.url);
    if (seen.has(id)) continue;
    seen.add(id);
    const preferred = PREFERRED.test(item.mood);
    const track: MusicTrack = {
      id,
      title,
      url: item.url,
      mood: item.mood,
      provider: link.provider,
      ...(link.videoId !== undefined ? { videoId: link.videoId } : {}),
      docPath: rel,
      docTitle,
      ...(preferred ? { preferred: true } : {}),
    };
    out.push({ track, area, passages });
  }
  return out;
}

/** The tracks of one document text, without their search context. */
export function tracksOfText(text: string, rel: string, links: LinksModule): MusicTrack[] {
  return entriesOfText(text, rel, links).map((entry) => entry.track);
}

async function scan(root: string, docs: CampaignDocFile[], links: LinksModule): Promise<MusicEntry[]> {
  const out: MusicEntry[] = [];
  for (const doc of docs) {
    let text: string;
    try {
      text = await fs.readFile(path.join(root, doc.rel), 'utf8');
    } catch {
      continue;
    }
    out.push(...entriesOfText(text, doc.rel, links));
  }
  return out;
}

/**
 * The music entries of the campaign (track plus private search context), or a plain note when
 * the framework cannot read them. Never throws; a rescan happens only when a document was
 * added, removed or changed.
 */
export async function loadMusicEntries(ctx: Ctx): Promise<EntriesResult> {
  const loaded = await loadLinksModule(ctx.frameworkRoot);
  if (!loaded.ok) return loaded;
  const root = ctx.campaignRoot;
  const now = Date.now();
  let entry = caches.get(root);
  if (!entry || now - entry.checkedAt >= CHECK_INTERVAL_MS) {
    const docs = await listCampaignDocuments(root);
    const stamp = stampOf(docs);
    if (!entry || entry.stamp !== stamp) {
      entry = { checkedAt: now, stamp, entries: await scan(root, docs, loaded.links) };
      caches.set(root, entry);
    } else {
      entry.checkedAt = now;
    }
  }
  return { ok: true, entries: entry.entries };
}

/**
 * The tracks of the campaign, or a plain note when the framework cannot read them. Same cache
 * as loadMusicEntries; used where only the public track list is needed.
 */
export async function loadMusicLibrary(ctx: Ctx): Promise<LibraryResult> {
  const loaded = await loadMusicEntries(ctx);
  if (!loaded.ok) return loaded;
  return { ok: true, tracks: loaded.entries.map((entry) => entry.track) };
}
