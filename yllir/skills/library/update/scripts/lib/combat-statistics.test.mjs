import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completeCombatSheets, prepareCombatStatistics, refreshChangedSheet, stageCombatDraft, verifyCombatDrafts } from './combat-statistics.mjs';

const roots = [];
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

const FILE = 'Personaggi/Locandiera Anna.md';
const ENEMY = 'Personaggi/Guardia del cancello.md';
const COMPLIANT = 'Personaggi/Mastro Oreste.md';
const SKETCH = 'Personaggi/Bozza.md';

const NPC = `<!-- yllir
id: locandiera-anna
template: npc
provenance: master
location: []
-->

# Locandiera Anna

## Ruolo

Gestisce la locanda del villaggio.

## Aspetto e modi

Mani callose, voce ferma.

## Al tavolo

Parla poco e vuole sapere chi paga.

<!-- master -->
## Master

### Indicazioni per il master

Nasconde un debito.
<!-- /master -->
`;

const NPC_FIXED_TABLES = `## Statistiche

### Caratteristiche

| Caratteristica | Valore |
| --- | --- |
| CA | 10 |
| PF | 9 |

### Attacchi e capacità

| Attacco o capacità | Dettagli |
| --- | --- |
| Colpo disarmato | Attacco in mischia: +2. Colpisce: 1d4 danni contundenti. |

`;

const ENEMY_TEXT = `<!-- yllir
id: guardia-cancello
template: enemy
provenance: master
location: []
-->

# Guardia del cancello

## Natura

Un soldato stanco che sorveglia il cancello.

## Statistiche

### Caratteristiche

| Caratteristica | Valore |
| --- | --- |
| CA | 13 |
| PF | 11 (2d8 + 2) |

### Attacchi e capacità

| Attacco o capacità | Dettagli |
| --- | --- |
| Lancia | Attacco in mischia: +3. Colpisce: 4 (1d6 + 1) danni perforanti. |
`;

const COMPLIANT_TEXT = `<!-- yllir
id: mastro-oreste
template: npc
provenance: master
location: []
-->

# Mastro Oreste

## Ruolo

Fabbro del villaggio.

## Aspetto e modi

Grosso e silenzioso.

## Al tavolo

Parla solo di ferro.

## Statistiche

### Attacchi e capacità

| Attacco o capacità | Dettagli |
| --- | --- |
| Martello | Attacco in mischia: +4. Colpisce: 1d8 + 2 danni contundenti. |
`;

const SKETCH_TEXT = `<!-- yllir
id: bozza
template: npc
sketch: true
provenance: master
location: []
-->

# Bozza

## Ruolo

Una frase soltanto.
`;

function campaign({ files = { [FILE]: NPC }, adapter = 'dnd-2024' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-combat-statistics-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'Personaggi'), { recursive: true });
  fs.writeFileSync(path.join(root, 'campaign.yaml'), [
    'schema: 1', 'campaign:', '  name: "Test"', 'language:', '  main: it', 'system:', `  adapter: ${adapter}`,
    'structure:', '  - id: personaggi', '    folder: Personaggi', '    type: subjects', '',
  ].join('\n'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text);
  return root;
}

function writeDraft(root, file, text) {
  const dest = path.join(root, '.campaign/state/write/draft', file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
}

/** The npc with a valid Statistics section inserted before the master block. */
function withStatistics(text, section = NPC_FIXED_TABLES) {
  return text.replace('<!-- master -->', `${section}<!-- master -->`);
}

test('an npc without statistics is listed as pending, needing actions, with no rolls', async () => {
  const root = campaign();
  const result = await prepareCombatStatistics(root);
  assert.equal(result.status, 'pending');
  assert.equal(result.sheets.length, 1);
  assert.equal(result.sheets[0].file, FILE);
  assert.equal(result.sheets[0].status, 'pending');
  assert.equal(result.sheets[0].needs_actions, true);
  assert.equal(result.sheets[0].rolls, 0);
  assert.equal(result.sheets[0].auto_draft, undefined);
});

test('an enemy with a precomputed roll gets an automatic draft with dice only, and verifies', async () => {
  const root = campaign({ files: { [ENEMY]: ENEMY_TEXT } });
  const result = await prepareCombatStatistics(root);
  assert.equal(result.status, 'pending');
  const record = result.sheets[0];
  assert.equal(record.file, ENEMY);
  assert.equal(record.rolls, 1);
  assert.equal(record.needs_actions, false);
  assert.equal(record.auto_draft, true);

  const draft = fs.readFileSync(path.join(root, '.campaign/state/write/draft', ENEMY), 'utf8');
  assert.ok(draft.includes('Colpisce: 1d6 + 1 danni perforanti.'), draft);
  assert.ok(!draft.includes('4 (1d6 + 1)'));
  assert.ok(draft.includes('| PF | 11 (2d8 + 2) |'));

  assert.deepEqual(await verifyCombatDrafts(root, [ENEMY]), { status: 'verified', errors: [] });
});

test('a compliant npc and a sketch are not listed', async () => {
  const root = campaign({ files: { [COMPLIANT]: COMPLIANT_TEXT, [SKETCH]: SKETCH_TEXT } });
  const result = await prepareCombatStatistics(root);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.sheets, []);
});

test('verify accepts a valid Statistics section and refuses the wrong drafts', async () => {
  const root = campaign();
  await prepareCombatStatistics(root);

  // A valid section after Al tavolo.
  let staged = await stageCombatDraft(root, FILE, withStatistics(NPC));
  assert.equal(staged.status, 'staged');
  assert.deepEqual(await verifyCombatDrafts(root, [FILE]), { status: 'verified', errors: [] });

  // A word changed in Ruolo.
  assert.equal((await stageCombatDraft(root, FILE, withStatistics(NPC).replace('Gestisce la locanda', 'Dirige la locanda'))).status, 'staged');
  assert.ok((await verifyCombatDrafts(root, [FILE])).errors.some((e) => e.code === 'outside-changed'));

  // The actions table without a row.
  const noRow = withStatistics(NPC, NPC_FIXED_TABLES.replace('| Colpo disarmato | Attacco in mischia: +2. Colpisce: 1d4 danni contundenti. |\n', ''));
  assert.equal((await stageCombatDraft(root, FILE, noRow)).status, 'staged');
  assert.deepEqual((await verifyCombatDrafts(root, [FILE])).errors.map((e) => e.code), ['actions-missing']);

  // The master-only block changed.
  assert.equal((await stageCombatDraft(root, FILE, withStatistics(NPC).replace('Nasconde un debito.', 'Nasconde altro.'))).status, 'staged');
  assert.ok((await verifyCombatDrafts(root, [FILE])).errors.some((e) => e.code === 'master-block-changed'));
});

test('complete needs the published bytes to match the verified draft and no problem left', async () => {
  const root = campaign();
  await prepareCombatStatistics(root);
  const draft = withStatistics(NPC);
  await stageCombatDraft(root, FILE, draft);
  assert.equal((await verifyCombatDrafts(root, [FILE])).status, 'verified');

  fs.writeFileSync(path.join(root, FILE), draft);
  const done = await completeCombatSheets(root, [FILE]);
  assert.equal(done.status, 'complete');
  assert.equal((await prepareCombatStatistics(root)).status, 'complete');
});

test('complete refuses a published text that differs from the verified draft', async () => {
  const root = campaign();
  await prepareCombatStatistics(root);
  const draft = withStatistics(NPC);
  await stageCombatDraft(root, FILE, draft);
  assert.equal((await verifyCombatDrafts(root, [FILE])).status, 'verified');

  fs.writeFileSync(path.join(root, FILE), `${draft}\nUn'aggiunta.\n`);
  const wrong = await completeCombatSheets(root, [FILE]);
  assert.equal(wrong.status, 'pending');
  assert.equal(wrong.errors[0].code, 'unverified-publication');
});

test('a sheet changed after prepare is reported as changed, and refresh reopens it as pending', async () => {
  const root = campaign();
  await prepareCombatStatistics(root);
  // A complete record of the earlier text, then the master edits the sheet.
  fs.mkdirSync(path.join(root, '.campaign/state/update'), { recursive: true });
  fs.writeFileSync(path.join(root, '.campaign/state/update/combat-statistics.json'), JSON.stringify({ sheets: [{ file: FILE, source: 'old', status: 'complete' }] }));
  fs.writeFileSync(path.join(root, FILE), `${NPC}\nModifica del master.\n`);

  const prepared = await prepareCombatStatistics(root);
  assert.equal(prepared.sheets[0].status, 'changed');
  assert.equal(prepared.status, 'pending');

  writeDraft(root, FILE, 'stale');
  const refreshed = await refreshChangedSheet(root, FILE);
  assert.equal(refreshed.status, 'pending');
  assert.equal(refreshed.needs_actions, true);
  assert.equal(fs.existsSync(path.join(root, '.campaign/state/write/draft', FILE)), false);
  assert.equal((await prepareCombatStatistics(root)).sheets[0].status, 'pending');
  assert.equal((await refreshChangedSheet(root, FILE)).errors[0].code, 'sheet-not-changed');
});
