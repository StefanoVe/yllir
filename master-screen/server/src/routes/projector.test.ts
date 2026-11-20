import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import type { ProjectableResponse, Projection } from '../../../shared/src/types.js';
import { get, send, sendRaw, startApp, type Harness } from '../live/test-support.js';

// The real framework in this repository (four levels up from src/routes/).
const REAL_FRAMEWORK = fileURLToPath(new URL('../../../../yllir', import.meta.url));

const CAMPAIGN_YAML = `schema: 1
campaign:
  name: Projector Fixture
  slug: projector-fixture
  seed: seed.md
language:
  main: en
structure:
  - folder: places
    type: places
  - folder: secrets
    type: master-only
`;

// The public part shows img/map.png; the master block shows img/hidden-plan.png.
const HARBOR = `<!-- yllir
id: harbor
kind: place
provenance: master
-->
# Harbor

The harbor of Oakvale is busy. See ![map](../img/map.png).

<!-- master -->
Hidden truth: the smugglers use ![plan](../img/hidden-plan.png).
`;

const RUINS = `<!-- yllir
id: ruins
kind: place
provenance: master
-->
# Ruins

Nothing to show here.
`;

const NPC = `# Quillon

The smuggler Quillon has a portrait: ![portrait](../img/npc-portrait.png).
`;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MAP = '/api/file?path=img%2Fmap.png';

describe('projector routes', () => {
  let tmp: string;
  let h: Harness;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-projector-'));
    const write = async (rel: string, content: string | Buffer) => {
      await fs.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true });
      await fs.writeFile(path.join(tmp, rel), content);
    };
    await write('campaign.yaml', CAMPAIGN_YAML);
    await write('seed.md', '# World Seed\n\nThe seed.\n');
    await write('places/harbor.md', HARBOR);
    await write('places/ruins.md', RUINS);
    await write('secrets/npc.md', NPC);
    await write('img/map.png', PNG);
    await write('img/hidden-plan.png', PNG);
    await write('img/npc-portrait.png', PNG);
    await write('img/orphan.png', PNG);
    await write('img/notes.txt', 'not an image');
    h = await startApp(tmp, REAL_FRAMEWORK);
  });

  after(async () => {
    await h.server.close();
    await h.ctx.closeAll();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const projection = async (): Promise<Projection> => (await get(h, '/projector')).json as Projection;
  const check = async (src: string): Promise<boolean> =>
    ((await get(h, `/projector/check?src=${encodeURIComponent(src)}`)).json as ProjectableResponse).projectable;

  it('starts blank', async () => {
    const res = await get(h, '/projector');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { kind: 'blank' });
  });

  it('projects an image the public part of a document shows, and answers the normalized source', async () => {
    const res = await send(h, 'POST', '/projector', { kind: 'image', src: MAP });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { kind: 'image', src: MAP });
    assert.deepEqual(await projection(), { kind: 'image', src: MAP });
  });

  it('rebuilds the source on the server: extra query parameters are dropped', async () => {
    const res = await send(h, 'POST', '/projector', { kind: 'image', src: '/api/file?path=img/map.png&x=1' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { kind: 'image', src: MAP });
  });

  it('refuses an image that only the master block of a public document shows', async () => {
    const res = await send(h, 'POST', '/projector', {
      kind: 'image',
      src: '/api/file?path=img%2Fhidden-plan.png',
    });
    assert.equal(res.status, 403);
    assert.deepEqual(res.json, { error: 'This image cannot be shown to the players.' });
    assert.deepEqual(await projection(), { kind: 'image', src: MAP });
  });

  it('refuses an image that only a master-only document shows', async () => {
    const res = await send(h, 'POST', '/projector', {
      kind: 'image',
      src: '/api/file?path=img%2Fnpc-portrait.png',
    });
    assert.equal(res.status, 403);
    assert.deepEqual(res.json, { error: 'This image cannot be shown to the players.' });
  });

  it('refuses an image no document references', async () => {
    const res = await send(h, 'POST', '/projector', { kind: 'image', src: '/api/file?path=img%2Forphan.png' });
    assert.equal(res.status, 403);
  });

  it('refuses sources that are not campaign images', async () => {
    const hostile = [
      'https://evil.example/x.png',
      '//evil.example/api/file?path=img%2Fmap.png',
      'data:image/png;base64,iVBORw0KGgo=',
      '/api/file?path=../img/map.png',
      '/api/file?path=img%2F..%2F..%2Fetc%2Fpasswd',
      '/api/file?path=%2Fetc%2Fpasswd',
      '/api/file?path=.campaign%2Fstate.png',
      '/api/file?path=img%2Fnotes.txt',
      '/api/other?path=img%2Fmap.png',
      '/etc/passwd',
      '',
    ];
    for (const src of hostile) {
      const res = await send(h, 'POST', '/projector', { kind: 'image', src });
      assert.equal(res.status, 403, src);
      assert.equal(await check(src), false, src);
    }
    assert.deepEqual(await projection(), { kind: 'image', src: MAP });
  });

  it('projects an image the master uploaded to a live board, rebuilt from its two plain segments', async () => {
    const src = '/api/cockpit/sessions/sess-1/files/board-sketch.png';
    const res = await send(h, 'POST', '/projector', { kind: 'image', src });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { kind: 'image', src });
    const refused = [
      '/api/cockpit/sessions/sess-1/files/board-sketch.txt',
      '/api/cockpit/sessions/sess-1/files/..',
      '/api/cockpit/sessions/..%2F..%2Fx/files/a.png',
      '/api/cockpit/sessions/sess-1/files/a%20b.png',
      '/api/cockpit/sessions/sess-1/files/a.png/extra',
      '/api/cockpit/sessions/sess-1/files/%E0%A4%A.png',
    ];
    for (const bad of refused) {
      const refusal = await send(h, 'POST', '/projector', { kind: 'image', src: bad });
      assert.equal(refusal.status, 403, bad);
    }
    await send(h, 'POST', '/projector', { kind: 'image', src: MAP });
  });

  it('answers 400 to a body that is not exactly one of the two kinds', async () => {
    const bodies: unknown[] = [
      {},
      [],
      { kind: 'other' },
      { kind: 'image' },
      { kind: 'image', src: 5 },
      { kind: 'image', src: MAP, extra: true },
      { kind: 'image', src: 'x'.repeat(2049) },
      { kind: 'blank', extra: 1 },
    ];
    for (const body of bodies) {
      const res = await send(h, 'POST', '/projector', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(res.json, { error: 'The request could not be read.' });
    }
    const raw = await sendRaw(h, 'POST', '/projector', '{not json');
    assert.equal(raw.status, 400);
    assert.equal(typeof (raw.json as { error?: unknown }).error, 'string');
    assert.deepEqual(await projection(), { kind: 'image', src: MAP });
  });

  it('a blank request sets the blank projection and answers it', async () => {
    const res = await send(h, 'POST', '/projector', { kind: 'blank' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { kind: 'blank' });
    assert.deepEqual(await projection(), { kind: 'blank' });
  });

  it('checks whether a source is projectable', async () => {
    assert.equal(await check(MAP), true);
    assert.equal(await check('/api/file?path=img%2Fhidden-plan.png'), false);
    assert.equal(await check('/api/file?path=img%2Fnpc-portrait.png'), false);
    assert.equal(await check('https://evil.example/x.png'), false);
    assert.equal(await check('/api/cockpit/sessions/sess-1/files/board.png'), true);
    const missing = (await get(h, '/projector/check')).json as ProjectableResponse;
    assert.deepEqual(missing, { projectable: false });
  });

  it('the event stream sends the current projection in its first frame', async () => {
    await send(h, 'POST', '/projector', { kind: 'image', src: MAP });
    const { status, contentType, text } = await firstFrame(h.port, '/api/projector/events');
    assert.equal(status, 200);
    assert.equal(contentType, 'text/event-stream; charset=utf-8');
    assert.match(text, /^retry: 3000\n\n/);
    assert.match(text, /event: projection\ndata: \{"kind":"image","src":"\/api\/file\?path=img%2Fmap\.png"\}\n\n/);
    await send(h, 'POST', '/projector', { kind: 'blank' });
  });
});

/** Opens the SSE stream on a real connection, reads until the first projection frame, then closes it. */
function firstFrame(port: number, route: string): Promise<{ status: number; contentType: string; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: route, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        text += chunk;
        if (/event: projection\ndata: [^\n]*\n\n/.test(text)) {
          resolve({ status: res.statusCode ?? 0, contentType: String(res.headers['content-type']), text });
          req.destroy();
        }
      });
      res.on('error', () => undefined);
    });
    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err);
    });
    setTimeout(() => reject(new Error('no projection frame')), 5000).unref();
  });
}
