import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { BattleView } from '../../../shared/src/types.js';
import { plainTwinOf } from './battle.js';
import { LOG_LIB, COMBAT_LIB } from '../live/framework.js';
import { liveDirOf, readActiveId } from '../live/snapshot.js';
import { get, makeCampaign, send, startApp, type Harness } from '../live/test-support.js';

const REAL_FRAMEWORK = fileURLToPath(new URL('../../../../yllir', import.meta.url));
const REAL_LIBS = fs.existsSync(path.join(REAL_FRAMEWORK, LOG_LIB)) && fs.existsSync(path.join(REAL_FRAMEWORK, COMBAT_LIB));

const CAMPAIGN_YAML = [
  'schema: 1',
  'campaign:',
  '  name: Test Campaign',
  '  slug: test-campaign',
  'language:',
  '  main: en',
  'system:',
  '  adapter: dnd-2024',
  'structure:',
  '  - id: giocatori',
  '    folder: Giocatori',
  '    type: master-only',
  '  - id: creature',
  '    folder: Creature',
  '    type: subjects',
  '  - id: luoghi',
  '    folder: Mondo',
  '    type: places',
  '',
].join('\n');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function writeFiles(root: string, files: Record<string, string | Buffer>): void {
  for (const [rel, value] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  }
}

const harnesses: Harness[] = [];
after(async () => {
  for (const h of harnesses) {
    await h.server.close();
    await h.ctx.closeAll();
  }
});

describe('plainTwinOf', () => {
  it('finds the gridless images-skill twin of a grid map', async () => {
    const root = makeCampaign();
    writeFiles(root, { 'img/x-map.png': PNG, 'img/x-map-grid.png': PNG });
    assert.equal(await plainTwinOf(root, 'img/x-map-grid.png'), 'img/x-map.png');
  });

  it('finds the -senza-griglia twin of a generic image, using a webp when only webp exists', async () => {
    const root = makeCampaign();
    writeFiles(root, { 'img/y.png': PNG, 'img/y-senza-griglia.webp': 'webp' });
    assert.equal(await plainTwinOf(root, 'img/y.png'), 'img/y-senza-griglia.webp');
  });

  it('prefers the same extension as the ref when several twins exist', async () => {
    const root = makeCampaign();
    writeFiles(root, { 'img/y.jpg': 'jpg', 'img/y-senza-griglia.png': PNG, 'img/y-senza-griglia.jpg': 'jpg' });
    assert.equal(await plainTwinOf(root, 'img/y.jpg'), 'img/y-senza-griglia.jpg');
  });

  it('returns undefined when there is no twin', async () => {
    const root = makeCampaign();
    writeFiles(root, { 'img/y.png': PNG, 'img/x-map-grid.png': PNG });
    assert.equal(await plainTwinOf(root, 'img/y.png'), undefined);
    assert.equal(await plainTwinOf(root, 'img/x-map-grid.png'), undefined);
  });

  it('returns undefined for a ref that is already gridless', async () => {
    const root = makeCampaign();
    writeFiles(root, {
      'img/x-map.png': PNG,
      'img/x-map-grid.png': PNG,
      'img/y-senza-griglia.png': PNG,
      'img/y-senza-griglia.webp': 'webp',
    });
    assert.equal(await plainTwinOf(root, 'img/x-map.png'), undefined);
    assert.equal(await plainTwinOf(root, 'img/y-senza-griglia.png'), undefined);
  });
});

describe('GET and PUT /api/battle with a gridless twin', () => {
  it('returns map.plain while battle.json on disk has no plain', async () => {
    if (!REAL_LIBS) return;
    const root = makeCampaign({ 'campaign.yaml': CAMPAIGN_YAML }, 'en');
    writeFiles(root, { 'img/mappa-map-grid.png': PNG, 'img/mappa-map.png': PNG });
    const h = await startApp(root, REAL_FRAMEWORK);
    harnesses.push(h);

    const opened = await send(h, 'POST', '/live/open', {});
    assert.equal(opened.status, 200, opened.text);

    const put = await send(h, 'PUT', '/battle', { map: { ref: 'img/mappa-map-grid.png', cols: 10, rows: 8 } });
    assert.equal(put.status, 200, put.text);
    assert.deepEqual((put.json as BattleView).map, { ref: 'img/mappa-map-grid.png', cols: 10, rows: 8, plain: 'img/mappa-map.png' });

    const res = await get(h, '/battle');
    assert.equal(res.status, 200, res.text);
    assert.deepEqual((res.json as BattleView).map, { ref: 'img/mappa-map-grid.png', cols: 10, rows: 8, plain: 'img/mappa-map.png' });

    const sessionId = await readActiveId(root);
    assert.ok(sessionId);
    const stored = JSON.parse(fs.readFileSync(path.join(liveDirOf(root), sessionId, 'battle.json'), 'utf8')) as {
      map: Record<string, unknown>;
    };
    assert.deepEqual(stored.map, { ref: 'img/mappa-map-grid.png', cols: 10, rows: 8 });
    assert.equal('plain' in stored.map, false);
  });
});
