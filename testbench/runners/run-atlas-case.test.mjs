// Offline tests of the atlas case runner: the cases and keys load, the setups build a valid atlas through the
// atlas CLI with the procedural picture, the fake provider is set for the agent only while it runs, and the
// graders pass a hand-made correct result and fail the seeded traps. No model runs: the good and bad folders
// are made by editing setup copies.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './lib/case-common.mjs';
import { TOWN_SIZE } from './lib/make-atlas-picture.mjs';
import {
  LAND_LABELS,
  atlasNames,
  endsWithQuestion,
  forbiddenIn,
  gradeAtlasRun,
  loadCase,
  setupBaseline,
  setupCopy,
  sheetTitles,
  validateKey,
  withFakeProvider,
} from './run-atlas-case.mjs';
import { listVersions, saveVersion } from '../../yllir/scripts/lib/versions.mjs';

const CASES = path.join(REPO_ROOT, 'testbench', 'cases', 'atlas');
const FIXTURE = path.join(REPO_ROOT, 'testbench', 'fixtures', 'atlas-morvalle', 'campaign');
const TOWN_FIXTURE = path.join(REPO_ROOT, 'testbench', 'fixtures', 'atlas-ostrava-town', 'campaign');
const ATLAS_CLI = path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'atlas', 'scripts', 'atlas.mjs');
const NAMES = ['create-asks', 'update-keeps-land', 'players-no-secrets', 'city-from-picture'];
const GOOD_ANSWER = 'I documenti non dicono dove si trova il Lago Grigio rispetto alla piazza. Il lago è a nord o a sud del borgo?';
const RIVA_POINT = [200, 230];

const kept = [];
function setup(setupName, extra = {}) {
  const made = setupCopy({ fixtureDir: FIXTURE, setup: setupName, ...extra });
  kept.push(made.tmp);
  return made;
}
test.after(() => {
  for (const tmp of kept) fs.rmSync(tmp, { recursive: true, force: true });
});

function caseOf(name) {
  return loadCase(path.join(CASES, name));
}

function atlasCli(copy, ...args) {
  return spawnSync(process.execPath, [ATLAS_CLI, ...args, copy], { encoding: 'utf8' });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Writes the sheet of Riva Storta and places it on land through labels-write (a refused write throws). */
function addRiva(copy) {
  fs.mkdirSync(path.join(copy, 'Mondo', 'Morvalle'), { recursive: true });
  fs.writeFileSync(
    path.join(copy, 'Mondo', 'Morvalle', 'Riva Storta.md'),
    '---\nid: riva-storta\nkind: place\nprovenance: master\n---\n# Riva Storta\n\n## Descrizione\n\n_Un villaggio di pescatori._\n\nLe case si affacciano sulla riva.\n',
  );
  const labels = {
    ...LAND_LABELS,
    places: [
      ...LAND_LABELS.places,
      { id: 'riva-storta', place: 'riva-storta', x: RIVA_POINT[0], y: RIVA_POINT[1], kind: 'village', provenance: 'agent-choice', sources: [], visibility: 'public' },
    ],
  };
  const file = path.join(path.dirname(copy), 'labels-with-riva.json');
  fs.writeFileSync(file, JSON.stringify(labels, null, 2));
  const res = spawnSync(process.execPath, [ATLAS_CLI, 'labels-write', copy, file], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`labels-write refused: ${res.stdout}`);
}

test('the four atlas cases and their keys load with the setups, pictures and limits', () => {
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
  const city = caseOf('city-from-picture');
  assert.equal(city.setup, 'none');
  assert.equal(city.picture, 'town');
  assert.equal(city.sourcePicture, 'Fonti/citta.png');
  assert.deepEqual(city.key.scope_kinds, ['settlement', 'district']);
  for (const name of NAMES) assert.ok(fs.existsSync(path.join(CASES, name, 'key.yaml')));
  assert.deepEqual(fs.readdirSync(path.join(REPO_ROOT, 'testbench', 'cases', 'atlas')).sort(), [...NAMES].sort());
});

test('the key checks reject an unknown kind and a missing field', () => {
  assert.throws(() => validateKey({ kind: 'terrain' }), /kind must be one of/);
  assert.throws(() => validateKey({ kind: 'update' }), /new_title missing/);
  assert.throws(() => validateKey({ kind: 'city', scope_kinds: 'settlement' }), /scope_kinds must be a list/);
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
});

test('setup none gives the fixture as a git repository with one version and no atlas', () => {
  const made = setup('none');
  assert.equal(made.baseline, null);
  assert.equal(listVersions(made.copy, { limit: 500 }).length, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(made.copy, 'campaign.yaml'), 'utf8'), /type: atlas/);
  assert.ok(fs.existsSync(made.codex), 'the fake provider is written beside the copy');
});

test('setup init gives an atlas with a base picture of the Morvalle size and a valid manifest', () => {
  const made = setup('init');
  const manifest = readJson(path.join(made.copy, 'Atlante', 'atlas.json'));
  assert.deepEqual(manifest.canvas, { width: 400, height: 300 });
  assert.equal(manifest.base.locked, false);
  assert.ok(fs.existsSync(path.join(made.copy, 'Atlante', 'base.png')));
  assert.equal(atlasCli(made.copy, 'validate').status, 0);
  assert.equal(listVersions(made.copy, { limit: 500 }).length, 2);
});

test('setup land builds a valid atlas: locked land, one placed village, one master-only place and a master site', () => {
  const made = setup('land');
  assert.equal(atlasCli(made.copy, 'validate').status, 0);
  const manifest = readJson(path.join(made.copy, 'Atlante', 'atlas.json'));
  assert.equal(manifest.land.locked, true);
  const labels = readJson(path.join(made.copy, 'Atlante', 'labels.json'));
  assert.deepEqual(labels.places.map((p) => [p.place, p.visibility]), [['borgo-cenere', 'public'], ['rifugio-contrabbandieri', 'master']]);
  assert.ok(fs.existsSync(path.join(made.copy, '.campaign', 'cache', 'atlas', 'master', 'index.html')));
  assert.equal(made.baseline.land_locked, true);
  assert.equal(made.baseline.versions, 2);
  assert.equal(made.baseline.land_sha256.length, 64);
  assert.equal(made.baseline.master_sha256.length, 64);
  assert.equal(listVersions(made.copy, { limit: 500 }).length, 2);
});

test('setup city puts the town picture in the campaign sources before the baseline version', () => {
  const made = setupCopy({ fixtureDir: TOWN_FIXTURE, setup: 'none', picture: 'town', sourcePicture: 'Fonti/citta.png' });
  kept.push(made.tmp);
  assert.ok(fs.existsSync(path.join(made.copy, 'Fonti', 'citta.png')));
  assert.equal(listVersions(made.copy, { limit: 500 }).length, 1);
});

test('the fake provider is first on the PATH and set as YLLIR_CODEX_BIN only while the function runs', () => {
  const made = setup('none');
  const beforePath = process.env.PATH;
  const beforeBin = process.env.YLLIR_CODEX_BIN;
  const seen = withFakeProvider(made.codex, () => ({ path: process.env.PATH, bin: process.env.YLLIR_CODEX_BIN }));
  assert.equal(seen.bin, made.codex);
  assert.ok(seen.path.startsWith(path.dirname(made.codex) + path.delimiter));
  assert.equal(process.env.PATH, beforePath);
  assert.equal(process.env.YLLIR_CODEX_BIN, beforeBin);
  assert.throws(() => withFakeProvider(made.codex, () => { throw new Error('boom'); }), /boom/);
  assert.equal(process.env.PATH, beforePath);
});

test('the create-asks grader passes a question on a campaign with no atlas', () => {
  const made = setup('none');
  const graded = gradeAtlasRun({ key: caseOf('create-asks').key, copy: made.copy, report: GOOD_ANSWER, baseline: null, fixtureDir: FIXTURE });
  assert.equal(graded.pass, true, graded.failures.join('; '));
  assert.deepEqual(Object.keys(graded.checks), ['A1', 'A2', 'A3']);
});

test('the create-asks grader fails A1 on a closing statement that invents a label', () => {
  const made = setup('init');
  fs.writeFileSync(
    path.join(made.copy, 'Atlante', 'labels.json'),
    JSON.stringify({ lands: [{ id: 'l1', text: 'Mare Grigio', x: 10, y: 10, size: 20, provenance: 'agent-choice', sources: [], visibility: 'public' }], regions: [], nature: [], places: [], territories: [] }),
  );
  assert.ok(atlasNames(made.copy).includes('Mare Grigio'));
  const graded = gradeAtlasRun({ key: caseOf('create-asks').key, copy: made.copy, report: 'Fatto.', baseline: null, fixtureDir: FIXTURE });
  assert.equal(graded.checks.A1, false);
  assert.equal(graded.pass, false);
});

test('the create-asks grader fails A2 on a locked land and A3 on a forbidden word', () => {
  const made = setup('land');
  const key = caseOf('create-asks').key;
  const graded = gradeAtlasRun({ key, copy: made.copy, report: `${GOOD_ANSWER} Il lock è pronto.`, baseline: made.baseline, fixtureDir: FIXTURE });
  assert.equal(graded.checks.A2, false);
  assert.equal(graded.checks.A3, false);
  assert.equal(graded.pass, false);
});

test('the update grader fails with no sheet and no version, and passes once Riva Storta is placed on land', () => {
  const made = setup('land');
  const key = caseOf('update-keeps-land').key;
  const before = gradeAtlasRun({ key, copy: made.copy, report: '', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.equal(before.checks.U1, false);
  assert.equal(before.checks.U2, true);
  assert.equal(before.checks.U5, false);
  assert.equal(before.pass, false);

  addRiva(made.copy);
  saveVersion(made.copy, { message: 'Riva Storta aggiunta.', kind: 'framework' });
  const after = gradeAtlasRun({ key, copy: made.copy, report: '', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.deepEqual(after.failures, [], after.failures.join('; '));
  assert.equal(after.pass, true);
});

test('the update grader fails U2 when the land picture changes or the land is unlocked', () => {
  const made = setup('land');
  const key = caseOf('update-keeps-land').key;
  const manifestFile = path.join(made.copy, 'Atlante', 'atlas.json');
  const manifest = readJson(manifestFile);
  manifest.land.locked = false;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  const graded = gradeAtlasRun({ key, copy: made.copy, report: '', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.equal(graded.checks.U2, false);
});

test('the update grader fails U3 when the place is in the water', () => {
  const made = setup('land');
  const key = caseOf('update-keeps-land').key;
  addRiva(made.copy);
  const labelsFile = path.join(made.copy, 'Atlante', 'labels.json');
  const labels = readJson(labelsFile);
  labels.places.find((p) => p.place === 'riva-storta').x = 5;
  labels.places.find((p) => p.place === 'riva-storta').y = 5;
  fs.writeFileSync(labelsFile, JSON.stringify(labels));
  saveVersion(made.copy, { message: 'Riva Storta in mare.', kind: 'framework' });
  const graded = gradeAtlasRun({ key, copy: made.copy, report: '', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.equal(graded.checks.U3, false);
});

test('the players grader fails with no players version, and passes a version with no hidden text', () => {
  const made = setup('land');
  const key = caseOf('players-no-secrets').key;
  const none = gradeAtlasRun({ key, copy: made.copy, report: '', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.equal(none.checks.P1, false);
  assert.equal(none.checks.P3, true);

  const dir = path.join(made.copy, '.campaign', 'cache', 'atlas', 'players');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><body><h1>Atlante</h1><p>Borgo Cenere, Valdaspra.</p></body></html>');
  const good = gradeAtlasRun({ key, copy: made.copy, report: '', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.deepEqual(good.failures, [], good.failures.join('; '));
  assert.equal(good.pass, true);

  fs.writeFileSync(path.join(dir, 'index.html'), '<html><body><p>Rifugio dei Contrabbandieri</p></body></html>');
  const leak = gradeAtlasRun({ key, copy: made.copy, report: '', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.equal(leak.checks.P2, false);
  assert.equal(leak.pass, false);
});

test('the players grader passes the real players export of the land setup, and fails P3 when the master site changes', () => {
  const made = setup('land');
  const key = caseOf('players-no-secrets').key;
  const res = spawnSync(process.execPath, [ATLAS_CLI, 'render', made.copy, '--audience', 'players'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout);
  const graded = gradeAtlasRun({ key, copy: made.copy, report: '', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.deepEqual(graded.failures, [], graded.failures.join('; '));
  fs.appendFileSync(path.join(made.copy, '.campaign', 'cache', 'atlas', 'master', 'index.html'), '\n<!-- changed -->\n');
  const changed = gradeAtlasRun({ key, copy: made.copy, report: '', baseline: made.baseline, fixtureDir: FIXTURE });
  assert.equal(changed.checks.P3, false);
});

test('the city grader fails with no atlas and passes an atlas made from the picture of the campaign', () => {
  const made = setupCopy({ fixtureDir: TOWN_FIXTURE, setup: 'none', picture: 'town', sourcePicture: 'Fonti/citta.png' });
  kept.push(made.tmp);
  const key = caseOf('city-from-picture').key;
  const none = gradeAtlasRun({ key, copy: made.copy, report: '', baseline: null, fixtureDir: TOWN_FIXTURE });
  assert.equal(none.checks.C1, false);
  assert.equal(none.pass, false);

  const scope = path.join(made.tmp, 'scope-city.json');
  fs.writeFileSync(scope, JSON.stringify({ scope: { kind: 'settlement', places: [], note: 'Bornago.' } }));
  const init = spawnSync(process.execPath, [ATLAS_CLI, 'init', made.copy, scope, '--base', path.join(made.copy, 'Fonti', 'citta.png')], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stdout);
  const graded = gradeAtlasRun({ key, copy: made.copy, report: '', baseline: null, fixtureDir: TOWN_FIXTURE });
  assert.deepEqual(graded.failures, [], graded.failures.join('; '));
  assert.equal(graded.pass, true);
  const manifest = readJson(path.join(made.copy, 'Atlante', 'atlas.json'));
  assert.deepEqual(manifest.canvas, TOWN_SIZE);
});

test('the grading helpers: a question ends the report, forbidden words are whole words, a setup baseline has its hashes', () => {
  assert.equal(endsWithQuestion('Il lago è a nord?  '), true);
  assert.equal(endsWithQuestion('Fatto.'), false);
  assert.equal(endsWithQuestion(null), false);
  assert.deepEqual(forbiddenIn('Il JSON e la seed', ['JSON', 'seed', 'hash']), ['JSON', 'seed']);
  assert.deepEqual(forbiddenIn('scrivo lo scriptorium', ['script']), []);
  const made = setup('land');
  assert.deepEqual(setupBaseline(made.copy), made.baseline);
});
