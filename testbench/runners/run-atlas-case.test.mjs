// Offline tests of the atlas case runner: the cases and keys load, the setups build a valid atlas through
// the atlas CLI, and the graders pass a hand-made correct result and fail the seeded traps. No model runs:
// the bad folders are made by editing a setup copy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './lib/case-common.mjs';
import {
  atlasNames,
  endsWithQuestion,
  forbiddenIn,
  gradeAtlasRun,
  loadCase,
  setupCopy,
  sheetTitles,
  validateKey,
} from './run-atlas-case.mjs';
import { readAtlas, validateAtlas } from '../../yllir/skills/library/atlas/scripts/lib/model.mjs';
import { buildWorldIndex } from '../../yllir/scripts/lib/world-graph.mjs';
import { listVersions, saveVersion } from '../../yllir/scripts/lib/versions.mjs';

const CASES = path.join(REPO_ROOT, 'testbench', 'cases', 'atlas');
const FIXTURE = path.join(REPO_ROOT, 'testbench', 'fixtures', 'atlas-morvalle', 'campaign');
const URBAN_FIXTURE = path.join(REPO_ROOT, 'testbench', 'fixtures', 'atlas-ostrava-town', 'campaign');
const ATLAS_CLI = path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'atlas', 'scripts', 'atlas.mjs');
const NAMES = [
  'create-asks',
  'update-keeps-land',
  'players-no-secrets',
  'urban-scale',
  'urban-building-placed',
  'urban-players-no-secrets',
];
const SECRET_SENTENCE = "Sotto l'altare di San Ottavio dorme il sigillo di Bornago, nella cripta chiamata Sala Nera.";
const GOOD_ANSWER = 'I documenti non dicono dove si trova il Lago Grigio rispetto alla piazza. Il lago è a nord o a sud del borgo?';

const kept = [];
function setup(setupName) {
  const made = setupCopy({ fixtureDir: FIXTURE, setup: setupName });
  kept.push(made.tmp);
  return made;
}
test.after(() => {
  for (const tmp of kept) fs.rmSync(tmp, { recursive: true, force: true });
});

function caseOf(name) {
  return loadCase(path.join(CASES, name));
}

/** Adds the sheet of Riva Storta and its place at the given point, through the atlas CLI (a refused write throws). */
function addRiva(copy, at) {
  fs.mkdirSync(path.join(copy, 'Mondo', 'Morvalle'), { recursive: true });
  fs.writeFileSync(
    path.join(copy, 'Mondo', 'Morvalle', 'Riva Storta.md'),
    '---\nid: riva-storta\nkind: place\nprovenance: master\n---\n# Riva Storta\n\n## Descrizione\n\n_Un villaggio di pescatori._\n\nLe case si affacciano sulla riva.\n',
  );
  const atlas = readAtlas(copy);
  const features = [
    ...atlas.layers.places.features,
    { id: 'riva-storta', place: 'riva-storta', at, icon: 'village', provenance: 'agent-choice', visibility: 'public', sources: [] },
  ];
  const file = path.join(path.dirname(copy), 'places-with-riva.json');
  fs.writeFileSync(file, JSON.stringify({ layer: 'places', constraints: [], features }, null, 2));
  writeLayerCli(copy, 'places', file);
  return file;
}

/** Writes a layer candidate through the atlas CLI (write-layer takes the root, the layer and the file). */
function writeLayerCli(copy, layer, file) {
  return execFileSync(process.execPath, [ATLAS_CLI, 'write-layer', copy, layer, file], { encoding: 'utf8' });
}

test('the three atlas cases and their keys load with the setups and limits', () => {
  const create = caseOf('create-asks');
  assert.equal(create.setup, 'none');
  assert.deepEqual(create.limits, { max_minutes: 6, max_tool_calls: 120 });
  assert.deepEqual(create.key.forbidden_words, ['script', 'JSON', 'seed', 'canvas', 'hash', 'lock', 'constraint']);
  const update = caseOf('update-keeps-land');
  assert.equal(update.setup, 'land');
  assert.deepEqual(update.limits, { max_minutes: 8, max_tool_calls: 160 });
  assert.equal(update.key.new_title, 'Riva Storta');
  const players = caseOf('players-no-secrets');
  assert.equal(players.setup, 'land');
  assert.deepEqual(players.limits, { max_minutes: 4, max_tool_calls: 60 });
  assert.equal(players.key.refuge_title, 'Rifugio dei Contrabbandieri');
  for (const name of NAMES) assert.ok(fs.existsSync(path.join(CASES, name, 'key.yaml')));
});

test('the fixture holds the traps: two wells named alike, a hidden refuge, no direction for the well of Narem', () => {
  const titles = sheetTitles(FIXTURE);
  assert.ok(titles.has('Pozzo Vecchio'));
  assert.ok(titles.has('Valdaspra'));
  assert.ok(titles.has('Rifugio dei Contrabbandieri'));
  const refuge = fs.readFileSync(path.join(FIXTURE, 'Mondo', 'Morvalle', 'Rifugio dei Contrabbandieri.md'), 'utf8');
  assert.match(refuge, /^public: false$/m);
  const narem = fs.readFileSync(path.join(FIXTURE, 'Mondo', 'Morvalle', 'Pozzo di Nàrem.md'), 'utf8');
  assert.doesNotMatch(narem, /versante/);
  const valdaspra = fs.readFileSync(path.join(FIXTURE, 'Mondo', 'Valdaspra', 'Valdaspra.md'), 'utf8');
  assert.ok(valdaspra.includes('a ovest di Morvalle, oltre le colline'));
});

test('setup none gives the fixture as a git repository with one version and no atlas', () => {
  const made = setup('none');
  assert.equal(made.baseline, null);
  assert.equal(listVersions(made.copy, { limit: 500 }).length, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(made.copy, 'campaign.yaml'), 'utf8'), /type: atlas/);
});

test('setup land builds a valid atlas: locked terrain, nine places, a master site and two versions', () => {
  const made = setup('land');
  const atlas = readAtlas(made.copy);
  const problems = validateAtlas(made.copy, atlas, { worldIndex: buildWorldIndex(made.copy) });
  assert.deepEqual(problems, []);
  assert.equal(atlas.manifest.layers.terrain.locked, true);
  assert.equal(atlas.layers.places.features.length, 9);
  assert.ok(fs.existsSync(path.join(made.copy, '.campaign', 'cache', 'atlas', 'master', 'index.html')));
  assert.equal(made.baseline.versions, 2);
  assert.equal(listVersions(made.copy, { limit: 500 }).length, 2);
});

test('the create-asks grader passes a good answer on a campaign with no atlas', () => {
  const made = setup('none');
  const key = caseOf('create-asks').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: GOOD_ANSWER, baseline: null, fixtureDir: FIXTURE });
  assert.equal(graded.pass, true, graded.failures.join('; '));
  assert.deepEqual(Object.keys(graded.checks), ['A1', 'A2', 'A3', 'A4']);
});

test('the create-asks grader fails A2 on a locked terrain', () => {
  const made = setup('land');
  const key = caseOf('create-asks').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: GOOD_ANSWER, baseline: null, fixtureDir: FIXTURE });
  assert.equal(graded.checks.A2, false);
  assert.equal(graded.checks.A1, true);
  assert.equal(graded.pass, false);
});

test('the create-asks grader fails A3 on a label text that is no sheet title', () => {
  const made = setup('init');
  const folder = path.join(made.copy, 'Atlante');
  fs.writeFileSync(
    path.join(folder, 'labels.json'),
    JSON.stringify({ layer: 'labels', constraints: [], features: [{ id: 'mare', target: 'terrain/valle', text: 'Mare Grigio' }] }),
  );
  assert.ok(atlasNames(made.copy).includes('Mare Grigio'));
  const key = caseOf('create-asks').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: GOOD_ANSWER, baseline: null, fixtureDir: FIXTURE });
  assert.equal(graded.checks.A3, false);
  assert.equal(graded.checks.A2, true);
});

test('the create-asks grader fails A1 and A4 on a statement and on a forbidden word', () => {
  const made = setup('none');
  const key = caseOf('create-asks').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: 'Ho creato il lock del canvas.', baseline: null, fixtureDir: FIXTURE });
  assert.equal(graded.checks.A1, false);
  assert.equal(graded.checks.A4, false);
  assert.equal(graded.checks.A2, true);
});

test('the update grader passes when Riva Storta is placed south of the lake and a version is saved', () => {
  const made = setup('land');
  addRiva(made.copy, [2000, 2250]);
  saveVersion(made.copy, { message: 'Riva Storta aggiunta.', kind: 'framework' });
  const key = caseOf('update-keeps-land').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: 'Ecco fatto.', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.equal(graded.pass, true, graded.failures.join('; '));
  assert.deepEqual(graded.checks, { U1: true, U2: true, U3: true, U4: true });
});

test('the update grader fails U3 when Riva Storta is north of the lake, and passes a question instead', () => {
  const made = setup('land');
  addRiva(made.copy, [1700, 1500]);
  saveVersion(made.copy, { message: 'Riva Storta aggiunta.', kind: 'framework' });
  const key = caseOf('update-keeps-land').key;
  const placed = gradeAtlasRun({ key, copy: made.copy, report: 'Ecco fatto.', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.equal(placed.checks.U3, false);
  // The same copy with the place taken out of the places layer and a question asked: U3 passes.
  const atlas = readAtlas(made.copy);
  const file = path.join(path.dirname(made.copy), 'places-without-riva.json');
  fs.writeFileSync(file, JSON.stringify({ layer: 'places', constraints: [], features: atlas.layers.places.features.filter((f) => f.id !== 'riva-storta') }));
  writeLayerCli(made.copy, 'places', file);
  const asked = gradeAtlasRun({
    key,
    copy: made.copy,
    report: 'I documenti non dicono se Riva Storta è a sud o a est del lago. Quale delle due?',
    baseline: made.baseline,
    fixtureDir: FIXTURE,
  });
  assert.equal(asked.checks.U3, true);
});

test('the update grader fails U2 on a changed vertex of the locked terrain', () => {
  const made = setup('land');
  const file = path.join(made.copy, 'Atlante', 'terrain.json');
  const terrain = JSON.parse(fs.readFileSync(file, 'utf8'));
  const land = terrain.features.find((f) => f.type === 'land');
  land.polygon[0][0] += 50;
  fs.writeFileSync(file, JSON.stringify(terrain, null, 2));
  const key = caseOf('update-keeps-land').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: 'Ecco fatto.', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.equal(graded.checks.U2, false);
  assert.ok(graded.failures.some((line) => line.startsWith('U2 ')));
});

test('the update grader fails U4 when no version was saved after the setup', () => {
  const made = setup('land');
  addRiva(made.copy, [2000, 2250]);
  const key = caseOf('update-keeps-land').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: 'Ecco fatto.', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.equal(graded.checks.U4, false);
});

test('the players grader passes a players version with both wells and no hidden refuge', () => {
  const made = setup('land');
  execFileSync(process.execPath, [ATLAS_CLI, 'render', made.copy, '--audience', 'players'], { encoding: 'utf8' });
  const key = caseOf('players-no-secrets').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: 'Ecco.', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.equal(graded.pass, true, graded.failures.join('; '));
  assert.deepEqual(graded.checks, { P1: true, P2: true, P3: true, P4: true });
});

test('the players grader fails P2 when the refuge title is in the players version', () => {
  const made = setup('land');
  execFileSync(process.execPath, [ATLAS_CLI, 'render', made.copy, '--audience', 'players'], { encoding: 'utf8' });
  const html = path.join(made.copy, '.campaign', 'cache', 'atlas', 'players', 'index.html');
  fs.appendFileSync(html, '<p>Rifugio dei Contrabbandieri</p>\n');
  const key = caseOf('players-no-secrets').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: 'Ecco.', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.equal(graded.checks.P2, false);
  assert.equal(graded.checks.P3, true);
});

test('a run whose agent did not finish fails without checks', () => {
  const key = caseOf('create-asks').key;
  const graded = gradeAtlasRun({ key, copy: FIXTURE, report: null, baseline: null, fixtureDir: FIXTURE, agentError: 'timeout' });
  assert.equal(graded.pass, false);
  assert.deepEqual(graded.checks, {});
  assert.deepEqual(graded.failures, ['agent: timeout']);
});

test('the helpers: a question ends the text, and forbidden words match as whole words', () => {
  assert.equal(endsWithQuestion('Quale strada?  '), true);
  assert.equal(endsWithQuestion('Ecco.'), false);
  assert.equal(endsWithQuestion(null), false);
  assert.deepEqual(forbiddenIn('Il locked è un lock.', ['lock', 'seed']), ['lock']);
  assert.deepEqual(forbiddenIn('Il seme della valle.', ['seed']), []);
});

// ---------------------------------------------------------------- urban cases

/** A setup copy of the urban fixture (no atlas yet), kept for the cleanup. */
function setupUrban() {
  const made = setupCopy({ fixtureDir: URBAN_FIXTURE, setup: 'none' });
  kept.push(made.tmp);
  return made;
}

/** Builds an atlas of the given scope through the atlas CLI init (a refused init throws). */
function initScope(copy, scope) {
  const file = path.join(path.dirname(copy), `scope-${scope.kind}.json`);
  fs.writeFileSync(file, JSON.stringify({ scope }));
  execFileSync(process.execPath, [ATLAS_CLI, 'init', copy, file], { encoding: 'utf8' });
}

/** Writes an atlas layer file directly (the grader reads the files; no write rule applies to the fake). */
function writeAtlasFile(copy, fileName, value) {
  const dir = path.join(copy, 'Atlante');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify(value, null, 2));
}

const SETTLEMENT = { kind: 'settlement', places: ['il-gatto-borgo-vecchio'], note: 'Il borgo di Bornago.' };
const TAVERN = (id, kind = 'tavern') => ({
  id, place: id, at: [300, 300], kind, provenance: 'agent-choice', visibility: 'public', sources: [],
});

test('validateKey accepts the urban kinds and their fields, and refuses a missing or mistyped one', () => {
  assert.equal(caseOf('urban-building-placed').key.kind, 'urban-building');
  assert.equal(caseOf('urban-players-no-secrets').key.kind, 'urban-players');
  assert.equal(caseOf('urban-scale').key.expect_scope_kind, 'settlement');
  assert.deepEqual(caseOf('urban-scale').key.forbidden_layer_files.length, 7);
  const building = { kind: 'urban-building', place_id: 'a', homonym_id: 'b', building_kind: 'tavern', validate_problem: 'building-not-on-block' };
  assert.equal(validateKey(building), building);
  assert.throws(() => validateKey({ ...building, validate_problem: undefined }), /validate_problem missing/);
  assert.throws(() => validateKey({ kind: 'urban-players', secret_sentence: 'x' }), /master_building_ids missing/);
  assert.throws(() => validateKey({ kind: 'urban-players', secret_sentence: 'x', master_building_ids: 'rocca' }), /must be a list/);
  assert.throws(() => validateKey({ kind: 'create-asks', forbidden_words: [], expect_scope_kind: 5 }), /must be a string/);
  assert.throws(() => validateKey({ kind: 'create-asks', forbidden_words: [], forbidden_layer_files: 'terrain.json' }), /must be a list/);
  assert.throws(() => validateKey({ kind: 'nope' }), /kind must be one of/);
});

test('every atlas case loads with its key, the urban ones included', () => {
  for (const name of NAMES) assert.ok(loadCase(path.join(CASES, name)).key.kind, name);
});

test('A5 and A6 are graded only when the key sets them, and pass trivially with no atlas', () => {
  const made = setupUrban();
  const key = caseOf('urban-scale').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: GOOD_ANSWER, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.deepEqual(Object.keys(graded.checks), ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
  assert.equal(graded.checks.A5, true);
  assert.equal(graded.checks.A6, true);
  assert.equal(graded.pass, true, graded.failures.join('; '));
});

test('A5 passes a settlement manifest and fails a region one', () => {
  const settlement = setupUrban();
  initScope(settlement.copy, SETTLEMENT);
  const key = caseOf('urban-scale').key;
  const good = gradeAtlasRun({ key, copy: settlement.copy, report: GOOD_ANSWER, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.equal(good.checks.A5, true);
  const region = setup('land');
  const bad = gradeAtlasRun({ key, copy: region.copy, report: GOOD_ANSWER, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.equal(bad.checks.A5, false);
  assert.ok(bad.failures.some((line) => line.startsWith('A5 ')));
});

test('A6 fails on a forbidden layer file of a settlement atlas and passes without it', () => {
  const made = setupUrban();
  initScope(made.copy, SETTLEMENT);
  const key = caseOf('urban-scale').key;
  const clean = gradeAtlasRun({ key, copy: made.copy, report: GOOD_ANSWER, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.equal(clean.checks.A6, true);
  writeAtlasFile(made.copy, 'places.json', { layer: 'places', constraints: [], features: [] });
  const seeded = gradeAtlasRun({ key, copy: made.copy, report: GOOD_ANSWER, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.equal(seeded.checks.A6, false);
  assert.equal(seeded.checks.A5, true);
  assert.ok(seeded.failures.some((line) => line.includes('places.json')));
});

test('urban-building: B1 and B2 pass when the tavern of Borgo Vecchio is placed on its own', () => {
  const made = setupUrban();
  initScope(made.copy, SETTLEMENT);
  writeAtlasFile(made.copy, 'buildings.json', { layer: 'buildings', constraints: [], features: [TAVERN('il-gatto-borgo-vecchio')] });
  const key = caseOf('urban-building-placed').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: null, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.equal(graded.pass, true, graded.failures.join('; '));
  assert.deepEqual(graded.checks, { B1: true, B2: true });
});

test('urban-building: B1 fails when the homonym of Porto is placed, or the kind is wrong', () => {
  const key = caseOf('urban-building-placed').key;
  const homonym = setupUrban();
  initScope(homonym.copy, SETTLEMENT);
  writeAtlasFile(homonym.copy, 'buildings.json', { layer: 'buildings', constraints: [], features: [TAVERN('il-gatto-porto')] });
  const wrongPlace = gradeAtlasRun({ key, copy: homonym.copy, report: null, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.equal(wrongPlace.checks.B1, false);
  assert.ok(wrongPlace.failures.some((line) => line.startsWith('B1 ')));

  const wrongKind = setupUrban();
  initScope(wrongKind.copy, SETTLEMENT);
  writeAtlasFile(wrongKind.copy, 'buildings.json', { layer: 'buildings', constraints: [], features: [TAVERN('il-gatto-borgo-vecchio', 'inn')] });
  const kindGraded = gradeAtlasRun({ key, copy: wrongKind.copy, report: null, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.equal(kindGraded.checks.B1, false);
});

test('urban-building: B2 fails when the tavern stands off every block, and B1 and B2 fail with no buildings layer', () => {
  const key = caseOf('urban-building-placed').key;
  const off = setupUrban();
  initScope(off.copy, SETTLEMENT);
  writeAtlasFile(off.copy, 'buildings.json', { layer: 'buildings', constraints: [], features: [TAVERN('il-gatto-borgo-vecchio')] });
  writeAtlasFile(off.copy, 'blocks.json', {
    layer: 'blocks',
    constraints: [],
    features: [{
      id: 'blocco-lontano',
      type: 'block',
      polygon: [[1000, 1000], [1100, 1000], [1100, 1100], [1000, 1100]],
      character: 'common',
      lots: [],
      visibility: 'public',
      provenance: 'agent-choice',
      sources: [],
    }],
  });
  const graded = gradeAtlasRun({ key, copy: off.copy, report: null, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.equal(graded.checks.B1, true);
  assert.equal(graded.checks.B2, false);

  const none = setupUrban();
  initScope(none.copy, SETTLEMENT);
  const empty = gradeAtlasRun({ key, copy: none.copy, report: null, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.deepEqual(empty.checks, { B1: false, B2: false });
});

/** Writes the players export of a copy by hand: the index page and the given extra text files. */
function writePlayers(copy, { html, extra = {} }) {
  const dir = path.join(copy, '.campaign', 'cache', 'atlas', 'players');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  for (const [name, text] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), text);
}

const PLAYERS_PAGE = '<html><body><h1>Bornago</h1><script type="application/json" id="atlas-data">{"features":[{"id":"il-gatto-borgo-vecchio"}]}</script></body></html>';

test('urban-players: P1 to P3 pass on a players version with no master sentence and no master building', () => {
  const made = setupUrban();
  writePlayers(made.copy, { html: PLAYERS_PAGE, extra: { 'data.json': '{"features":[{"id":"tempio-di-san-ottavio"}]}' } });
  const key = caseOf('urban-players-no-secrets').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: null, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.equal(graded.pass, true, graded.failures.join('; '));
  assert.deepEqual(graded.checks, { P1: true, P2: true, P3: true });
});

test('urban-players: P1 fails with no players version, and P2 and P3 are not checked', () => {
  const made = setupUrban();
  const key = caseOf('urban-players-no-secrets').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: null, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.deepEqual(graded.checks, { P1: false, P2: false, P3: false });
});

test('urban-players: P2 fails when the master sentence is in any text file of the export', () => {
  const made = setupUrban();
  writePlayers(made.copy, { html: PLAYERS_PAGE, extra: { 'notes.txt': `Nota: ${SECRET_SENTENCE}` } });
  const key = caseOf('urban-players-no-secrets').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: null, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.equal(graded.checks.P2, false);
  assert.equal(graded.checks.P3, true);
  assert.ok(graded.failures.some((line) => line.startsWith('P2 ')));
});

test('urban-players: P3 fails on the id of a master building, as a whole id only', () => {
  const key = caseOf('urban-players-no-secrets').key;
  const leaked = setupUrban();
  writePlayers(leaked.copy, { html: PLAYERS_PAGE, extra: { 'data.json': '{"id":"rocca-del-sigillo"}' } });
  const bad = gradeAtlasRun({ key, copy: leaked.copy, report: null, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.equal(bad.checks.P3, false);
  assert.equal(bad.checks.P2, true);

  const longer = setupUrban();
  writePlayers(longer.copy, { html: PLAYERS_PAGE, extra: { 'data.json': '{"id":"rocca-del-sigillo-est"}' } });
  const near = gradeAtlasRun({ key, copy: longer.copy, report: null, baseline: null, fixtureDir: URBAN_FIXTURE });
  assert.equal(near.checks.P3, true);
});
