import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import type { ChecksResponse, DocResponse, DocsResponse, SearchResponse } from '../../../shared/src/types.js';
import { createCtx, type Ctx } from '../context.js';
import { CHECK_FAILED_MESSAGE } from '../docs/checks.js';
import { invalidateDocsIndex } from '../docs/index-cache.js';
import { sanitizeFragment, renderParts } from '../docs/markdown.js';
import { request, startServer, type RunningServer } from '../testing.js';
import { registerDocsRoutes } from './docs.js';

// The real framework in this repository (four levels up from src/routes/).
const REAL_FRAMEWORK = fileURLToPath(new URL('../../../../yllir', import.meta.url));

const CAMPAIGN_YAML = `schema: 1
campaign:
  name: Docs Fixture
  slug: docs-fixture
  seed: seed.md
language:
  main: en
structure:
  - folder: places
    type: places
  - folder: secrets
    type: master-only
audit:
  exclusions:
    - subject: harbor
      attribute: population
      values: [40]
      reason: rounded in the text
      date: 2026-01-01
`;

const HARBOR = `<!-- yllir
id: harbor
kind: place
provenance: master
-->
# Harbor

The harbor of Oakvale is busy. See [the keep](../keep.md) and ![map](../img/map.png).
Visit [the vault](../secrets/npc.md) only with care.

<!-- master -->
Hidden truth: the harbor master is a smuggler named Quillon.
[ledger](../secrets/npc.md) hides the zephyrite route.
`;

const RUINS = `<!-- yllir
id: ruins
kind: place
provenance: master
sketch: true
-->
# Ruins
`;

const pathTraversalTarget = (base: string) => `../${base}/x.md`;

function apiFor(ctx: Ctx): express.Express {
  const app = express();
  const api = express.Router();
  registerDocsRoutes(api, ctx);
  app.use('/api', api);
  return app;
}

describe('docs routes', () => {
  let tmp: string;
  let outside: string;
  let server: RunningServer;
  let ctx: Ctx;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-docs-'));
    outside = `${tmp}-outside`;
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'x.md'), '# Outside\n\nOutside text zephyrite.\n');
    await fs.writeFile(path.join(outside, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const write = async (rel: string, content: string | Buffer) => {
      await fs.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true });
      await fs.writeFile(path.join(tmp, rel), content);
    };
    await write('campaign.yaml', CAMPAIGN_YAML);
    await write('seed.md', '# World Seed\n\nThe zephyrite vein runs under everything.\n');
    await write('places/harbor.md', HARBOR);
    await write('places/ruins.md', RUINS);
    await write('keep.md', '# The Keep\n\nThe keep stands above the Oakvale, facing the Océan.\n');
    await write('raw.md', '# Raw\n\n<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n');
    await write('secrets/npc.md', '# Quillon\n\nThe smuggler Quillon keeps a ledger of zephyrite.\n');
    await write('img/map.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
    await write('img/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await write('.campaign/x.md', '# Internal\n\nInternal state.\n');
    await fs.symlink(path.join(outside, 'x.md'), path.join(tmp, 'escape.md'));
    await fs.symlink(path.join(outside, 'pic.png'), path.join(tmp, 'escape.png'));

    server = await startServer((port) => {
      ctx = createCtx({ campaignRoot: tmp, frameworkRoot: REAL_FRAMEWORK, port, log: () => {} });
      return apiFor(ctx);
    });
  });

  after(async () => {
    await server.close();
    invalidateDocsIndex(tmp);
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  const get = (p: string) => request(server.port, { path: p });
  const readDoc = async (rel: string, view?: string): Promise<DocResponse> => {
    const query = view === undefined ? '' : `&view=${view}`;
    const res = await get(`/api/docs/read?path=${encodeURIComponent(rel)}${query}`);
    assert.equal(res.status, 200, res.text);
    return res.json as DocResponse;
  };
  const search = async (q: string, view?: string): Promise<SearchResponse> => {
    const res = await get(`/api/search?q=${encodeURIComponent(q)}${view ? `&view=${view}` : ''}`);
    assert.equal(res.status, 200, res.text);
    return res.json as SearchResponse;
  };

  it('lists documents with category, master-only and master block flags', async () => {
    const res = await get('/api/docs');
    assert.equal(res.status, 200);
    const docs = (res.json as DocsResponse).docs;
    const byPath = new Map(docs.map((doc) => [doc.path, doc]));
    const harbor = byPath.get('places/harbor.md');
    assert.ok(harbor);
    assert.equal(harbor.title, 'Harbor');
    assert.equal(harbor.category, 'places');
    assert.equal(harbor.masterOnly, false);
    assert.equal(harbor.hasMasterBlock, true);
    assert.equal(byPath.get('seed.md')?.masterOnly, true);
    assert.equal(byPath.get('secrets/npc.md')?.masterOnly, true);
    assert.equal(byPath.get('secrets/npc.md')?.category, 'secrets');
    assert.equal(byPath.get('keep.md')?.category, '');
    for (const doc of docs) {
      assert.ok(!doc.path.startsWith('.campaign/'), doc.path);
      assert.notEqual(doc.path, 'escape.md');
    }
  });

  it('public view shows only the public block of a document', async () => {
    const doc = await readDoc('places/harbor.md', 'public');
    assert.equal(doc.masterOnly, false);
    assert.equal(doc.blocks.length, 1);
    assert.equal(doc.blocks[0].kind, 'public');
    const everything = JSON.stringify(doc);
    for (const secret of ['Quillon', 'smuggler', 'zephyrite', 'Hidden truth', 'secrets/npc.md']) {
      assert.ok(!everything.includes(secret), `public read leaked ${secret}`);
    }
    assert.match(doc.blocks[0].html, /href="\/doc\/keep\.md"/);
    assert.match(doc.blocks[0].html, /src="\/api\/file\?path=img%2Fmap\.png"/);
    assert.deepEqual(doc.headings, [{ level: 1, text: 'Harbor', id: 'harbor' }]);
  });

  it('master view shows both blocks and the master block is separate', async () => {
    const doc = await readDoc('places/harbor.md');
    assert.deepEqual(doc.blocks.map((block) => block.kind), ['public', 'master']);
    assert.match(doc.blocks[1].html, /Quillon/);
    assert.match(doc.blocks[1].html, /href="\/doc\/secrets\/npc\.md"/);
    assert.ok(!doc.blocks.some((block) => block.html.includes('<!-- master -->')));
  });

  it('a master-only document has no blocks in the public view', async () => {
    const seed = await readDoc('seed.md', 'public');
    assert.equal(seed.masterOnly, true);
    assert.deepEqual(seed.blocks, []);
    const npc = await readDoc('secrets/npc.md', 'public');
    assert.deepEqual(npc.blocks, []);
    assert.ok(!JSON.stringify(npc).includes('Quillon'));
    const master = await readDoc('secrets/npc.md');
    assert.match(master.blocks[0].html, /zephyrite/);
  });

  it('rejects traversal, the internal folder, symlinks escaping the campaign and non-Markdown', async () => {
    const base = path.basename(outside);
    const rejected = [
      pathTraversalTarget(base),
      '.campaign/x.md',
      'escape.md',
      'img/map.png',
      'nope.md',
      '/etc/hosts',
      `..%2F${base}%2Fx.md`,
    ];
    for (const rel of rejected) {
      const res = await get(`/api/docs/read?path=${rel}`);
      assert.equal(res.status, 404, `${rel} should be rejected`);
      assert.equal(typeof (res.json as { error?: unknown }).error, 'string');
    }
  });

  it('a link to a document outside the public view is not followed', async () => {
    const doc = await readDoc('places/harbor.md', 'public');
    assert.ok(!doc.blocks[0].html.includes('secrets/npc'));
    assert.match(doc.blocks[0].html, /vault/);
  });

  it('raw HTML in a document is never rendered as tags', async () => {
    const doc = await readDoc('raw.md');
    const html = doc.blocks.map((block) => block.html).join('');
    assert.ok(!/<script/i.test(html));
    assert.ok(!/<img/i.test(html));
    assert.ok(!/<[^>]*onerror/i.test(html));
  });

  it('sanitization strips script, event handlers and javascript links', () => {
    const html = sanitizeFragment(
      '<p>ok</p><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)" onclick="x()">link</a>',
      { docRel: 'a.md', canLink: () => true },
    );
    assert.match(html, /ok/);
    assert.ok(!html.includes('<script'));
    assert.ok(!html.includes('onerror'));
    assert.ok(!html.includes('onclick'));
    assert.ok(!html.includes('javascript:'));
  });

  it('headings get stable ids, unique across blocks', () => {
    const parts = [
      { kind: 'public' as const, source: '# Same\n\n## Same\n' },
      { kind: 'master' as const, source: '## Same\n' },
    ];
    const rendered = renderParts(parts, { docRel: 'a.md', canLink: () => true });
    assert.deepEqual(rendered.headings.map((h) => h.id), ['same', 'same-2', 'same-3']);
  });

  it('serves images only from inside the campaign, SVG as a sandboxed attachment', async () => {
    const png = await get('/api/file?path=img/map.png');
    assert.equal(png.status, 200);
    assert.equal(png.headers['content-type'], 'image/png');

    const svg = await get('/api/file?path=img/icon.svg');
    assert.equal(svg.status, 200);
    assert.equal(svg.headers['content-security-policy'], 'sandbox');
    assert.match(String(svg.headers['content-disposition']), /^attachment/);

    const base = path.basename(outside);
    for (const rel of [`../${base}/pic.png`, '.campaign/x.md', 'escape.png', 'harbor.md', 'places/harbor.md']) {
      const res = await get(`/api/file?path=${encodeURIComponent(rel)}`);
      assert.equal(res.status, 404, `${rel} should not be served`);
    }
  });

  it('search is case and accent insensitive, prefix based, not substring based', async () => {
    const ocean = await search('OCEAN');
    assert.ok(ocean.hits.some((hit) => hit.path === 'keep.md'));
    assert.ok((await search('océ')).hits.some((hit) => hit.path === 'keep.md'));
    assert.ok((await search('oak')).hits.some((hit) => hit.path === 'places/harbor.md'));
    assert.deepEqual((await search('akval')).hits, []);
  });

  it('search ranks title matches first and keeps the match in a short snippet', async () => {
    const res = await search('keep', 'public');
    assert.equal(res.hits[0].path, 'keep.md');
    const harbor = res.hits.find((hit) => hit.path === 'places/harbor.md');
    assert.ok(harbor);
    assert.ok(harbor.snippet.toLowerCase().includes('keep'));
    assert.ok(harbor.snippet.length <= 150);
  });

  it('public search never matches master-only text', async () => {
    for (const q of ['zephyrite', 'quillon', 'smuggler', 'ledger', 'hidden', 'truth', 'route', 'npc']) {
      const res = await search(q, 'public');
      assert.deepEqual(res.hits, [], `public search for ${q} leaked`);
    }
    const master = await search('quillon');
    assert.ok(master.hits.some((hit) => hit.path === 'places/harbor.md' && hit.masterOnly === false));
    assert.ok(master.hits.some((hit) => hit.path === 'secrets/npc.md' && hit.masterOnly === true));
  });

  it('a new document appears in search after the campaign changes', async () => {
    assert.deepEqual((await search('lighthouse')).hits, []);
    await fs.writeFile(path.join(tmp, 'lighthouse.md'), '# Beacon\n\nA lighthouse on the cliff.\n');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const hits = (await search('lighthouse')).hits;
    assert.ok(hits.some((hit) => hit.path === 'lighthouse.md'));
    await fs.rm(path.join(tmp, 'lighthouse.md'));
  });

  it('backlinks list the documents that link to this one, public view only public ones', async () => {
    const pub = await readDoc('keep.md', 'public');
    assert.deepEqual(pub.backlinks.map((b) => b.path), ['places/harbor.md']);
    const hidden = await readDoc('secrets/npc.md', 'public');
    assert.deepEqual(hidden.backlinks, []);
  });

  it('checks run the engine and report sketches and exclusions in plain language', async () => {
    const res = await request(server.port, { method: 'POST', path: '/api/checks/run' });
    assert.equal(res.status, 200, res.text);
    const checks = res.json as ChecksResponse;
    assert.ok(Array.isArray(checks.brokenLinks));
    assert.ok(checks.sketches.includes('Ruins'));
    assert.deepEqual(checks.exclusions, ['harbor, population: 40 (rounded in the text)']);
    assert.match(checks.checkedAt, /^\d{4}-\d{2}-\d{2}T/);

    const cached = await get('/api/checks');
    assert.equal(cached.status, 200);
    assert.equal((cached.json as ChecksResponse).checkedAt, checks.checkedAt);
  });

  it('a failing engine gives a plain 500 error', async () => {
    const broken = await startServer((port) =>
      apiFor(createCtx({ campaignRoot: tmp, frameworkRoot: '/nonexistent/yllir', port, log: () => {} })),
    );
    try {
      const res = await request(broken.port, { method: 'POST', path: '/api/checks/run' });
      assert.equal(res.status, 500);
      assert.deepEqual(res.json, { error: CHECK_FAILED_MESSAGE });
    } finally {
      await broken.close();
    }
  });
});
