// The cockpit's archive over the master screen's own documents index. Documents are read
// with the docs module (master view, so the master block is kept), search goes through the
// docs search index, and a watcher on the campaign folder rebuilds the snapshot after a
// change: readers never scan on their own. Owner: cockpit host.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import MarkdownIt from 'markdown-it';
import type { CockpitArchive, Detail, Heading, Hit } from '../cockpit/ports.js';
import type { Ctx } from '../context.js';
import { getSearchIndex, invalidateDocsIndex, searchIndex, type SearchIndex } from '../docs/index-cache.js';
import { partsForView, renderParts } from '../docs/markdown.js';
import {
  listCampaignDocuments,
  loadDocModules,
  readCampaignConfig,
  type CampaignConfig,
  type DocModules,
} from '../docs/scan.js';
import type { CampaignCategories } from './categories.js';
import { loadCategoryEntries } from './categories.js';
import { areaOf, listRasterImages } from './files.js';
import { imageRefsOf } from './refs.js';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
const PRINTED = /<!--\s*enciclopedia:\s*(.*?)\s*-->/;
const TRACKED_EXTENSIONS = new Set(['.md', '.png', '.jpg', '.jpeg', '.webp']);
/** Chronicle and notes pages are working material, not the campaign's own text. */
const OPERATIVE_TYPES = new Set(['chronicle', 'notes']);
const DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 1000;
const HIT_PAGE = 60;

export interface HostArchive extends CockpitArchive {
  /** Counts the rebuilds that changed the documents. */
  generation(): number;
  /** Calls the listener after every change of the documents. Returns the unsubscribe function. */
  onChange(listener: () => void): () => void;
  /** Resolves when the queued rebuilds are done. */
  idle(): Promise<void>;
  close(): Promise<void>;
}

interface Snapshot {
  docs: Map<string, Detail>;
  version: string;
  search?: SearchIndex;
  mods?: DocModules;
}

/** Line of each heading in the body: markdown-it's own heading tokens, in order. */
function headingLines(body: string, headings: Array<{ text: string }>): number[] {
  const lines = md
    .parse(body, {})
    .filter((token) => token.type === 'heading_open' && token.map !== null)
    .map((token) => token.map![0] + 1);
  if (lines.length === headings.length) return lines;
  // Counts differ only in odd sources: find each heading by its text, in order.
  const source = body.split('\n');
  let from = 0;
  return headings.map((heading) => {
    const index = source.findIndex(
      (line, i) => i >= from && /^#{1,6}\s/.test(line) && line.replace(/^#{1,6}\s+/, '').trim() === heading.text,
    );
    if (index < 0) return 1;
    from = index + 1;
    return index + 1;
  });
}

function buildDetail(
  rel: string,
  text: string,
  mods: DocModules,
  config: CampaignConfig,
  categories: CampaignCategories,
): Detail {
  const body = mods.frontmatter.parseFrontmatter(text).body;
  const marker = mods.publicText.MASTER_MARKER;
  const master = !config.isPublic(rel);
  const rendered = renderParts(partsForView(body, master, 'master', marker), { docRel: rel, canLink: () => true });
  const lines = headingLines(body, rendered.headings);
  const headings: Heading[] = rendered.headings.map((heading, index) => ({
    id: heading.id,
    title: heading.text,
    line: lines[index] ?? 1,
  }));
  const entry = categories.entryFor(rel);
  const card = imageRefsOf(rel, body).find((ref) => /-thumbnail\.png$/i.test(ref.path))?.path;
  const printed = PRINTED.exec(body)?.[1];
  return {
    path: rel,
    title: rendered.title ?? path.posix.basename(rel, path.posix.extname(rel)),
    category: entry?.id ?? '',
    area: areaOf(rel, entry?.folder),
    scope: entry !== undefined && !OPERATIVE_TYPES.has(entry.type) ? 'Campagna' : 'Operativo',
    master,
    raw: body,
    html: rendered.blocks.map((block) => block.html).join('\n'),
    headings,
    hasMaster: text.includes(marker),
    ...(card !== undefined ? { card } : {}),
    ...(printed !== undefined ? { printed } : {}),
  };
}

/** Dot folders (.campaign, .git) and node_modules are never watched. */
function isIgnored(root: string, abs: string): boolean {
  const rel = path.relative(root, abs);
  if (rel === '') return false;
  return rel.split(path.sep).some((part) => part.startsWith('.') || part === 'node_modules');
}

export function createArchive(ctx: Ctx, categories: CampaignCategories, prepare: () => Promise<void>): HostArchive {
  const root = ctx.campaignRoot;
  let snapshot: Snapshot = { docs: new Map(), version: '' };
  let stamp = '';
  let generation = 0;
  let mods: DocModules | undefined;
  let closed = false;
  let timer: NodeJS.Timeout | undefined;
  let chain: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const details = new Map<string, { mtimeMs: number; detail: Detail }>();

  async function rebuild(force: boolean): Promise<void> {
    if (closed) return;
    await prepare();
    const loaded = (mods ??= await loadDocModules(ctx));
    const config = await readCampaignConfig(ctx, loaded);
    categories.load(await loadCategoryEntries(ctx));
    const files = await listCampaignDocuments(root);
    const images = await listRasterImages(root);
    const yamlMtime = await fs.stat(path.join(root, 'campaign.yaml')).then(
      (stat) => String(stat.mtimeMs),
      () => '',
    );
    const nextStamp = [
      `yaml@${yamlMtime}`,
      ...files.map((file) => `${file.rel}@${file.mtimeMs}`),
      ...images.map((image) => `${image.rel}@${image.mtimeMs}`),
    ].join('\n');
    if (!force && nextStamp === stamp) return;
    if (force) details.clear();

    const docs = new Map<string, Detail>();
    for (const file of files) {
      const cached = details.get(file.rel);
      if (cached && cached.mtimeMs === file.mtimeMs) {
        docs.set(file.rel, cached.detail);
        continue;
      }
      const text = await fs.readFile(path.join(root, file.rel), 'utf8').catch(() => null);
      if (text === null) continue;
      const detail = buildDetail(file.rel, text, loaded, config, categories);
      details.set(file.rel, { mtimeMs: file.mtimeMs, detail });
      docs.set(file.rel, detail);
    }
    for (const key of [...details.keys()]) if (!docs.has(key)) details.delete(key);

    invalidateDocsIndex(root);
    const search = await getSearchIndex(ctx, 'master', loaded);
    if (closed) return;
    const changed = nextStamp !== stamp;
    stamp = nextStamp;
    snapshot = {
      docs,
      version: createHash('sha1').update(nextStamp).digest('hex'),
      search,
      mods: loaded,
    };
    if (changed) {
      generation += 1;
      for (const listener of [...listeners]) listener();
    }
  }

  function enqueue(force: boolean): Promise<void> {
    chain = chain
      .then(() => rebuild(force))
      .catch((error) => ctx.log(`cockpit archive: ${error instanceof Error ? error.message : String(error)}`));
    return chain;
  }

  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void enqueue(false);
    }, DEBOUNCE_MS);
  };

  const watcher: FSWatcher = watch(root, {
    ignored: (abs: string) => isIgnored(root, abs),
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
  });
  const onPath = (abs: string) => {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (rel !== 'campaign.yaml' && !TRACKED_EXTENSIONS.has(path.posix.extname(rel).toLowerCase())) return;
    schedule();
  };
  watcher.on('add', onPath).on('change', onPath).on('unlink', onPath);
  watcher.on('error', (error: unknown) => ctx.log(`archive watcher error: ${String(error)}`));

  void enqueue(true);

  return {
    get docs() {
      return snapshot.docs;
    },
    search(query, category = '', scope = '', offset = 0): { hits: Hit[]; total: number } {
      const { search, mods: loaded } = snapshot;
      if (!search || !loaded) return { hits: [], total: 0 };
      const hits: Hit[] = [];
      for (const result of searchIndex(search, query, loaded.fold, SEARCH_LIMIT)) {
        const doc = snapshot.docs.get(result.path);
        if (!doc) continue;
        if ((category && doc.category !== category) || (scope && doc.scope !== scope)) continue;
        hits.push({
          path: doc.path,
          title: doc.title,
          category: doc.category,
          area: doc.area,
          scope: doc.scope,
          master: doc.master,
          ...(doc.card !== undefined ? { card: doc.card } : {}),
          ...(doc.printed !== undefined ? { printed: doc.printed } : {}),
          excerpt: result.snippet,
          anchor: '',
        });
      }
      return { hits: hits.slice(offset, offset + HIT_PAGE), total: hits.length };
    },
    version: () => snapshot.version,
    refresh: () => enqueue(true),
    generation: () => generation,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    idle: () => chain,
    async close() {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      await watcher.close();
      await chain;
    },
  };
}
