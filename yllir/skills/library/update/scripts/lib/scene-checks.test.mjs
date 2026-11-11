import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completeScenes, prepareSceneChecks, refreshChangedScene, stageSceneDraft, verifySceneDrafts } from './scene-checks.mjs';

const roots = [];
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

const META = '<!-- yllir\nid: scene-one\nprovenance: master\nsession: s1\ndepends_on: []\nlocation: []\n-->';
const FILE = 'Trama/Sessione 1/Eventi/Scena.md';

const OLD = `${META}

Il gruppo arriva.

### Controllo di cortesia (difficoltà da definire)
- **Successo:** il gruppo ottiene un consiglio sulla strada.
- **Fallimento:** il gruppo riceve soltanto un invito.

<!-- master -->
Nota segreta.
<!-- /master -->
`;

const CONVERTED = `${META}

Il gruppo arriva.

### Prova: cortesia (difficoltà da definire)

#### Successo

Il gruppo ottiene un consiglio sulla strada.

#### Fallimento

Il gruppo riceve soltanto un invito.

<!-- master -->
Nota segreta.
<!-- /master -->
`;

function campaign({ scene = OLD, lang = 'it', adapter = 'none', file = FILE, extra = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-scene-checks-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'Trama/Sessione 1/Eventi'), { recursive: true });
  fs.writeFileSync(path.join(root, 'campaign.yaml'), [
    'schema: 1', 'campaign:', '  name: "Test"', 'language:', `  main: ${lang}`, 'system:', `  adapter: ${adapter}`,
    'structure:', '  - id: trama', '    folder: Trama', '    type: plot', '',
  ].join('\n'));
  if (scene !== null) fs.writeFileSync(path.join(root, file), scene);
  for (const [name, text] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

test('an old-form scene is listed as pending with the errors of the new form', async () => {
  const root = campaign();
  const result = await prepareSceneChecks(root);
  assert.equal(result.status, 'pending');
  assert.equal(result.scenes.length, 1);
  assert.equal(result.scenes[0].file, FILE);
  assert.equal(result.scenes[0].status, 'pending');
  assert.ok(result.scenes[0].errors.some((e) => /^line \d+ check-heading-form: /.test(e)), JSON.stringify(result.scenes[0].errors));
  assert.ok(result.scenes[0].errors.some((e) => /^line \d+ check-legacy-outcomes: /.test(e)));
});

test('a scene already in the new form is not listed and the inventory is complete', async () => {
  const root = campaign({ scene: CONVERTED });
  const result = await prepareSceneChecks(root);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.scenes, []);
});

test('the session main file is not an event file', async () => {
  const root = campaign({ scene: CONVERTED, extra: { 'Trama/Sessione 1/Sessione 1.md': OLD } });
  const result = await prepareSceneChecks(root);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.scenes, []);
});

test('stage refuses a draft that changes the metadata block', async () => {
  const root = campaign();
  await prepareSceneChecks(root);
  const changed = CONVERTED.replace('id: scene-one', 'id: other');
  const result = await stageSceneDraft(root, FILE, changed);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors[0].code, 'head-changed');
});

test('stage refuses a scene that is not pending', async () => {
  const root = campaign({ scene: CONVERTED });
  await prepareSceneChecks(root);
  assert.equal((await stageSceneDraft(root, FILE, CONVERTED)).errors[0].code, 'source-changed');
});

test('verify fails while the old form remains', async () => {
  const root = campaign();
  await prepareSceneChecks(root);
  await stageSceneDraft(root, FILE, OLD);
  const result = await verifySceneDrafts(root, [FILE]);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors[0].code, 'scene-checks-remain');
  assert.ok(Array.isArray(result.errors[0].detail) && result.errors[0].detail.length > 0);
});

test('verify fails when an outcome text of the old list is lost', async () => {
  const root = campaign();
  await prepareSceneChecks(root);
  await stageSceneDraft(root, FILE, CONVERTED.replace('Il gruppo ottiene un consiglio sulla strada.', 'Il gruppo ottiene un aiuto.'));
  const result = await verifySceneDrafts(root, [FILE]);
  assert.deepEqual(result.errors.map((e) => e.code), ['outcome-text-lost']);
  assert.equal(result.errors[0].detail, 'il gruppo ottiene un consiglio sulla strada');
});

test('verify fails when the master-only block changes', async () => {
  const root = campaign();
  await prepareSceneChecks(root);
  await stageSceneDraft(root, FILE, CONVERTED.replace('Nota segreta.', 'Nota cambiata.'));
  const result = await verifySceneDrafts(root, [FILE]);
  assert.deepEqual(result.errors.map((e) => e.code), ['master-block-changed']);
});

test('verify passes on a correct conversion and complete needs the published bytes to match', async () => {
  const root = campaign();
  await prepareSceneChecks(root);
  assert.equal((await stageSceneDraft(root, FILE, CONVERTED)).status, 'staged');
  assert.equal((await verifySceneDrafts(root, [FILE])).status, 'verified');

  fs.writeFileSync(path.join(root, FILE), `${CONVERTED}\nUn'aggiunta.\n`);
  const wrong = await completeScenes(root, [FILE]);
  assert.equal(wrong.status, 'pending');
  assert.equal(wrong.errors[0].code, 'unverified-publication');

  fs.writeFileSync(path.join(root, FILE), CONVERTED);
  const done = await completeScenes(root, [FILE]);
  assert.equal(done.status, 'complete');
  assert.equal((await prepareSceneChecks(root)).status, 'complete');
});

test('a dnd-2024 campaign rejects a check value without ability and accepts the full form', async () => {
  const root = campaign({ adapter: 'dnd-2024' });
  await prepareSceneChecks(root);
  await stageSceneDraft(root, FILE, CONVERTED.replace('### Prova: cortesia (difficoltà da definire)', '### Prova: Persuasione CD 13'));
  const rejected = await verifySceneDrafts(root, [FILE]);
  assert.equal(rejected.status, 'failed');
  assert.ok(rejected.errors.some((e) => e.code === 'scene-checks-remain'));

  await stageSceneDraft(root, FILE, CONVERTED.replace('### Prova: cortesia (difficoltà da definire)', '### Prova: Carisma (Persuasione) CD 13'));
  assert.equal((await verifySceneDrafts(root, [FILE])).status, 'verified');
});

test('a changed scene is reopened as pending by refresh, with its draft dropped and its errors recomputed', async () => {
  const root = campaign({ scene: CONVERTED });
  assert.equal((await prepareSceneChecks(root)).status, 'complete');
  // The scene is completed on a previous run, then the master edits it.
  const state = { scenes: [{ file: FILE, source: 'old', status: 'complete' }] };
  fs.mkdirSync(path.join(root, '.campaign/state/update'), { recursive: true });
  fs.writeFileSync(path.join(root, '.campaign/state/update/scene-checks.json'), JSON.stringify(state));
  const edited = `${CONVERTED}\nModifica del master.\n`;
  fs.writeFileSync(path.join(root, FILE), edited);
  const prepared = await prepareSceneChecks(root);
  assert.equal(prepared.scenes[0].status, 'changed');
  assert.equal(prepared.status, 'pending');

  fs.mkdirSync(path.join(root, '.campaign/state/write/draft/Trama/Sessione 1/Eventi'), { recursive: true });
  fs.writeFileSync(path.join(root, '.campaign/state/write/draft', FILE), 'stale');
  const refreshed = await refreshChangedScene(root, FILE);
  assert.equal(refreshed.status, 'pending');
  assert.equal(fs.existsSync(path.join(root, '.campaign/state/write/draft', FILE)), false);
  const again = await prepareSceneChecks(root);
  assert.equal(again.scenes[0].status, 'pending');
  assert.equal(await refreshChangedScene(root, FILE).then((r) => r.errors[0].code), 'scene-not-changed');
});

test('refresh refuses a scene that is not changed', async () => {
  const root = campaign();
  await prepareSceneChecks(root);
  assert.equal((await refreshChangedScene(root, FILE)).errors[0].code, 'scene-not-changed');
});
