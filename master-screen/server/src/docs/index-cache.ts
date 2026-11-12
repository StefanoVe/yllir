// In-memory search index of the campaign documents, one per view. Rebuilt when the
// set of Markdown files or their modification times change; the check runs at most
// once per second per campaign. invalidateDocsIndex() forces a rebuild. Owner: docs engineer.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from '../context.js';
import {
  listCampaignDocuments,
  readCampaignConfig,
  type CampaignConfig,
  type CampaignDocFile,
  type DocModules,
} from './scan.js';
import { headingTitle, partsForView, plainTextOf, type Part, type View } from './markdown.js';

export interface SearchDoc {
  path: string;
  title: string;
  masterOnly: boolean;
  /** Plain text of the indexed parts of the document (original case and accents). */
  text: string;
  /** Folded text of `text`, and the map from folded positions to positions in `text`. */
  folded: string;
  map: number[];
  /** Folded word list of the body and of the title. */
  words: Array<{ word: string; pos: number }>;
  titleWords: string[];
}

export interface SearchIndex {
  view: View;
  docs: SearchDoc[];
}

interface CacheEntry {
  checkedAt: number;
  stamp: string;
  docs: CampaignDocFile[];
  config: CampaignConfig;
  indexes: Map<View, Promise<SearchIndex>>;
}

const caches = new Map<string, CacheEntry>();
const CHECK_INTERVAL_MS = 1000;
const WORD = /[\p{L}\p{N}]+/gu;

/** Drops the cached index of one campaign, or of every campaign when none is given. */
export function invalidateDocsIndex(campaignRoot?: string): void {
  if (campaignRoot === undefined) caches.clear();
  else caches.delete(campaignRoot);
}

function stampOf(docs: CampaignDocFile[]): string {
  return docs.map((doc) => `${doc.rel}@${doc.mtimeMs}`).join('\n');
}

function fileTitle(rel: string): string {
  return path.posix.basename(rel, path.posix.extname(rel));
}

function wordsOf(folded: string): Array<{ word: string; pos: number }> {
  const out: Array<{ word: string; pos: number }> = [];
  for (const match of folded.matchAll(WORD)) out.push({ word: match[0], pos: match.index ?? 0 });
  return out;
}

async function buildIndex(
  ctx: Ctx,
  view: View,
  mods: DocModules,
  docs: CampaignDocFile[],
  config: CampaignConfig,
): Promise<SearchIndex> {
  const out: SearchDoc[] = [];
  for (const doc of docs) {
    const masterOnly = !config.isPublic(doc.rel);
    if (view === 'public' && masterOnly) continue;
    let text: string;
    try {
      text = await fs.readFile(path.join(ctx.campaignRoot, doc.rel), 'utf8');
    } catch {
      continue;
    }
    const body = mods.frontmatter.parseFrontmatter(text).body;
    const marker = mods.publicText.MASTER_MARKER;
    const parts: Part[] = partsForView(body, masterOnly, view, marker);
    const plain = parts.map((part) => plainTextOf(part.source)).join('\n');
    const title = parts.map((part) => headingTitle(part.source)).find((t) => t !== null) ?? fileTitle(doc.rel);
    const { folded, map } = mods.fold.foldText(plain);
    const titleFolded = mods.fold.foldText(title).folded;
    out.push({
      path: doc.rel,
      title,
      masterOnly,
      text: plain,
      folded,
      map,
      words: wordsOf(folded),
      titleWords: titleFolded.match(WORD) ?? [],
    });
  }
  return { view, docs: out };
}

/** The search index of a view, rebuilt when the campaign documents changed. */
export async function getSearchIndex(ctx: Ctx, view: View, mods: DocModules): Promise<SearchIndex> {
  const key = ctx.campaignRoot;
  const now = Date.now();
  let entry = caches.get(key);
  if (!entry || now - entry.checkedAt >= CHECK_INTERVAL_MS) {
    const docs = await listCampaignDocuments(ctx.campaignRoot);
    const stamp = stampOf(docs);
    if (!entry || entry.stamp !== stamp) {
      entry = {
        checkedAt: now,
        stamp,
        docs,
        config: await readCampaignConfig(ctx, mods),
        indexes: new Map(),
      };
      caches.set(key, entry);
    } else {
      entry.checkedAt = now;
    }
  }
  let index = entry.indexes.get(view);
  if (!index) {
    index = buildIndex(ctx, view, mods, entry.docs, entry.config);
    entry.indexes.set(view, index);
  }
  return index;
}

/** Text of a snippet of about 140 characters around the position `at` of `text`. */
function snippetAt(text: string, at: number): string {
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + 80);
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  masterOnly: boolean;
}

/**
 * Searches an index. Every term of the query must match a word (whole word or prefix),
 * case and accent insensitive. Title matches weigh more than body matches.
 */
export function searchIndex(index: SearchIndex, query: string, fold: DocModules['fold'], limit = 30): SearchResult[] {
  const terms = fold
    .foldForm(query.slice(0, 200))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term !== '');
  if (terms.length === 0) return [];

  const scored: Array<{ result: SearchResult; score: number }> = [];
  for (const doc of index.docs) {
    let score = 0;
    let firstBodyPos = -1;
    let matchesAll = true;
    for (const term of terms) {
      const titleHit = doc.titleWords.some((word) => word.startsWith(term));
      let bodyCount = 0;
      for (const { word, pos } of doc.words) {
        if (!word.startsWith(term)) continue;
        bodyCount++;
        if (firstBodyPos < 0 || pos < firstBodyPos) firstBodyPos = pos;
      }
      if (!titleHit && bodyCount === 0) {
        matchesAll = false;
        break;
      }
      if (titleHit) score += 5;
      score += Math.min(bodyCount, 20);
    }
    if (!matchesAll) continue;
    // firstBodyPos is a folded position of the first body match of any term.
    const snippet =
      firstBodyPos >= 0
        ? snippetAt(doc.text, doc.map[firstBodyPos] ?? 0)
        : snippetAt(doc.text, 0);
    scored.push({
      score,
      result: { path: doc.path, title: doc.title, snippet, masterOnly: doc.masterOnly },
    });
  }
  scored.sort((a, b) => b.score - a.score || a.result.title.localeCompare(b.result.title) || (a.result.path < b.result.path ? -1 : 1));
  return scored.slice(0, limit).map((entry) => entry.result);
}

