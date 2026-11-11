// Tests for run-world-case.mjs. No agent and no model is called: the setup builds real copies of the
// fixtures in temporary folders, the test writes what an agent would write (synthetic documents, a saved
// version) and grades it. Run: node --test testbench/runners/run-world-case.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from './lib/case-common.mjs';
import { saveVersion, listVersions } from '../../yllir/scripts/lib/versions.mjs';
import { buildWorldIndex } from '../../yllir/scripts/lib/world-graph.mjs';
import { loadAdapter } from '../../yllir/scripts/lib/adapter.mjs';
import {
  abilityProblems,
  addCheck,
  baselineOf,
  gradeCreature,
  gradeRegion,
  lakeClosure,
  lastWordOf,
  loadWorldCase,
  newErrorsOf,
  newSubjectsOf,
  sectionOf,
  setSystemAdapter,
  setupWorldCase,
  tableRows,
} from './run-world-case.mjs';

const CASES = path.join(REPO_ROOT, 'testbench', 'cases', 'world');
const PLUGIN = path.join(REPO_ROOT, 'yllir');
const SEED = 'Seme del mondo.md';

/** Writes a synthetic subject or place into the copy. */
function writeDoc(dir, rel, { id, kind, title, provenance = 'generated', location = [], relations = [], sketch = false, body = 'Una frase.' }) {
  const lines = ['---', `id: ${id}`, `kind: ${kind}`, `provenance: ${provenance}`, `location: [${location.join(', ')}]`];
  if (sketch) lines.push('sketch: true');
  if (relations.length > 0) {
    lines.push('relations:');
    for (const relation of relations) lines.push(`  - to: ${relation.to}`, `    type: ${relation.type}`);
  }
  lines.push('---', `# ${title}`, '', body, '');
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n'));
}

const regionCase = () => loadWorldCase(path.join(CASES, 'region'));
const creatureCase = () => loadWorldCase(path.join(CASES, 'creature'));

/** The synthetic world an agent would write for the region request: 6 new subjects, a faction, two villages. */
function writeGoodRegion(dir, { anesurname = 'Sarane' } = {}) {
  writeDoc(dir, 'Mondo/Villaggio dei Canneti.md', { id: 'canneti', kind: 'place', title: 'Villaggio dei Canneti', location: ['lago-grigio'] });
  writeDoc(dir, 'Mondo/Riva Bassa.md', { id: 'riva-bassa', kind: 'place', title: 'Riva Bassa', location: ['lago-grigio'] });
  writeDoc(dir, 'Personaggi/Ada Calmane.md', {
    id: 'ada-calmane', kind: 'character', title: 'Ada Calmane', location: ['canneti'],
    relations: [{ to: 'pescatori-del-lago', type: 'member-of' }],
  });
  writeDoc(dir, 'Personaggi/Bruno Sarane.md', {
    id: 'bruno-sarane', kind: 'character', title: `Bruno ${anesurname}`, location: ['riva-bassa'],
    relations: [{ to: 'pescatori-del-lago', type: 'member-of' }],
  });
  writeDoc(dir, 'Personaggi/Pescatori del lago.md', { id: 'pescatori-del-lago', kind: 'faction', title: 'Pescatori del lago', location: ['lago-grigio'] });
  writeDoc(dir, 'Personaggi/Gilda del sale.md', { id: 'gilda-del-sale', kind: 'faction', title: 'Gilda del sale', location: ['lago-grigio'], sketch: true });
  const seed = path.join(dir, SEED);
  const text = fs.readFileSync(seed, 'utf8');
  fs.writeFileSync(seed, text.replace('### Temi\n\nDa definire.', '### Temi\n\nLa tensione tra i villaggi del lago.'));
  saveVersion(dir, { message: 'Mondo: villaggi del lago', kind: 'framework' });
}

async function gradeRegionIn(setup, caseData, report) {
  const after = buildWorldIndex(setup.dir);
  return gradeRegion({
    key: caseData.key,
    baseline: setup.baseline,
    after,
    seedBefore: setup.seedBefore,
    seedAfter: fs.readFileSync(path.join(setup.dir, SEED), 'utf8'),
    versions: listVersions(setup.dir).length,
    setupVersions: setup.versions,
    report,
  });
}

const GOOD_REPORT = 'Ho creato il Villaggio dei Canneti, con la capo Ada Calmane, e Riva Bassa con Bruno Sarane. Tutto questo l\'ho inventato io.';

// ---------------------------------------------------------------- case files and setup

test('loadWorldCase reads both world cases with their keys and limits', () => {
  const region = regionCase();
  assert.equal(region.kind, 'region');
  assert.equal(region.fixture, 'morvalle-seeded');
  assert.equal(region.qualityMin, 3.5);
  assert.deepEqual(region.limits, { max_minutes: 10, max_tool_calls: 200 });
  assert.equal(region.key.lake_id, 'lago-grigio');
  const creature = creatureCase();
  assert.equal(creature.kind, 'creature');
  assert.equal(creature.system_adapter, 'dnd-2024');
  assert.deepEqual(creature.limits, { max_minutes: 3, max_tool_calls: 60 });
  assert.deepEqual(creature.key.abilities, ['str', 'dex', 'con', 'int', 'wis', 'cha']);
});

test('loadWorldCase rejects an unknown case, a creature without an adapter and a key missing a field', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'world-case-test-'));
  try {
    const write = (name, caseYaml, keyYaml) => {
      fs.mkdirSync(path.join(root, name), { recursive: true });
      fs.writeFileSync(path.join(root, name, 'case.yaml'), caseYaml);
      fs.writeFileSync(path.join(root, name, 'key.yaml'), keyYaml);
      return path.join(root, name);
    };
    const creatureKey = 'kind: creature\ntemplate: enemy\nlocation: borgo-cenere\nabilities: [str]\n';
    assert.throws(() => loadWorldCase(write('a', 'case: world-nope\nfixture: morvalle\nprompt: x\n', creatureKey)), /unknown case/);
    assert.throws(
      () => loadWorldCase(write('b', 'case: world-creature\nfixture: morvalle\nprompt: x\n', creatureKey)),
      /needs system_adapter/,
    );
    assert.throws(
      () => loadWorldCase(write('c', 'case: world-creature\nfixture: morvalle\nsystem_adapter: dnd-2024\nprompt: x\n', 'kind: creature\n')),
      /template missing/,
    );
    assert.throws(
      () => loadWorldCase(write('d', 'case: world-creature\nfixture: morvalle\nsystem_adapter: dnd-2024\nprompt: x\nquality_min: 9\n', creatureKey)),
      /quality_min/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setSystemAdapter changes the one adapter line and refuses when there is not exactly one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'world-adapter-test-'));
  try {
    fs.writeFileSync(path.join(root, 'campaign.yaml'), 'system:\n  adapter: none\n');
    setSystemAdapter(root, 'dnd-2024');
    assert.equal(fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8'), 'system:\n  adapter: dnd-2024\n');
    assert.throws(() => setSystemAdapter(root, 'dnd-2024'), /found 0 times/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setupWorldCase builds the region copy: version 1, the seeded constraints, a clean world', () => {
  const setup = setupWorldCase(regionCase());
  try {
    assert.equal(setup.versions, 1);
    assert.equal(setup.baseline.errors.length, 0);
    assert.ok(setup.baseline.ids.includes('lago-grigio'));
    assert.match(setup.seedBefore, /La Gilda del sale controlla il commercio sul Lago Grigio\./);
    assert.match(setup.seedBefore, /I nomi delle famiglie del lago finiscono in -ane\./);
    assert.match(setup.seedBefore, /Nessun nuovo personaggio è un nobile\./);
    assert.ok(fs.existsSync(path.join(setup.dir, 'campaign.yaml')));
  } finally {
    fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
});

test('setupWorldCase gives the creature copy the dnd-2024 adapter, saved in version 1', () => {
  const setup = setupWorldCase(creatureCase());
  try {
    assert.match(fs.readFileSync(path.join(setup.dir, 'campaign.yaml'), 'utf8'), /adapter: dnd-2024/);
    assert.equal(setup.versions, 1);
    assert.equal(listVersions(setup.dir).length, 1);
  } finally {
    fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- region grading

test('gradeRegion passes a synthetic world that meets every check', async () => {
  const setup = setupWorldCase(regionCase());
  try {
    writeGoodRegion(setup.dir);
    const graded = await gradeRegionIn(setup, regionCase(), GOOD_REPORT);
    assert.deepEqual(graded.failures, []);
    assert.equal(graded.pass, true);
    for (const id of ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10']) assert.equal(graded.checks[id], true, id);
    assert.equal(graded.newSubjects.length, 6);
    assert.equal(graded.newFiles.length, 6);
  } finally {
    fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
});

test('gradeRegion fails W7 when a new lake village has a character whose last word does not end in -ane', async () => {
  const setup = setupWorldCase(regionCase());
  try {
    writeGoodRegion(setup.dir, { anesurname: 'Rossi' });
    const graded = await gradeRegionIn(setup, regionCase(), GOOD_REPORT);
    assert.equal(graded.checks.W7, false);
    assert.ok(graded.failures.some((f) => f.includes('bruno-sarane') && f.includes('rossi')));
    assert.equal(graded.checks.W1, true);
  } finally {
    fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
});

test('gradeRegion fails W7 when no character is checkable (the constraint would be untested)', async () => {
  const setup = setupWorldCase(regionCase());
  try {
    writeDoc(setup.dir, 'Mondo/Villaggio dei Canneti.md', { id: 'canneti', kind: 'place', title: 'Villaggio dei Canneti', location: ['lago-grigio'] });
    writeDoc(setup.dir, 'Mondo/Riva Bassa.md', { id: 'riva-bassa', kind: 'place', title: 'Riva Bassa', location: ['lago-grigio'] });
    writeDoc(setup.dir, 'Personaggi/Pescatori del lago.md', { id: 'pescatori-del-lago', kind: 'faction', title: 'Pescatori del lago', location: ['lago-grigio'] });
    const graded = await gradeRegionIn(setup, regionCase(), GOOD_REPORT);
    assert.equal(graded.checks.W7, false);
    assert.ok(graded.failures.some((f) => f.includes('0 new characters at new lake villages')));
  } finally {
    fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
});

test('gradeRegion fails W5 for a new place outside the lake subtree, and W4 for a new world-graph error', async () => {
  const setup = setupWorldCase(regionCase());
  try {
    writeGoodRegion(setup.dir);
    writeDoc(setup.dir, 'Mondo/Colle Alto.md', { id: 'colle-alto', kind: 'place', title: 'Colle Alto', location: ['monte-nero'] });
    writeDoc(setup.dir, 'Personaggi/Dora Vance.md', { id: 'dora-vance', kind: 'character', title: 'Dora Vance', location: ['luogo-che-non-esiste'] });
    const graded = await gradeRegionIn(setup, regionCase(), GOOD_REPORT);
    assert.equal(graded.checks.W5, false);
    assert.ok(graded.failures.some((f) => f.includes('colle-alto is not in the lago-grigio subtree')));
    assert.equal(graded.checks.W4, false);
    assert.ok(graded.failures.some((f) => f.startsWith('W4') && f.includes('luogo-che-non-esiste')));
  } finally {
    fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
});

test('gradeRegion fails W8 when the seed did not change, W9 when no version was saved, W10 without the invented wording', async () => {
  const setup = setupWorldCase(regionCase());
  try {
    writeDoc(setup.dir, 'Mondo/Villaggio dei Canneti.md', { id: 'canneti', kind: 'place', title: 'Villaggio dei Canneti', location: ['lago-grigio'] });
    const graded = await gradeRegionIn(setup, regionCase(), 'Ho creato il Villaggio dei Canneti.');
    assert.equal(graded.checks.W8, false, 'seed unchanged');
    assert.equal(graded.checks.W9, false, 'no version saved after the setup');
    assert.equal(graded.checks.W10, false, 'no «inventat»');
    assert.equal(graded.checks.W1, false, 'one new subject is not six');
    assert.equal(graded.pass, false);
  } finally {
    fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
});

test('gradeRegion fails W10 when the final message names no created subject', async () => {
  const setup = setupWorldCase(regionCase());
  try {
    writeGoodRegion(setup.dir);
    const graded = await gradeRegionIn(setup, regionCase(), 'Fatto. Tutto questo l\'ho inventato io.');
    assert.equal(graded.checks.W10, false);
    assert.ok(graded.failures.some((f) => f.includes('names no created subject')));
    const none = await gradeRegionIn(setup, regionCase(), null);
    assert.ok(none.failures.some((f) => f.includes('W10 no final message')));
  } finally {
    fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- creature grading

const SHEET = `---
id: capo-bandito
kind: creature
template: enemy
provenance: generated
location: [borgo-cenere]
---
# Capo Bandito

## Natura

_Un uomo magro, con una cicatrice sulla guancia._

Guida una banda di tagliagole sulle strade alte sopra il borgo.

## Statistiche

### Caratteristiche

| Caratteristica | Valore |
| --- | --- |
| CA | 15 |
| PF | 45 (6d8 + 18) |
| Velocità | 9 m |
| FOR | 16 (+3) |
| DES | 14 (+2) |
| COS | 12 (+1) |
| INT | 8 (-1) |
| SAG | 10 (+0) |
| CAR | 9 (-1) |

<!-- master -->
## Master

### Indicazioni per il master

Fugge quando perde metà dei punti ferita.
<!-- /master -->
`;

async function gradeCreatureIn(setup, caseData, report) {
  return gradeCreature({
    key: caseData.key,
    adapterId: caseData.system_adapter,
    lang: 'it',
    baseline: setup.baseline,
    after: buildWorldIndex(setup.dir),
    dir: setup.dir,
    versions: listVersions(setup.dir).length,
    setupVersions: setup.versions,
    report,
  });
}

test('gradeCreature passes a valid enemy sheet on the dnd-2024 copy, with a saved version', async () => {
  const setup = setupWorldCase(creatureCase());
  try {
    writeDoc(setup.dir, 'Creature/Capo Bandito.md', { id: 'capo-bandito', kind: 'creature', title: 'Capo Bandito', location: ['borgo-cenere'] });
    fs.writeFileSync(path.join(setup.dir, 'Creature/Capo Bandito.md'), SHEET);
    saveVersion(setup.dir, { message: 'Creature: capo bandito', kind: 'framework' });
    const graded = await gradeCreatureIn(setup, creatureCase(), 'Ho creato il Capo Bandito, inventato da me.');
    assert.deepEqual(graded.failures, []);
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C5']) assert.equal(graded.checks[id], true, id);
  } finally {
    fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
});

test('gradeCreature fails C2 and C3 for a wrong modifier, and C4 for another location', async () => {
  const setup = setupWorldCase(creatureCase());
  try {
    const file = path.join(setup.dir, 'Creature/Capo Bandito.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, SHEET.replace('| FOR | 16 (+3) |', '| FOR | 16 (+2) |').replace('location: [borgo-cenere]', 'location: [lago-grigio]'));
    saveVersion(setup.dir, { message: 'Creature: capo bandito', kind: 'framework' });
    const graded = await gradeCreatureIn(setup, creatureCase(), 'x');
    assert.equal(graded.checks.C2, false);
    assert.equal(graded.checks.C3, false);
    assert.ok(graded.failures.some((f) => f.startsWith('C3') && f.includes('FOR: modifier 2 for score 16 (want 3)')));
    assert.equal(graded.checks.C4, false);
    assert.equal(graded.checks.C1, true);
    assert.equal(graded.checks.C5, true);
  } finally {
    fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
});

test('gradeCreature fails C1 when no creature was created and C5 when no version was saved', async () => {
  const setup = setupWorldCase(creatureCase());
  try {
    const graded = await gradeCreatureIn(setup, creatureCase(), null);
    assert.equal(graded.checks.C1, false);
    assert.equal(graded.checks.C5, false);
    assert.equal(graded.checks.C2, false);
    assert.equal(graded.checks.C3, false);
    assert.equal(graded.checks.C4, false);
  } finally {
    fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- helpers

test('lakeClosure follows locations to a fixed point and keeps the root', () => {
  const places = [
    { id: 'c', location: ['x'] },
    { id: 'b', location: ['a'] },
    { id: 'a', location: ['lago'] },
    { id: 'd', location: ['lago'] },
  ];
  assert.deepEqual([...lakeClosure(places, 'lago')].sort(), ['a', 'b', 'd', 'lago']);
});

test('lastWordOf folds the last word of the title, and falls back to the file name', () => {
  assert.equal(lastWordOf({ title: 'Ada Calmane', file: 'Personaggi/Ada Calmane.md' }), 'calmane');
  assert.equal(lastWordOf({ title: 'Mastro Lanè.', file: 'x.md' }), 'lane');
  assert.equal(lastWordOf({ title: null, file: 'Personaggi/Lino Valdès.md' }), 'valdes');
  assert.equal(lastWordOf({ title: '...', file: 'x.md' }), '');
});

test('tableRows and sectionOf read the Caratteristiche table under the statistics section', () => {
  const body = '## Natura\n\nText.\n\n## Statistiche\n\n### Caratteristiche\n\n| Caratteristica | Valore |\n| --- | --- |\n| FOR | 16 (+3) |\n\n## Master\n';
  const statistics = sectionOf(body, 'Statistiche');
  assert.ok(statistics.includes('FOR'));
  assert.equal(sectionOf(body, 'Assente'), null);
  assert.deepEqual(tableRows(statistics, 'Caratteristiche'), [{ label: 'FOR', value: '16 (+3)' }]);
  assert.equal(tableRows(statistics, 'Attacchi e capacità'), null);
});

test('abilityProblems accepts the modifiers of the sheet and names a wrong one', () => {
  const adapter = loadAdapter(PLUGIN, 'dnd-2024').adapter;
  const body = '## Statistiche\n\n### Caratteristiche\n\n| Caratteristica | Valore |\n| --- | --- |\n| FOR | 16 (+3) |\n| DES | 8 (+2) |\n';
  const md = `${body}\n`;
  const problems = abilityProblems(md, adapter, 'it', ['str', 'dex', 'con']);
  assert.ok(problems.some((p) => p.includes('DES: modifier 2 for score 8 (want -1)')));
  assert.ok(problems.some((p) => p.includes('no row for COS')));
  assert.ok(!problems.some((p) => p.includes('FOR')));
});

test('newSubjectsOf, newErrorsOf and addCheck compare against the baseline', () => {
  const baseline = { ids: ['a'], errors: ['f | code | msg'] };
  const index = {
    subjects: [{ id: 'a' }, { id: 'b' }],
    errors: [{ file: 'f', code: 'code', message: 'msg' }, { file: 'g', code: 'new', message: 'new error' }],
  };
  assert.deepEqual(newSubjectsOf(index, baseline).map((s) => s.id), ['b']);
  assert.deepEqual(newErrorsOf(index, baseline).map((e) => e.code), ['new']);
  assert.deepEqual(baselineOf({ subjects: [{ id: 'a' }], errors: [{ file: 'f', code: 'code', message: 'msg' }] }), baseline);
  const graded = addCheck({ checks: { W1: true }, failures: [], pass: true }, 'Q-grid', false, ['mean 2.00']);
  assert.deepEqual(graded.checks, { W1: true, 'Q-grid': false });
  assert.deepEqual(graded.failures, ['Q-grid mean 2.00']);
  assert.equal(graded.pass, false);
});
