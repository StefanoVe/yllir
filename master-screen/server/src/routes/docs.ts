// GET /api/docs, GET /api/docs/read, GET /api/file, GET /api/search, GET and POST
// /api/checks. Owner: docs engineer.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import type { ChecksResponse, DocResponse, DocSummary, DocsResponse, SearchResponse } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import { runEngine } from '../engine.js';
import { wrap } from '../http.js';
import { CHECK_FAILED_MESSAGE, getChecks, runChecks } from '../docs/checks.js';
import { getSearchIndex, searchIndex } from '../docs/index-cache.js';
import {
  categoryOf,
  listCampaignDocuments,
  loadDocModules,
  readCampaignConfig,
  resolveCampaignFile,
  type CampaignConfig,
  type DocModules,
} from '../docs/scan.js';
import {
  headingTitle,
  linkTargets,
  partsForView,
  renderParts,
  type Part,
  type View,
} from '../docs/markdown.js';

const NOT_FOUND = 'There is no such document.';
const FILE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function viewOf(value: unknown): View {
  return value === 'public' ? 'public' : 'master';
}

function fileTitle(rel: string): string {
  return path.posix.basename(rel, path.posix.extname(rel));
}

function titleOf(parts: Part[], rel: string): string {
  for (const part of parts) {
    const title = headingTitle(part.source);
    if (title !== null) return title;
  }
  return fileTitle(rel);
}

interface Backlink {
  path: string;
  title: string;
}

/** Documents that link to rel: relations of the framework when the document is a subject, else a scan of links. */
async function backlinksOf(
  ctx: Ctx,
  mods: DocModules,
  config: CampaignConfig,
  rel: string,
  view: View,
): Promise<Backlink[]> {
  const related = await relatedBacklinks(ctx, mods, config, rel, view);
  if (related !== null) return related;
  return scanBacklinks(ctx, mods, config, rel, view);
}

async function relatedBacklinks(
  ctx: Ctx,
  mods: DocModules,
  config: CampaignConfig,
  rel: string,
  view: View,
): Promise<Backlink[] | null> {
  let subjects: ReturnType<DocModules['subjects']['buildSubjectIndex']>['subjects'];
  try {
    subjects = mods.subjects.buildSubjectIndex(ctx.campaignRoot).subjects;
  } catch {
    return null;
  }
  const self = subjects.find((subject) => subject.sheet === rel);
  if (!self) return null;
  const res = await runEngine<{ results?: unknown }>(ctx, ['query', 'related', self.id]);
  if (res.code !== 0 || !res.json || !Array.isArray(res.json.results)) return null;
  const bySheet = new Map(subjects.map((subject) => [subject.id, subject]));
  const out = new Map<string, Backlink>();
  for (const item of res.json.results) {
    if (typeof item !== 'object' || item === null) continue;
    const other = (item as { other?: { id?: unknown; title?: unknown } }).other;
    if (typeof other?.id !== 'string') continue;
    const subject = bySheet.get(other.id);
    if (!subject || subject.sheet === rel) continue;
    if (view === 'public' && !config.isPublic(subject.sheet)) continue;
    const title = typeof other.title === 'string' && other.title !== '' ? other.title : fileTitle(subject.sheet);
    out.set(subject.sheet, { path: subject.sheet, title });
  }
  return [...out.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function scanBacklinks(
  ctx: Ctx,
  mods: DocModules,
  config: CampaignConfig,
  rel: string,
  view: View,
): Promise<Backlink[]> {
  const out: Backlink[] = [];
  for (const doc of await listCampaignDocuments(ctx.campaignRoot)) {
    if (doc.rel === rel) continue;
    const masterOnly = !config.isPublic(doc.rel);
    if (view === 'public' && masterOnly) continue;
    let text: string;
    try {
      text = await fsp.readFile(path.join(ctx.campaignRoot, doc.rel), 'utf8');
    } catch {
      continue;
    }
    const body = mods.frontmatter.parseFrontmatter(text).body;
    const parts = partsForView(body, masterOnly, view, mods.publicText.MASTER_MARKER);
    if (!parts.some((part) => linkTargets(part.source, doc.rel).has(rel))) continue;
    out.push({ path: doc.rel, title: titleOf(parts, doc.rel) });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function registerDocsRoutes(app: Router, ctx: Ctx): void {
  app.get(
    '/docs',
    wrap(async (_req, res) => {
      const mods = await loadDocModules(ctx);
      const config = await readCampaignConfig(ctx, mods);
      const docs: DocSummary[] = [];
      for (const doc of await listCampaignDocuments(ctx.campaignRoot)) {
        let text: string;
        try {
          text = await fsp.readFile(path.join(ctx.campaignRoot, doc.rel), 'utf8');
        } catch {
          continue;
        }
        const body = mods.frontmatter.parseFrontmatter(text).body;
        const masterOnly = !config.isPublic(doc.rel);
        const parts = partsForView(body, masterOnly, 'master', mods.publicText.MASTER_MARKER);
        docs.push({
          path: doc.rel,
          title: titleOf(parts, doc.rel),
          category: categoryOf(doc.rel, config.structure),
          masterOnly,
          hasMasterBlock: text.includes(mods.publicText.MASTER_MARKER),
        });
      }
      const body: DocsResponse = { docs };
      res.json(body);
    }),
  );

  app.get(
    '/docs/read',
    wrap(async (req, res) => {
      const resolved = await resolveCampaignFile(ctx.campaignRoot, queryString(req.query.path));
      if (!resolved || !resolved.rel.toLowerCase().endsWith('.md')) {
        res.status(404).json({ error: NOT_FOUND });
        return;
      }
      const view = viewOf(req.query.view);
      const mods = await loadDocModules(ctx);
      const config = await readCampaignConfig(ctx, mods);
      const text = await fsp.readFile(resolved.abs, 'utf8');
      const masterOnly = !config.isPublic(resolved.rel);
      const body = mods.frontmatter.parseFrontmatter(text).body;
      const parts = partsForView(body, masterOnly, view, mods.publicText.MASTER_MARKER);
      const rendered = renderParts(parts, {
        docRel: resolved.rel,
        canLink: (target) => view === 'master' || config.isPublic(target),
      });
      const backlinks = view === 'public' && masterOnly ? [] : await backlinksOf(ctx, mods, config, resolved.rel, view);
      const response: DocResponse = {
        path: resolved.rel,
        title: rendered.title ?? fileTitle(resolved.rel),
        masterOnly,
        headings: rendered.headings,
        blocks: rendered.blocks,
        backlinks,
      };
      res.json(response);
    }),
  );

  app.get('/file', (req, res) => {
    void serveFile(ctx, req, res).catch(() => {
      if (!res.headersSent) res.status(404).json({ error: 'There is no such file.' });
      else res.destroy();
    });
  });

  app.get(
    '/search',
    wrap(async (req, res) => {
      const query = queryString(req.query.q) ?? '';
      const view = viewOf(req.query.view);
      const mods = await loadDocModules(ctx);
      const index = await getSearchIndex(ctx, view, mods);
      const body: SearchResponse = {
        query,
        hits: searchIndex(index, query, mods.fold).map((hit) => ({
          path: hit.path,
          title: hit.title,
          snippet: hit.snippet,
          masterOnly: hit.masterOnly,
        })),
      };
      res.json(body);
    }),
  );

  app.get(
    '/checks',
    wrap(async (_req, res) => {
      try {
        const result: ChecksResponse = await getChecks(ctx);
        res.json(result);
      } catch (err) {
        ctx.log(`checks failed: ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ error: CHECK_FAILED_MESSAGE });
      }
    }),
  );

  app.post(
    '/checks/run',
    wrap(async (_req, res) => {
      try {
        res.json(await runChecks(ctx));
      } catch (err) {
        ctx.log(`checks failed: ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ error: CHECK_FAILED_MESSAGE });
      }
    }),
  );
}

async function serveFile(ctx: Ctx, req: Request, res: Response): Promise<void> {
  const resolved = await resolveCampaignFile(ctx.campaignRoot, queryString(req.query.path));
  const ext = resolved ? path.posix.extname(resolved.rel).toLowerCase() : '';
  const type = FILE_TYPES[ext];
  if (!resolved || type === undefined) {
    res.status(404).json({ error: 'There is no such file.' });
    return;
  }
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Security-Policy', 'sandbox');
  if (ext === '.svg') res.setHeader('Content-Disposition', 'attachment');
  const stream = fs.createReadStream(resolved.abs);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ error: 'There is no such file.' });
    else res.destroy();
  });
  stream.pipe(res);
}

