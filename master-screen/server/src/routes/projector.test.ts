import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import type {
  BattleView,
  CombatState,
  Combatant,
  ProjectableResponse,
  ProjectedCombat,
  Projection,
} from '../../../shared/src/types.js';
import { get, makeCampaign, makeFramework, send, sendRaw, startApp, type Harness } from '../live/test-support.js';
import { projectCombat } from '../projector/projector.js';

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

  it('a combat request with no live session answers the rest screen, and a combat body takes no other key', async () => {
    const res = await send(h, 'POST', '/projector', { kind: 'combat' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { kind: 'combat', combat: null });
    assert.deepEqual(await projection(), { kind: 'combat', combat: null });

    const extra = await send(h, 'POST', '/projector', { kind: 'combat', src: MAP });
    assert.equal(extra.status, 400);
    assert.deepEqual(extra.json, { error: 'The request could not be read.' });

    await send(h, 'POST', '/projector', { kind: 'blank' });
  });
});

describe('projectCombat', () => {
  const FIGHTERS: Combatant[] = [
    {
      id: 'c-1', name: 'Mira', side: 'pc', initiative: 18, hp: 20, hpMax: 30, tempHp: 4, ac: 15,
      conditions: [{ id: 'prone', duration: 'until-removed' }], resources: { 'spell slots': 2 },
      notes: 'master only', sheet: 'Players/Mira.md',
    },
    {
      id: 'c-2', name: 'Goblin', side: 'enemy', initiative: 14, hp: 3, hpMax: 10, ac: 13,
      conditions: [], resources: {}, notes: 'master only', sheet: 'Enemies/goblin.md',
    },
    { id: 'c-3', name: 'Ghost', side: 'enemy', initiative: 12, hp: 0, hpMax: 10, conditions: [], resources: {}, hidden: true },
    {
      id: 'c-4', name: 'Guard', side: 'ally', initiative: 10, hp: 5, hpMax: 12, tempHp: 0, ac: 16,
      conditions: [], resources: {}, defeated: true,
    },
  ];

  const stateOf = (overrides: Partial<CombatState> = {}, combatants: Combatant[] = FIGHTERS): CombatState => ({
    active: true,
    round: 2,
    turn: 1,
    order: ['c-1', 'c-2', 'c-3', 'c-4', 'c-9'],
    combatants,
    events: [],
    revision: 3,
    ...overrides,
  });

  const BATTLE: BattleView = {
    map: { ref: 'Maps/harbor.png', cols: 10, rows: 8 },
    positions: { 'c-1': { x: 2, y: 3 }, 'c-2': { x: 4, y: 4 }, 'c-3': { x: 9, y: 9 }, 'c-9': { x: 1, y: 1 } },
    revision: 5,
  };

  /** The projected row of one enemy with the given hit points, in a fight where it is up. */
  function enemyRow(hp: number | undefined, extra: Partial<Combatant> = {}): ProjectedCombat['order'][number] {
    const enemy: Combatant = { id: 'e', name: 'E', side: 'enemy', initiative: 5, conditions: [], resources: {}, ...extra };
    if (hp !== undefined) enemy.hp = hp;
    enemy.hpMax = 10;
    const projected = projectCombat(stateOf({ order: ['e'], turn: 0 }, [enemy]), null, null);
    assert.ok(projected);
    return projected.order[0];
  }

  it('is null when there is no state or the combat is not active', () => {
    assert.equal(projectCombat(null, BATTLE, null), null);
    assert.equal(projectCombat(stateOf({ active: false }), BATTLE, null), null);
  });

  it('leaves hidden combatants and unknown ids out of the order', () => {
    const projected = projectCombat(stateOf(), null, null);
    assert.ok(projected);
    assert.deepEqual(projected.order.map((row) => row.id), ['c-1', 'c-2', 'c-4']);
    assert.equal(projected.round, 2);
  });

  it('marks the combatant at the turn index as current', () => {
    const projected = projectCombat(stateOf(), null, null);
    assert.ok(projected);
    assert.deepEqual(projected.order.map((row) => row.current), [false, true, false]);
  });

  it('marks nobody current when the turn holder is hidden or the turn is out of range', () => {
    const hiddenTurn = projectCombat(stateOf({ turn: 2 }), null, null);
    assert.ok(hiddenTurn);
    assert.equal(hiddenTurn.order.some((row) => row.current), false);
    const outOfRange = projectCombat(stateOf({ turn: 40 }), null, null);
    assert.ok(outOfRange);
    assert.equal(outOfRange.order.some((row) => row.current), false);
  });

  it('gives an enemy only a health word, from its hit points: 100%, 60%, 40% and 0%', () => {
    assert.equal(enemyRow(10).health, 'unhurt');
    assert.equal(enemyRow(6).health, 'wounded');
    assert.equal(enemyRow(4).health, 'bloodied');
    assert.equal(enemyRow(0).health, 'down');
    assert.equal(enemyRow(7, { defeated: true }).health, 'down');
  });

  it('gives an enemy no health word when its hit points are not known', () => {
    const row = enemyRow(undefined);
    assert.equal(row.health, undefined);
    assert.equal('health' in row, false);
  });

  it('gives an enemy no numbers, armour, conditions, notes or sheet at all', () => {
    const projected = projectCombat(stateOf(), null, null);
    assert.ok(projected);
    const enemy = projected.order[1];
    assert.deepEqual(Object.keys(enemy).sort(), ['current', 'health', 'id', 'initiative', 'name', 'side']);
    assert.equal(JSON.stringify(projected).includes('master only'), false);
    assert.equal(JSON.stringify(projected).includes('goblin.md'), false);
  });

  it('keeps hit points of a player character and an ally, and never their armour, conditions or resources', () => {
    const projected = projectCombat(stateOf(), null, null);
    assert.ok(projected);
    const pc = projected.order[0];
    assert.deepEqual(Object.keys(pc).sort(), ['current', 'hp', 'hpMax', 'id', 'initiative', 'name', 'side', 'tempHp']);
    assert.equal(pc.hp, 20);
    assert.equal(pc.hpMax, 30);
    assert.equal(pc.tempHp, 4);
    const ally = projected.order[2];
    assert.deepEqual(Object.keys(ally).sort(), ['current', 'defeated', 'hp', 'hpMax', 'id', 'initiative', 'name', 'side']);
    assert.equal(ally.defeated, true);
  });

  it('copies no temporary hit points of zero and no defeated flag that is not true', () => {
    const projected = projectCombat(stateOf(), null, null);
    assert.ok(projected);
    assert.equal('tempHp' in projected.order[2], false);
    assert.equal('defeated' in projected.order[0], false);
  });

  it('keeps only the tokens of the projected order, and the map with its grid', () => {
    const projected = projectCombat(stateOf(), BATTLE, '/api/file?path=Maps%2Fharbor.png');
    assert.ok(projected);
    assert.deepEqual(projected.map, { src: '/api/file?path=Maps%2Fharbor.png', cols: 10, rows: 8 });
    assert.deepEqual(projected.positions, { 'c-1': { x: 2, y: 3 }, 'c-2': { x: 4, y: 4 } });
  });

  it('projects no map and no tokens when the map may not be shown', () => {
    const projected = projectCombat(stateOf(), BATTLE, null);
    assert.ok(projected);
    assert.equal(projected.map, null);
    assert.deepEqual(projected.positions, {});
  });
});

describe('projector combat, end to end', () => {
  let tmp: string;
  let h: Harness;

  before(async () => {
    tmp = makeCampaign({});
    h = await startApp(tmp, makeFramework({ libs: true }));
  });

  after(async () => {
    await h.server.close();
    await h.ctx.closeAll();
  });

  it('projects the order without the hidden combatant, and keeps the enemy numberless', async () => {
    const opened = await send(h, 'POST', '/live/open', {});
    assert.equal(opened.status, 200, opened.text);
    const sessionId = (opened.json as { session: { id: string } }).session.id;
    await send(h, 'POST', '/live/combat', { op: 'start' });
    await send(h, 'POST', '/live/combat', { op: 'add', name: 'Mira', side: 'pc', initiative: 18 });
    await send(h, 'POST', '/live/combat', { op: 'add', name: 'Goblin', side: 'enemy', initiative: 14 });
    await send(h, 'POST', '/live/combat', { op: 'add', name: 'Ghost', side: 'enemy', initiative: 12 });
    await send(h, 'POST', '/live/combat', { op: 'next' });

    // The stand-in library has no `hidden` or hit points: the test sets them in the combat file.
    const file = path.join(tmp, '.campaign', 'state', 'live', sessionId, 'combat.json');
    const stored = JSON.parse(fsSync.readFileSync(file, 'utf8')) as CombatState;
    stored.combatants[1] = { ...stored.combatants[1], hp: 3, hpMax: 10, ac: 13, notes: 'master only' };
    stored.combatants[2] = { ...stored.combatants[2], hidden: true };
    fsSync.writeFileSync(file, JSON.stringify(stored, null, 2));

    const res = await send(h, 'POST', '/projector', { kind: 'combat' });
    assert.equal(res.status, 200);
    const projected = (res.json as { kind: 'combat'; combat: ProjectedCombat }).combat;
    assert.deepEqual(projected.order.map((row) => row.id), ['c-1', 'c-2']);
    assert.deepEqual(projected.order.map((row) => row.current), [false, true]);
    assert.equal(projected.order[1].health, 'bloodied');
    assert.deepEqual(Object.keys(projected.order[1]).sort(), ['current', 'health', 'id', 'initiative', 'name', 'side']);
    assert.equal(projected.map, null);
    assert.deepEqual(projected.positions, {});

    const text = JSON.stringify(res.json);
    assert.equal(text.includes('Ghost'), false);
    assert.equal(text.includes('master only'), false);

    assert.deepEqual((await get(h, '/projector')).json, res.json);
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
