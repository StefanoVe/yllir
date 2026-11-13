import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runEncounters } from './encounters.mjs';

const campaignYaml = (adapter) => `schema: 1

campaign:
  name: "Prova"
  slug: prova

language:
  main: it
  other: []

system:
  adapter: ${adapter}

structure:
  - id: trama
    folder: Trama
    type: plot
  - id: creature
    folder: Creature
    type: subjects
  - id: giocatori
    folder: Giocatori
    type: master-only
`;

/** A document: frontmatter lines, then a body (already Markdown). */
const page = (frontmatter, body) => ['---', ...frontmatter, '---', body, ''].join('\n');

const GUARDIANO = page(
  ['id: guardiano-di-sale', 'template: enemy', 'provenance: master'],
  [
    '# Guardiano di sale',
    '',
    '## Natura',
    '',
    'Una statua di sale che cammina.',
    '',
    '## Statistiche',
    '',
    '### Caratteristiche',
    '',
    '| Caratteristica | Valore |',
    '| --- | --- |',
    '| CA | 13 |',
    '| PF | 30 |',
    '| GS | 1/2 |',
    '',
  ].join('\n'),
);

const SACCO = page(
  ['id: sacco-di-sale', 'template: enemy', 'provenance: master'],
  ['# Sacco di sale', '', '## Natura', '', 'Un sacco che si muove.', '', '## Statistiche', '', 'Punti ferita: 4', ''].join('\n'),
);

const PC_LEVEL_3 = (id, name) => page(
  [`id: ${id}`, 'level: 3', 'provenance: master'],
  `# ${name}\n\n## Scheda\n\nUn personaggio.\n`,
);

const SCONTRO = page(
  ['id: scontro-al-ponte', 'session: sessione-1', 'provenance: played', 'enemies:', '  - id: guardiano-di-sale', '    count: 4'],
  '# Scontro al ponte\n\nIl guardiano sbarra il ponte.\n',
);

const AGGUATO = page(
  ['id: agguato-al-guado', 'session: sessione-2', 'provenance: played', 'enemies:', '  - id: sacco-di-sale', '    count: 1'],
  '# Agguato al guado\n\nUn sacco si muove nell acqua.\n',
);

const BASE = {
  'Creature/Guardiano.md': GUARDIANO,
  'Creature/Sacco.md': SACCO,
  'Giocatori/Ilde.md': PC_LEVEL_3('ilde-varno', 'Ilde Varno'),
  'Giocatori/Sani.md': PC_LEVEL_3('sani-lorn', 'Sani Lorn'),
  'Trama/Sessione 1/Eventi/Scontro al ponte.md': SCONTRO,
  'Trama/Sessione 2/Eventi/Agguato al guado.md': AGGUATO,
};

/** A temporary campaign with the given adapter and files (the defaults are BASE). */
function makeCampaign(t, { adapter = 'dnd-2024', files = BASE } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-encounters-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), campaignYaml(adapter));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const withoutPlayers = Object.fromEntries(Object.entries(BASE).filter(([rel]) => !rel.startsWith('Giocatori/')));

test('an event with four guardians of CR 1/2 is rated against two level 3 characters', async (t) => {
  const result = await runEncounters(makeCampaign(t), ['sessione-1']);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.party, [3, 3]);
  assert.equal(result.rated, true);
  assert.deepEqual(result.results, [
    {
      event: 'scontro-al-ponte',
      file: 'Trama/Sessione 1/Eventi/Scontro al ponte.md',
      session: 'sessione-1',
      enemies: [{ id: 'guardiano-di-sale', title: 'Guardiano di sale', count: 4, cr: '1/2' }],
      xp: 400,
      band: 'moderate',
      budgets: { low: 300, moderate: 450, high: 800 },
      problem: null,
    },
  ]);
});

test('the whole campaign lists every fight sorted by session then event id', async (t) => {
  const result = await runEncounters(makeCampaign(t));
  assert.deepEqual(result.results.map((entry) => [entry.session, entry.event]), [
    ['sessione-1', 'scontro-al-ponte'],
    ['sessione-2', 'agguato-al-guado'],
  ]);
  assert.equal(result.rated, true);
});

test('a session argument keeps only the events of that session', async (t) => {
  const result = await runEncounters(makeCampaign(t), ['sessione-2']);
  assert.deepEqual(result.results.map((entry) => entry.event), ['agguato-al-guado']);
});

test('an enemy sheet without GS gives problem no-cr and no rating', async (t) => {
  const result = await runEncounters(makeCampaign(t), ['sessione-2']);
  assert.deepEqual(result.results[0].enemies, [{ id: 'sacco-di-sale', title: 'Sacco di sale', count: 1, cr: null }]);
  assert.equal(result.results[0].problem, 'no-cr');
  assert.equal(result.results[0].xp, null);
  assert.equal(result.results[0].band, null);
  assert.equal(result.results[0].budgets, null);
  assert.equal(result.rated, false, 'no entry of the session is rated');
});

test('a campaign without player characters gives problem no-party', async (t) => {
  const result = await runEncounters(makeCampaign(t, { files: withoutPlayers }), ['sessione-1']);
  assert.deepEqual(result.party, []);
  assert.equal(result.rated, false);
  assert.equal(result.results[0].problem, 'no-party');
  assert.equal(result.results[0].xp, null);
});

test('a campaign with no adapter gives problem no-difficulty-rules', async (t) => {
  const result = await runEncounters(makeCampaign(t, { adapter: 'none' }), ['sessione-1']);
  assert.deepEqual(result.party, [3, 3]);
  assert.equal(result.rated, false);
  assert.equal(result.results[0].problem, 'no-difficulty-rules');
  assert.equal(result.results[0].enemies[0].cr, null);
});

test('more than one argument is an error', async (t) => {
  const result = await runEncounters(makeCampaign(t), ['a', 'b']);
  assert.equal(typeof result.error, 'string');
  assert.equal(result.results, undefined);
});
