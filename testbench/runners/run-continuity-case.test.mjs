// Offline tests of the continuity case runner: the cases and keys load, the fixture is a valid
// campaign, and the graders pass a hand-made correct result and fail the seeded traps. No model runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './lib/case-common.mjs';
import {
  endsWithQuestion,
  gradeRun,
  linkTargets,
  loadCase,
  readTree,
  setupCopy,
  snapshotCopy,
  validateKey,
  wordsUnchanged,
} from './run-continuity-case.mjs';
import { validateConfig } from '../../yllir/scripts/lib/config.mjs';
import { saveVersion } from '../../yllir/scripts/lib/versions.mjs';
import { parseFrontmatter } from '../../yllir/scripts/lib/frontmatter.mjs';

const CASES = path.join(REPO_ROOT, 'testbench', 'cases', 'continuity');
const FIXTURE = path.join(REPO_ROOT, 'testbench', 'fixtures', 'continuity', 'campaign');
const NAMES = ['rename-with-homonym', 'delete-still-referenced', 'merge-conflicting-fact', 'retcon-contradicts-chronicle'];

function fixtureText(rel) {
  return fs.readFileSync(path.join(FIXTURE, rel), 'utf8');
}

/** Opens a copy of the fixture as the agent would see it, and the snapshot helper bound to it. */
function openCopy() {
  const setup = setupCopy();
  const snap = (report) => snapshotCopy(setup.copy, { baseline: setup.baseline, versionsBefore: setup.versionsBefore, report });
  const save = (message) => saveVersion(setup.copy, { message, kind: 'framework' });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(setup.copy, rel)), { recursive: true });
    fs.writeFileSync(path.join(setup.copy, rel), text);
  };
  const remove = (rel) => fs.rmSync(path.join(setup.copy, rel));
  const read = (rel) => fs.readFileSync(path.join(setup.copy, rel), 'utf8');
  return { ...setup, snap, save, write, remove, read, close: () => fs.rmSync(setup.tmp, { recursive: true, force: true }) };
}

function caseOf(name) {
  return loadCase(path.join(CASES, name));
}

test('every continuity case loads, declares its runs and keeps its key out of the fixture', () => {
  for (const name of NAMES) {
    const data = caseOf(name);
    assert.equal(data.runs, 3, `${name}: runs per agent`);
    assert.equal(data.fixture, 'continuity');
    assert.ok(!fs.existsSync(path.join(FIXTURE, 'key.yaml')));
  }
  assert.equal(caseOf('delete-still-referenced').reply !== undefined, true);
});

test('validateKey rejects a key without a field of its kind and a bad kind', () => {
  assert.throws(() => validateKey({ kind: 'rename' }), /subject missing/);
  assert.throws(() => validateKey({ kind: 'unknown' }), /kind must be one of/);
  assert.throws(() => validateKey({ kind: 'retcon', chronicle: 'x.md', untouched: 'x.md' }), /untouched must be a list/);
});

test('the fixture is a valid campaign with unique ids', () => {
  const config = validateConfig(FIXTURE);
  assert.equal(config.ok, true, JSON.stringify([...config.errors].map((e) => e.message)));
  const ids = [];
  for (const [file, text] of Object.entries(readTree(FIXTURE))) {
    if (!file.endsWith('.md')) continue;
    const { data } = parseFrontmatter(text);
    if (data && data.id) ids.push(data.id);
  }
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.ok(ids.includes('corrado-varno') && ids.includes('ilde-varno'));
});

test('a copy of the fixture starts with one saved version and nothing changed', () => {
  const copy = openCopy();
  try {
    const snap = copy.snap(null);
    assert.equal(snap.versions_added, 0);
    assert.deepEqual(snap.committed, []);
    assert.deepEqual(snap.dirty, []);
  } finally {
    copy.close();
  }
});

test('linkTargets and endsWithQuestion read links and questions', () => {
  assert.deepEqual(linkTargets('Trama/a.md', '[x](../Personaggi/Corrado%20Varno.md#sez) [y](https://example.org/a)'), [
    'Personaggi/Corrado Varno.md',
  ]);
  assert.equal(endsWithQuestion('Va bene?\n'), true);
  assert.equal(endsWithQuestion('Fatto. Nessuna domanda.'), false);
  assert.equal(endsWithQuestion(null), false);
});

test('rename: the correct result passes every check, the traps fail', () => {
  const key = caseOf('rename-with-homonym').key;

  const good = openCopy();
  try {
    good.write(key.new_file, good.read(key.old_file).replace('# Corrado Varno', '# Corrado Lesca').replace('aliases: [Corrado]', 'aliases: [Corrado, Corrado Varno]'));
    good.remove(key.old_file);
    const plot = 'Trama/La strada verso il faro.md';
    good.write(plot, good.read(plot).replace('Corrado%20Varno.md', 'Corrado%20Lesca.md').replace('[Corrado Varno]', '[Corrado Lesca]'));
    good.save('Rinominata la scheda di Corrado Varno in Corrado Lesca');
    const result = gradeRun({ key, snaps: [good.snap(null)], fixture: readTree(FIXTURE) });
    assert.equal(result.pass, true, result.failures.join('; '));
  } finally {
    good.close();
  }

  const badLink = openCopy();
  try {
    badLink.write(key.new_file, badLink.read(key.old_file).replace('# Corrado Varno', '# Corrado Lesca').replace('aliases: [Corrado]', 'aliases: [Corrado, Corrado Varno]'));
    badLink.remove(key.old_file);
    badLink.save('Rinominata la scheda, senza collegamenti');
    const result = gradeRun({ key, snaps: [badLink.snap(null)], fixture: readTree(FIXTURE) });
    assert.equal(result.checks.R2, false, 'a link to the old file is found');
    assert.equal(result.checks.R1, true);
  } finally {
    badLink.close();
  }

  const homonym = openCopy();
  try {
    homonym.write(key.new_file, homonym.read(key.old_file).replace('# Corrado Varno', '# Corrado Lesca').replace('aliases: [Corrado]', 'aliases: [Corrado, Corrado Varno]'));
    homonym.remove(key.old_file);
    homonym.write(key.homonym, homonym.read(key.homonym).replace('Sarta', 'Sarta del faro'));
    homonym.save('Rinominata, ma la sarta è cambiata');
    const result = gradeRun({ key, snaps: [homonym.snap(null)], fixture: readTree(FIXTURE) });
    assert.equal(result.checks.R4, false, 'the homonym change is found');
  } finally {
    homonym.close();
  }
});

test('rename: the chronicle may gain links with the same words (R3 and R6 pass); a changed word or metadata fails R3 and R6', () => {
  const key = caseOf('rename-with-homonym').key;
  const chronicle = key.chronicle;
  const original = fixtureText(chronicle);
  const linkedText = original.replace(
    'Corrado Varno aprì',
    '[Corrado Varno](../Personaggi/Faro%20di%20Tessa/Corrado%20Lesca.md) aprì',
  );
  assert.notEqual(linkedText, original, 'the fixture has the phrase to link');
  assert.equal(wordsUnchanged(original, linkedText).ok, true);

  const linked = openCopy();
  try {
    applyRenameAnswer(linked, key);
    linked.write(chronicle, linkedText);
    linked.save('Collegata la cronaca alla nuova scheda');
    const result = gradeRun({ key, snaps: [linked.snap('Fatto.')], fixture: readTree(FIXTURE) });
    assert.equal(result.checks.R3, true, 'a link-only change keeps the words');
    assert.equal(result.checks.R6, true, 'a link-only change of the chronicle is allowed');
  } finally {
    linked.close();
  }

  const reworded = openCopy();
  try {
    applyRenameAnswer(reworded, key);
    reworded.write(chronicle, original.replace('chiese del sale', 'chiese del grano'));
    reworded.save('Riscritta la cronaca');
    const result = gradeRun({ key, snaps: [reworded.snap('Fatto.')], fixture: readTree(FIXTURE) });
    assert.equal(result.checks.R3, false, 'a changed word is found');
    assert.equal(result.checks.R6, false, 'a changed chronicle is outside the allowed set');
    const line = result.failures.find((failure) => failure.startsWith('R3 '));
    assert.ok(line.startsWith('R3 the chronicle words changed: Il gruppo arrivò'), line);
    assert.ok(line.length <= 'R3 the chronicle words changed: '.length + 120, 'the line is at most 120 characters');
  } finally {
    reworded.close();
  }

  const metadata = wordsUnchanged(original, original.replace('played: [sessione-1]', 'played: []'));
  assert.equal(metadata.ok, false, 'the metadata block is kept as is');
  assert.equal(metadata.line, 'played: []');
  assert.equal(wordsUnchanged(original, original.replace('Il carico restò', '[Il carico](x.md) restò')).ok, true);
});

test('delete: the question turn passes only when nothing is saved and the answer turn passes after the answer', () => {
  const key = caseOf('delete-still-referenced').key;
  const copy = openCopy();
  try {
    const first = copy.snap('Il mercato di Tessa ancora nomina Ottone Sela. Lo tolgo o lo cambio?');
    const turnOne = gradeRun({ key, snaps: [first], fixture: readTree(FIXTURE) });
    assert.equal(turnOne.checks.D1, true);
    assert.equal(turnOne.checks.D4, true);
    assert.equal(turnOne.checks.D5, false, 'the answer turn has not run yet');

    const noQuestion = gradeRun({ key, snaps: [copy.snap('Fatto.')], fixture: readTree(FIXTURE) });
    assert.equal(noQuestion.checks.D1, false);

    // The answer: the document is settled and saved first, then the sheet is deleted.
    const plot = key.dependent;
    copy.write(plot, copy.read(plot).replace('merchant: ottone-sela\n', '').replace('[Ottone Sela](../Personaggi/Faro%20di%20Tessa/Ottone%20Sela.md)', 'Ottone Sela'));
    copy.save('Tolto il mercante dalla scena del mercato');
    copy.remove(key.sheet);
    copy.save('Eliminata la scheda di Ottone Sela');
    const second = copy.snap('Fatto: la scena è sistemata e la scheda è eliminata.');
    const both = gradeRun({ key, snaps: [first, second], fixture: readTree(FIXTURE) });
    assert.equal(both.pass, true, both.failures.join('; '));
    assert.equal(both.checks.D8, true);
  } finally {
    copy.close();
  }
});

/** The answer to the rename question: the sheet is renamed, the link is retargeted and one version is saved. */
function applyRenameAnswer(copy, key) {
  copy.write(key.new_file, copy.read(key.old_file).replace('# Corrado Varno', '# Corrado Lesca').replace('aliases: [Corrado]', 'aliases: [Corrado, Corrado Varno]'));
  copy.remove(key.old_file);
  const plot = 'Trama/La strada verso il faro.md';
  copy.write(plot, copy.read(plot).replace('Corrado%20Varno.md', 'Corrado%20Lesca.md').replace('[Corrado Varno]', '[Corrado Lesca]'));
  copy.save('Rinominata la scheda di Corrado Varno in Corrado Lesca');
}

test('rename with a reply: a quiet question turn passes R0a and R0b, then the yes passes R1 to R6', () => {
  const caseData = caseOf('rename-with-homonym');
  assert.equal(caseData.reply !== undefined, true, 'the rename case has a reply');
  const key = caseData.key;
  const copy = openCopy();
  try {
    const question = copy.snap('Cambierò il nome della scheda e i collegamenti in un documento. Va bene?');
    const turnOne = gradeRun({ key, snaps: [question], fixture: readTree(FIXTURE), turns: 2 });
    assert.equal(turnOne.checks.R0a, true);
    assert.equal(turnOne.checks.R0b, true);
    assert.equal(turnOne.checks.R1, false, 'the answer turn has not run yet');

    applyRenameAnswer(copy, key);
    const answer = copy.snap('Fatto: la scheda è stata rinominata.');
    const both = gradeRun({ key, snaps: [question, answer], fixture: readTree(FIXTURE), turns: 2 });
    assert.equal(both.pass, true, both.failures.join('; '));
    assert.equal(both.checks.R5, true, 'the one version is counted after both turns');
  } finally {
    copy.close();
  }
});

test('rename with a reply: R0a fails without a question, R0b fails when turn 1 saved a version', () => {
  const key = caseOf('rename-with-homonym').key;
  const copy = openCopy();
  try {
    const noQuestion = gradeRun({ key, snaps: [copy.snap('Fatto.')], fixture: readTree(FIXTURE), turns: 2 });
    assert.equal(noQuestion.checks.R0a, false);
    assert.equal(noQuestion.checks.R0b, true);
  } finally {
    copy.close();
  }

  const saved = openCopy();
  try {
    saved.write('Trama/Mappa della trama.md', '# Mappa della trama\n');
    saved.save('Salvato prima della risposta');
    const early = gradeRun({ key, snaps: [saved.snap('Va bene?')], fixture: readTree(FIXTURE), turns: 2 });
    assert.equal(early.checks.R0a, true);
    assert.equal(early.checks.R0b, false, 'a version saved before the yes is found');
  } finally {
    saved.close();
  }
});

test('rename with a reply: when the yes never ran, R1 to R6 fail and R0a and R0b are still graded', () => {
  const key = caseOf('rename-with-homonym').key;
  const copy = openCopy();
  try {
    const result = gradeRun({ key, snaps: [copy.snap('Va bene?')], fixture: readTree(FIXTURE), turns: 2 });
    assert.equal(result.checks.R0a, true);
    for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) assert.equal(result.checks[id], false, id);
  } finally {
    copy.close();
  }
});

test('D9 names the files outside the allowed set, at most ten', () => {
  const key = caseOf('delete-still-referenced').key;
  const copy = openCopy();
  try {
    const first = copy.snap('Il mercato di Tessa ancora nomina Ottone Sela. Lo tolgo o lo cambio?');
    copy.write('Cronaca/2026-10-03.md', `${copy.read('Cronaca/2026-10-03.md')}\nNota.\n`);
    for (let i = 0; i < 12; i++) copy.write(`Extra/nota ${i}.md`, `# Nota ${i}\n`);
    copy.save('Modifiche fuori dall elenco');
    const second = copy.snap('Fatto.');
    const result = gradeRun({ key, snaps: [first, second], fixture: readTree(FIXTURE) });
    assert.equal(result.checks.D9, false);
    const reason = result.failures.find((line) => line.startsWith('D9 ')) ?? '';
    assert.match(reason, /^D9 changes outside the allowed set: Cronaca\/2026-10-03\.md/);
    const listed = reason.replace(/^D9 changes outside the allowed set: /, '').split(', ');
    assert.equal(listed.length, 10, 'the reason lists at most ten files');
  } finally {
    copy.close();
  }
});

test('merge: the question turn names both birthplaces and changes nothing', () => {
  const key = caseOf('merge-conflicting-fact').key;
  const copy = openCopy();
  try {
    const good = gradeRun({ key, snaps: [copy.snap('Di Brizio Fell: sei nato a Porto Nero o nella Valle Bassa?')], fixture: readTree(FIXTURE) });
    assert.equal(good.pass, true, good.failures.join('; '));

    const oneOnly = gradeRun({ key, snaps: [copy.snap('Quale luogo di nascita è giusto?')], fixture: readTree(FIXTURE) });
    assert.equal(oneOnly.checks.M2, false);
  } finally {
    copy.close();
  }

  const edited = openCopy();
  try {
    edited.write(key.other, edited.read(key.other).replace('Valle Bassa', 'Porto Nero'));
    edited.save('Scelto Porto Nero');
    const result = gradeRun({ key, snaps: [edited.snap('Nato a Porto Nero?')], fixture: readTree(FIXTURE) });
    assert.equal(result.checks.M3, false, 'a saved change before the answer is found');
  } finally {
    edited.close();
  }
});

test('retcon: the question names the played chronicle and nothing is changed', () => {
  const key = caseOf('retcon-contradicts-chronicle').key;
  const copy = openCopy();
  try {
    const good = gradeRun({
      key,
      snaps: [copy.snap('Il faro compare nella cronaca del 10 ottobre, già giocata. Cambiarlo cambia ciò che è successo al tavolo: vuoi andare avanti?')],
      fixture: readTree(FIXTURE),
    });
    assert.equal(good.pass, true, good.failures.join('; '));

    const silent = gradeRun({ key, snaps: [copy.snap('Ho sistemato la data?')], fixture: readTree(FIXTURE) });
    assert.equal(silent.checks.T2, false);
  } finally {
    copy.close();
  }
});

test('a run whose turn failed fails without checks', () => {
  const key = caseOf('merge-conflicting-fact').key;
  const result = gradeRun({ key, snaps: [], fixture: readTree(FIXTURE), agentError: 'turn 1: timeout' });
  assert.equal(result.pass, false);
  assert.deepEqual(result.checks, {});
  assert.match(result.failures[0], /timeout/);
});

test('the setup is the only place where the framework runs git on the copy', () => {
  // Sanity: the baseline commit is the copy's HEAD and it holds the fixture files.
  const setup = setupCopy();
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: setup.copy, encoding: 'utf8' }).trim();
    assert.equal(head, setup.baseline);
    assert.ok(fs.existsSync(path.join(setup.copy, 'Personaggi', 'Faro di Tessa', 'Corrado Varno.md')));
  } finally {
    fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
});
