import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { CardInput } from '../cockpit/card-schema.js';
import { createCtx, type Ctx } from '../context.js';
import { makeCampaign, makeFramework } from '../live/test-support.js';
import { BattleError, createBattleHost } from './battle.js';
import { CampaignCategories } from './categories.js';

const SESSION = '2026-11-13';

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

const CARD: CardInput = {
  actions: [
    {
      name: 'Morso',
      timing: 'own_turn',
      cost: 'action',
      kind: 'attack',
      toHit: 5,
      damage: [{ dice: '2d6+3', type: 'perforante' }],
      range: '3 m',
      effect: 'Morde un bersaglio vicino.',
    },
  ],
  traits: [{ name: 'Calore', text: 'Scalda chi la tocca.' }],
};

const ctxs: Ctx[] = [];
after(async () => {
  for (const ctx of ctxs) await ctx.closeAll();
});

/** A campaign with a creature sheet, a framework stand-in, and (optionally) an open live session. */
function setup(options: { session?: boolean } = {}) {
  const root = makeCampaign({ 'Creature/Verme.md': SHEET, 'Creature/Lupo.md': '# Lupo\n\nCA: 12\n' }, 'en');
  const frameworkRoot = makeFramework({ libs: true });
  const logs: string[] = [];
  const ctx = createCtx({ campaignRoot: root, frameworkRoot, port: 0, log: (message) => logs.push(message) });
  ctxs.push(ctx);
  const host = createBattleHost(ctx, { archive: { docs: new Map(), idle: async () => undefined }, categories: new CampaignCategories() });
  const liveDir = path.join(root, '.campaign', 'state', 'live');
  if (options.session !== false) {
    fs.mkdirSync(path.join(liveDir, SESSION), { recursive: true });
    fs.writeFileSync(path.join(liveDir, 'active.json'), JSON.stringify({ sessionId: SESSION }));
  }
  return { root, host, logs, sessionDir: path.join(liveDir, SESSION) };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('the promise should have been refused');
}

describe('action cards of a sheet', () => {
  it('stores a card and returns it while the sheet public text is unchanged', async () => {
    const { host } = setup();
    const saved = await host.setCard('Creature/Verme.md', CARD);
    assert.equal(saved.sheet, 'Creature/Verme.md');
    assert.equal(saved.actions.length, 1);
    assert.equal(saved.traits?.[0]?.name, 'Calore');
    const card = await host.card('Creature/Verme.md');
    assert.deepEqual(card, saved);
    assert.equal(card?.sheetHash, (await host.cardSource('Creature/Verme.md'))?.hash);
  });

  it('gives null once the public text of the sheet changes', async () => {
    const { host, root } = setup();
    await host.setCard('Creature/Verme.md', CARD);
    fs.writeFileSync(path.join(root, 'Creature/Verme.md'), SHEET.replace('CA: 13', 'CA: 15'));
    assert.equal(await host.card('Creature/Verme.md'), null);
  });

  it('keeps the card valid when only the master-only block changes', async () => {
    const { host, root } = setup();
    await host.setCard('Creature/Verme.md', CARD);
    fs.writeFileSync(
      path.join(root, 'Creature/Verme.md'),
      SHEET.replace('SEGRETO: il verme è il figlio del pozzo.', 'SEGRETO: il verme è il nipote del pozzo, e altro ancora.'),
    );
    const card = await host.card('Creature/Verme.md');
    assert.ok(card, 'the card is still valid');
    assert.equal(card.actions[0]?.name, 'Morso');
  });

  it('refuses an invalid card with status 400', async () => {
    const { host } = setup();
    const missingEffect = { actions: [{ name: 'Morso', timing: 'own_turn', cost: 'action', kind: 'attack' }] };
    const error = await rejectionOf(host.setCard('Creature/Verme.md', missingEffect as unknown as CardInput));
    assert.ok(error instanceof BattleError);
    assert.equal(error.status, 400);
    const tooHigh = { actions: [{ ...CARD.actions[0]!, toHit: 99 }] };
    const error2 = await rejectionOf(host.setCard('Creature/Verme.md', tooHigh));
    assert.ok(error2 instanceof BattleError);
    assert.equal(error2.status, 400);
  });

  it('refuses a sheet that is not a readable campaign file with status 400', async () => {
    const { host } = setup();
    const error = await rejectionOf(host.setCard('Creature/Assente.md', CARD));
    assert.ok(error instanceof BattleError);
    assert.equal(error.status, 400);
    assert.equal(await host.cardSource('../fuori.md'), null);
  });

  it('refuses to store a card with no active session with status 409', async () => {
    const { host } = setup({ session: false });
    const error = await rejectionOf(host.setCard('Creature/Verme.md', CARD));
    assert.ok(error instanceof BattleError);
    assert.equal(error.status, 409);
    assert.equal(await host.card('Creature/Verme.md'), null);
  });

  it('treats a damaged cards file as no cards, and logs it', async () => {
    const { host, sessionDir, logs } = setup();
    fs.writeFileSync(path.join(sessionDir, 'cards.json'), '{ non valido');
    assert.equal(await host.card('Creature/Verme.md'), null);
    assert.ok(logs.some((line) => line.includes('damaged')), 'the damage is logged');
    await host.setCard('Creature/Verme.md', CARD);
    assert.ok(await host.card('Creature/Verme.md'), 'a new card replaces the damaged file');
  });
});

describe('stats of a combatant with an action card', () => {
  /** A combat with a creature that has a sheet, another creature, and a player character. */
  function withCombat(sessionDir: string) {
    const combatants = [
      { id: 'c-1', name: 'Verme', side: 'enemy', initiative: 12, conditions: [], resources: {}, sheet: 'Creature/Verme.md' },
      { id: 'c-2', name: 'Lupo', side: 'enemy', initiative: 9, conditions: [], resources: {}, sheet: 'Creature/Lupo.md' },
      { id: 'c-3', name: 'Ada', side: 'pc', initiative: 10, conditions: [], resources: {} },
    ];
    fs.writeFileSync(
      path.join(sessionDir, 'combat.json'),
      JSON.stringify({ active: true, round: 1, turn: 0, order: ['c-1', 'c-2', 'c-3'], combatants, events: [], revision: 1 }),
    );
  }

  it('returns the card with source agent, and source parser without one; a player gets no source', async () => {
    const { host, sessionDir } = setup();
    withCombat(sessionDir);
    await host.setCard('Creature/Verme.md', CARD);

    const withCard = await host.stats('c-1');
    assert.ok(withCard);
    assert.equal(withCard.source, 'agent');
    assert.equal(withCard.card?.actions[0]?.name, 'Morso');

    const without = await host.stats('c-2');
    assert.ok(without);
    assert.equal(without.source, 'parser');
    assert.equal(without.card, undefined);

    const player = await host.stats('c-3');
    assert.ok(player);
    assert.equal(player.source, undefined);
    assert.deepEqual(player.actions, []);
  });
});
