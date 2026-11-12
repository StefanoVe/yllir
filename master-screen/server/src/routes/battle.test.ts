import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CombatantStats, LivePlayer } from '../../../shared/src/types.js';
import { COMBAT_LIB, LOG_LIB } from '../live/framework.js';
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

const SHEET = [
  '---',
  'id: verme',
  'kind: creature',
  '---',
  '# Verme di brace',
  '',
  '## Statistiche',
  '',
  'CA: 13',
  'Punti ferita: 45',
  '',
  '<!-- master -->',
  '## Master',
  'SEGRETO: il verme è il figlio del pozzo.',
  '<!-- /master -->',
  '',
].join('\n');

const harnesses: Harness[] = [];
after(async () => {
  for (const h of harnesses) {
    await h.server.close();
    await h.ctx.closeAll();
  }
});

async function setup(files: Record<string, string | Buffer> = {}): Promise<Harness> {
  const root = makeCampaign({ 'campaign.yaml': CAMPAIGN_YAML }, 'en');
  for (const [rel, value] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  }
  const h = await startApp(root, REAL_FRAMEWORK);
  harnesses.push(h);
  return h;
}

async function openSession(h: Harness): Promise<void> {
  const res = await send(h, 'POST', '/live/open', {});
  assert.equal(res.status, 200, res.text);
}

describe('GET /api/battle/players', () => {
  it('lists the player characters: title from the first heading, else the file name; sessions left out', async () => {
    if (!REAL_LIBS) return;
    const h = await setup({
      'Giocatori/Neri Calce.md': '---\nid: neri-calce\n---\n# Neri Calce\n\nUn ladro.\n',
      'Giocatori/Senza titolo.md': 'Solo testo.\n',
    });
    const res = await get(h, '/battle/players');
    assert.equal(res.status, 200, res.text);
    const players = (res.json as { players: LivePlayer[] }).players;
    assert.deepEqual(players, [
      { name: 'Neri Calce', ref: 'Giocatori/Neri Calce.md' },
      { name: 'Senza titolo', ref: 'Giocatori/Senza titolo.md' },
    ]);
  });
});

describe('GET and PUT /api/battle', () => {
  it('is null with no live session, and the empty view once one is open', async () => {
    if (!REAL_LIBS) return;
    const h = await setup();
    assert.equal((await get(h, '/battle')).json, null);
    await openSession(h);
    assert.deepEqual((await get(h, '/battle')).json, { map: null, positions: {}, revision: 0 });
  });

  it('merges a positions update into the stored ones, and a map field replaces only the map', async () => {
    if (!REAL_LIBS) return;
    const h = await setup({ 'img/mappa.png': PNG });
    await openSession(h);
    let res = await send(h, 'PUT', '/battle', { positions: { 'c-1': { x: 1, y: 2 } } });
    assert.equal(res.status, 200, res.text);
    res = await send(h, 'PUT', '/battle', { positions: { 'c-2': { x: 3, y: 4 } } });
    assert.deepEqual(res.json, { map: null, positions: { 'c-1': { x: 1, y: 2 }, 'c-2': { x: 3, y: 4 } }, revision: 2 });
    res = await send(h, 'PUT', '/battle', { positions: { 'c-1': { x: 9, y: 9 } } });
    assert.deepEqual((res.json as { positions: unknown }).positions, { 'c-1': { x: 9, y: 9 }, 'c-2': { x: 3, y: 4 } });
    res = await send(h, 'PUT', '/battle', { map: { ref: 'img/mappa.png', cols: 10, rows: 8 } });
    assert.deepEqual(res.json, {
      map: { ref: 'img/mappa.png', cols: 10, rows: 8 },
      positions: { 'c-1': { x: 9, y: 9 }, 'c-2': { x: 3, y: 4 } },
      revision: 4,
    });
    res = await send(h, 'PUT', '/battle', { positions: { 'c-2': null } });
    assert.deepEqual((res.json as { positions: unknown }).positions, { 'c-1': { x: 9, y: 9 } });
    assert.deepEqual((res.json as { map: unknown }).map, { ref: 'img/mappa.png', cols: 10, rows: 8 });
    res = await send(h, 'PUT', '/battle', { map: null });
    assert.equal((res.json as { map: unknown }).map, null);
    assert.deepEqual((await get(h, '/battle')).json, { map: null, positions: { 'c-1': { x: 9, y: 9 } }, revision: 6 });
  });

  it('refuses bad coordinates and map refs that are not existing images of the campaign', async () => {
    if (!REAL_LIBS) return;
    const h = await setup({ 'img/mappa.png': PNG, 'notes.txt': 'x' });
    await openSession(h);
    assert.equal((await send(h, 'PUT', '/battle', { positions: { 'c-1': { x: 'a', y: 1 } } })).status, 400);
    assert.equal((await send(h, 'PUT', '/battle', { positions: { 'c-1': { x: Number.NaN, y: 1 } } })).status, 400);
    assert.equal((await send(h, 'PUT', '/battle', { map: { ref: '../secret.png' } })).status, 400);
    assert.equal((await send(h, 'PUT', '/battle', { map: { ref: 'img/nope.png' } })).status, 400);
    assert.equal((await send(h, 'PUT', '/battle', { map: { ref: 'notes.txt' } })).status, 400);
  });

  it('answers 409 to a write with no live session', async () => {
    if (!REAL_LIBS) return;
    const h = await setup();
    assert.equal((await send(h, 'PUT', '/battle', { positions: { 'c-1': { x: 1, y: 1 } } })).status, 409);
  });
});

describe('GET /api/battle/maps', () => {
  it('lists the battle maps with their sheet, filtered by place, with cols and rows from the map job', async () => {
    if (!REAL_LIBS) return;
    const h = await setup({
      'Mondo/Taverna.md': '---\nid: taverna\n---\n# Taverna\n\n![Pianta della taverna](img/taverna-map-grid.png)\n',
      'Mondo/img/taverna-map-grid.png': PNG,
      '.campaign/state/maps/taverna-map-1/job.json': JSON.stringify({ document: 'Mondo/Taverna.md', cols: 24, rows: 16, cell: 64 }),
    });
    const all = await get(h, '/battle/maps');
    assert.equal(all.status, 200, all.text);
    const maps = all.json as Array<{ ref: string; url: string; sheet: string; title: string; cols?: number; rows?: number }>;
    assert.equal(maps.length, 1);
    assert.equal(maps[0]!.ref, 'Mondo/img/taverna-map-grid.png');
    assert.equal(maps[0]!.sheet, 'Mondo/Taverna.md');
    assert.equal(maps[0]!.url, `/api/file?path=${encodeURIComponent('Mondo/img/taverna-map-grid.png')}`);
    assert.equal(maps[0]!.cols, 24);
    assert.equal(maps[0]!.rows, 16);
    const accented = (await get(h, `/battle/maps?place=${encodeURIComponent('TAVÈRNA')}`)).json as unknown[];
    assert.equal(accented.length, 1, 'case and accents are ignored');
    const byTitle = (await get(h, `/battle/maps?place=${encodeURIComponent('taverna')}`)).json as unknown[];
    assert.equal(byTitle.length, 1);
    assert.deepEqual((await get(h, `/battle/maps?place=${encodeURIComponent('foresta')}`)).json, []);
  });
});

describe('GET /api/battle/stats/:combatantId', () => {
  it('gives the player only initiative, the creature its HP, AC and public stats, and never the master block', async () => {
    if (!REAL_LIBS) return;
    const h = await setup({ 'Creature/Verme.md': SHEET, 'Giocatori/Neri Calce.md': '# Neri Calce\n' });
    await openSession(h);
    let res = await send(h, 'POST', '/live/combat', { op: 'start' });
    assert.equal(res.status, 200, res.text);
    res = await send(h, 'POST', '/live/combat', { op: 'add', name: 'Neri', side: 'pc', initiative: 15 });
    assert.equal(res.status, 200, res.text);
    res = await send(h, 'POST', '/live/combat', {
      op: 'add', name: 'Verme', side: 'enemy', initiative: 12, hp: 45, hpMax: 45, sheet: 'Creature/Verme.md',
    });
    assert.equal(res.status, 200, res.text);
    const combatants = (res.json as { combat: { combatants: Array<{ id: string; name: string }> } }).combat.combatants;
    const pcId = combatants.find((c) => c.name === 'Neri')!.id;
    const verme = combatants.find((c) => c.name === 'Verme')!.id;

    const pc = await get(h, `/battle/stats/${pcId}`);
    assert.equal(pc.status, 200, pc.text);
    assert.deepEqual(pc.json, { lines: [{ label: 'Initiative', value: '15' }], actions: [] });

    const creature = await get(h, `/battle/stats/${verme}`);
    assert.equal(creature.status, 200, creature.text);
    const stats = creature.json as CombatantStats;
    assert.deepEqual(stats.lines.slice(0, 2), [
      { label: 'Initiative', value: '12' },
      { label: 'HP', value: '45/45' },
    ]);
    assert.ok(!JSON.stringify(stats).includes('SEGRETO'), 'the master block never reaches the tooltip');

    assert.equal((await get(h, '/battle/stats/c-999')).status, 404);
    assert.equal((await get(h, '/battle/stats/' + encodeURIComponent('bad id'))).status, 404);
  });
});
