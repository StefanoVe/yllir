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
} from './run-atlas-case.mjs';
import { readAtlas, validateAtlas } from '../../yllir/skills/library/atlas/scripts/lib/model.mjs';
import { buildWorldIndex } from '../../yllir/scripts/lib/world-graph.mjs';
import { listVersions, saveVersion } from '../../yllir/scripts/lib/versions.mjs';

const CASES = path.join(REPO_ROOT, 'testbench', 'cases', 'atlas');
const FIXTURE = path.join(REPO_ROOT, 'testbench', 'fixtures', 'atlas-morvalle', 'campaign');
const ATLAS_CLI = path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'atlas', 'scripts', 'atlas.mjs');
const NAMES = ['create-asks', 'update-keeps-land', 'players-no-secrets'];
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
