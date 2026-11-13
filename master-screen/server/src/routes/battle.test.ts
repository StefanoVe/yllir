import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CombatRules, CombatantStats, LivePlayer } from '../../../shared/src/types.js';
import { actionOf, createBattleHost, imageOf } from '../cockpit-host/battle.js';
import { CampaignCategories } from '../cockpit-host/categories.js';
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

const TABLE_SHEET = [
  '---',
  'id: scheletro',
  'kind: creature',
  '---',
  '# Scheletro',
  '',
  '## Statistiche',
  '',
  '### Caratteristiche',
  '',
  '| Caratteristica | Valore |',
  '| --- | --- |',
  '| CA | 13 |',
  '| PF | 9 (2d8) |',
  '| Velocità | 9 m |',
  '',
].join('\n');

describe('stats of a creature whose combat entry has no HP or AC', () => {
  it('shows the HP and AC lines of its sheet when the combat gives none', async () => {
    if (!REAL_LIBS) return;
    const h = await setup({ 'Creature/Scheletro.md': TABLE_SHEET });
    await openSession(h);
    await send(h, 'POST', '/live/combat', { op: 'start' });
    const res = await send(h, 'POST', '/live/combat', { op: 'add', name: 'Scheletro', side: 'enemy', initiative: 9, sheet: 'Creature/Scheletro.md' });
    assert.equal(res.status, 200, res.text);
    const id = (res.json as { combat: { combatants: Array<{ id: string }> } }).combat.combatants[0]!.id;
    const stats = (await get(h, `/battle/stats/${id}`)).json as CombatantStats;
    assert.ok(stats.lines.some((line) => line.label === 'PF' && line.value === '9 (2d8)'), 'the sheet HP line shows');
    assert.ok(stats.lines.some((line) => line.label === 'CA' && line.value === '13'), 'the sheet AC line shows');
  });

  it('does not repeat the sheet HP line when the combat already gives HP', async () => {
    if (!REAL_LIBS) return;
    const h = await setup({ 'Creature/Scheletro.md': TABLE_SHEET });
    await openSession(h);
    await send(h, 'POST', '/live/combat', { op: 'start' });
    const res = await send(h, 'POST', '/live/combat', {
      op: 'add', name: 'Scheletro', side: 'enemy', initiative: 9, hp: 7, hpMax: 9, sheet: 'Creature/Scheletro.md',
    });
    assert.equal(res.status, 200, res.text);
    const id = (res.json as { combat: { combatants: Array<{ id: string }> } }).combat.combatants[0]!.id;
    const stats = (await get(h, `/battle/stats/${id}`)).json as CombatantStats;
    assert.ok(stats.lines.some((line) => line.label === 'HP' && line.value === '7/9'), 'the combat HP line shows');
    assert.equal(stats.lines.filter((line) => line.value === '9 (2d8)').length, 0, 'the sheet HP line is not repeated');
    assert.equal(stats.lines.filter((line) => line.value === '13').length, 1, 'the AC line of the sheet still shows once');
  });
});

describe('vitals of a sheet', () => {
  it('reads the first number of the HP and AC lines', async () => {
    if (!REAL_LIBS) return;
    const h = await setup({
      'Creature/Scheletro.md': TABLE_SHEET,
      'Creature/Lupo.md': '# Lupo\n\n## Statistiche\n\n| Caratteristica | Valore |\n| --- | --- |\n| CA | 13 (armatura di pelli: 12 + DES) |\n| PF | 9 (2d8) |\n',
    });
    const host = createBattleHost(h.ctx, { archive: { docs: new Map(), idle: async () => undefined }, categories: new CampaignCategories() });
    assert.deepEqual(await host.vitals('Creature/Scheletro.md'), { hp: 9, ac: 13 });
    assert.deepEqual(await host.vitals('Creature/Lupo.md'), { hp: 9, ac: 13 });
    assert.equal(await host.vitals('Creature/Assente.md'), null, 'no sheet, no vitals');
    assert.equal(await host.vitals('../fuori.md'), null, 'a path outside the campaign is refused');
  });
});

describe('GET /api/battle/rules', () => {
  it('lists the conditions and the durations of the game system, each with a label', async () => {
    if (!REAL_LIBS) return;
    const h = await setup();
    const res = await get(h, '/battle/rules');
    assert.equal(res.status, 200, res.text);
    const rules = res.json as CombatRules;
    const blinded = rules.conditions.find((item) => item.id === 'blinded');
    assert.ok(blinded, 'blinded is listed');
    assert.ok(blinded.label.length > 0, 'the condition has a label');
    assert.ok(rules.conditions.some((item) => item.id === 'prone'));
    const until = rules.durations.find((item) => item.id === 'until_save');
    assert.ok(until, 'until_save is listed');
    assert.ok(until.label.length > 0, 'the duration has a label');
  });
});

describe('stats of a creature: image and actions', () => {
  it('returns the first image of the public part, never one from the master-only block', async () => {
    if (!REAL_LIBS) return;
    const PUBLIC = '# Verme\n\n![Verme di brace](img/verme.png)\n\nCA: 13\n\n<!-- master -->\n![Segreto](img/segreto.png)\n<!-- /master -->\n';
    const MASTER_ONLY = '# Ombra\n\nCA: 11\n\n<!-- master -->\n![Segreto](img/segreto.png)\n<!-- /master -->\n';
    const h = await setup({
      'Creature/Verme.md': PUBLIC,
      'Creature/Ombra.md': MASTER_ONLY,
      'Creature/img/verme.png': PNG,
      'Creature/img/segreto.png': PNG,
    });
    await openSession(h);
    await send(h, 'POST', '/live/combat', { op: 'start' });
    let res = await send(h, 'POST', '/live/combat', { op: 'add', name: 'Verme', side: 'enemy', initiative: 12, hp: 45, hpMax: 45, sheet: 'Creature/Verme.md' });
    assert.equal(res.status, 200, res.text);
    res = await send(h, 'POST', '/live/combat', { op: 'add', name: 'Ombra', side: 'enemy', initiative: 8, hp: 20, hpMax: 20, sheet: 'Creature/Ombra.md' });
    assert.equal(res.status, 200, res.text);
    const combatants = (res.json as { combat: { combatants: Array<{ id: string; name: string }> } }).combat.combatants;
    const verme = combatants.find((c) => c.name === 'Verme')!.id;
    const ombra = combatants.find((c) => c.name === 'Ombra')!.id;

    const shown = (await get(h, `/battle/stats/${verme}`)).json as CombatantStats;
    assert.equal(shown.image, `/api/file?path=${encodeURIComponent('Creature/img/verme.png')}`);
    assert.ok(!JSON.stringify(shown).includes('segreto'), 'the master-only image is never returned');

    const hidden = (await get(h, `/battle/stats/${ombra}`)).json as CombatantStats;
    assert.equal(hidden.image, undefined, 'an image only inside the master block gives no image');
  });

  it('gives each action its group, timing and group label', async () => {
    if (!REAL_LIBS) return;
    const SHEET_ACTIONS = '# Lupo\n\n## Azioni\n\n**Morso.** Colpisce per 1d6 danni.\n';
    const h = await setup({ 'Creature/Lupo.md': SHEET_ACTIONS });
    await openSession(h);
    await send(h, 'POST', '/live/combat', { op: 'start' });
    const res = await send(h, 'POST', '/live/combat', { op: 'add', name: 'Lupo', side: 'enemy', initiative: 10, hp: 11, hpMax: 11, sheet: 'Creature/Lupo.md' });
    assert.equal(res.status, 200, res.text);
    const id = (res.json as { combat: { combatants: Array<{ id: string }> } }).combat.combatants[0]!.id;
    const stats = (await get(h, `/battle/stats/${id}`)).json as CombatantStats;
    assert.equal(stats.actions.length, 1);
    const [action] = stats.actions;
    assert.equal(action!.name, 'Morso');
    assert.equal(action!.text, 'Colpisce per 1d6 danni.');
    assert.ok(action!.group.length > 0, 'a group is always given');
    assert.ok(action!.groupLabel.length > 0, 'a group label is always given');
    assert.ok(['own_turn', 'any_turn', 'others_turns'].includes(action!.timing));
  });
});

describe('the defaults of the stats helpers', () => {
  it('gives group "actions", timing own_turn and the group id as label when the summary has none', () => {
    const action = actionOf('en', {}, { name: 'Artiglio', text: '+5, 1d6+3 taglienti' });
    assert.deepEqual(action, { name: 'Artiglio', text: '+5, 1d6+3 taglienti', group: 'actions', groupLabel: 'actions', timing: 'own_turn' });
  });

  it('takes the label in the campaign language, then English, from the adapter action groups', () => {
    const rules = {
      adapter: {
        action_groups: [
          { id: 'reactions', timing: 'others_turns', label: { it: 'Reazioni', en: 'Reactions' } },
          { id: 'bonus', timing: 'any_turn', label: { en: 'Bonus actions' } },
        ],
      },
    };
    assert.deepEqual(actionOf('it', rules, { name: 'Parata', text: 't', group: 'reactions', timing: 'others_turns' }), {
      name: 'Parata', text: 't', group: 'reactions', groupLabel: 'Reazioni', timing: 'others_turns',
    });
    assert.equal(actionOf('it', rules, { name: 'Balzo', text: 't', group: 'bonus' }).groupLabel, 'Bonus actions');
    assert.deepEqual(actionOf('it', rules, { name: 'Balzo', text: 't', group: 'bonus' }).timing, 'any_turn');
    assert.equal(actionOf('en', rules, { name: 'X', text: 't', group: 'unknown-group' }).groupLabel, 'unknown-group');
  });

  it('reads the image of a sheet only from a campaign file with an image extension', () => {
    assert.equal(imageOf('Creature/Verme.md', '![v](img/v.png)'), `/api/file?path=${encodeURIComponent('Creature/img/v.png')}`);
    assert.equal(imageOf('Creature/Verme.md', '![v](https://example.com/v.png)'), undefined);
    assert.equal(imageOf('Creature/Verme.md', '![v](../../secret.png)'), undefined);
    assert.equal(imageOf('Creature/Verme.md', '![v](notes.txt)'), undefined);
    assert.equal(imageOf('Creature/Verme.md', 'nessuna immagine'), undefined);
  });
});
