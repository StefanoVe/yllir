// Offline checks of the pure helpers and the grading of run-update-case.mjs, on small
// folders built in a temporary directory. No agent runs.
// Run with: node --test testbench/runners/run-update-case.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  asksToUpdate,
  frameworkVersionOf,
  gradeDeclined,
  gradeNewer,
  gradeScenario,
  gradeStale,
  neverSayWords,
  nextMinorVersion,
  paragraphsOf,
  parseCaseData,
  setFrameworkVersion,
  technicalFindings,
  todayDates,
} from './run-update-case.mjs';

const LEXICON = path.resolve(import.meta.dirname, '..', '..', 'yllir', 'skills', 'core', 'yllir', 'lexicon.md');
const TODAY = '2026-11-09';
const INSTALLED = '0.1.0';
const MARKER = 'riga-a-mano-4471';
const CUSTOMIZATIONS = 'Il master: «Teodo Marr non parla con gli stranieri prima del tramonto».\n';
const VERSION_YAML = `framework_version: "${INSTALLED}"\nschema: 1\ngenerated:\n  - path: "CLAUDE.md"\n    sha256: "abc"\n`;
const NOTICE = `last_notified_version: "0.2.0"\nlast_notified_on: "${TODAY}"\n`;

/** git in dir with a fixed identity and no global configuration. */
function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'testbench',
      GIT_AUTHOR_EMAIL: 'testbench@example.invalid',
      GIT_COMMITTER_NAME: 'testbench',
      GIT_COMMITTER_EMAIL: 'testbench@example.invalid',
    },
  });
}

/** A git folder with the given files, committed once; returns its path. Remove it with fs.rmSync. */
function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-grade-test-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'one']);
  return dir;
}

/** Adds one commit that changes a note file, so the folder has one more commit. */
function addCommit(dir) {
  fs.writeFileSync(path.join(dir, 'nota.md'), `nota ${Math.random()}\n`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'two']);
}

/** The failing check ids of a list of [id, ok, reasons] tuples. */
const failing = (results) => results.filter(([, ok]) => !ok).map(([id]) => id);

const FIXTURE_CONFIG = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', '..', 'testbench', 'fixtures', 'morvalle', 'campaign', 'campaign.yaml'),
  'utf8',
);

const STALE_FILES = () => ({
  'campaign.yaml': FIXTURE_CONFIG,
  '.campaign/version.yaml': VERSION_YAML,
  '.campaign/instructions/agent.md': 'Regole della campagna.\n',
  '.campaign/customizations.md': CUSTOMIZATIONS,
});

/** A stale-campaign folder: framework 0.1.0 after the update, one commit more than the setup. */
function staleFolder({ files = STALE_FILES(), addSecond = true } = {}) {
  const dir = makeRepo(files);
  if (addSecond) addCommit(dir);
  return dir;
}

const STALE_SETUP = {
  installed: INSTALLED,
  commits: 1,
  marker: MARKER,
  customizationsText: CUSTOMIZATIONS,
  versionYamlText: VERSION_YAML,
  published: null,
};

const NEWER_SETUP = { ...STALE_SETUP, published: '0.2.0' };

/** A campaign folder for the newer-published and declined scenarios: nothing changed, one commit. */
function quietFolder({ notice = NOTICE, version = VERSION_YAML } = {}) {
  const files = { '.campaign/version.yaml': version, '.campaign/customizations.md': CUSTOMIZATIONS };
  if (notice !== null) files['.campaign/state/update-notice.yaml'] = notice;
  return makeRepo(files);
}

// ---------------------------------------------------------------- pure helpers

test('nextMinorVersion bumps the minor part and rejects other text', () => {
  assert.equal(nextMinorVersion('0.1.0'), '0.2.0');
  assert.equal(nextMinorVersion('2.9.4'), '2.10.0');
  assert.throws(() => nextMinorVersion('1.0'), TypeError);
  assert.throws(() => nextMinorVersion('v1.0.0'), TypeError);
});

test('setFrameworkVersion changes only the framework_version line', () => {
  const before = `framework_version: "${INSTALLED}"\nschema: 1\ngenerated:\n  - path: "a"\n`;
  const after = setFrameworkVersion(before, '0.0.1');
  assert.equal(after, `framework_version: "0.0.1"\nschema: 1\ngenerated:\n  - path: "a"\n`);
  assert.throws(() => setFrameworkVersion('schema: 1\n', '0.0.1'), /found 0 times/);
  assert.throws(() => setFrameworkVersion(`${before}framework_version: "0.1.0"\n`, '0.0.1'), /found 2 times/);
});

test('frameworkVersionOf reads the version and returns null for bad text', () => {
  assert.equal(frameworkVersionOf(VERSION_YAML), INSTALLED);
  assert.equal(frameworkVersionOf('schema: 1\n'), null);
  assert.equal(frameworkVersionOf(null), null);
});

test('neverSayWords reads the real lexicon and names the terms the master must not see', () => {
  const words = neverSayWords(fs.readFileSync(LEXICON, 'utf8'));
  for (const word of ['git', 'commit', 'plugin', 'Claude', 'skill']) {
    assert.ok(words.includes(word), `missing ${word}`);
  }
  assert.throws(() => neverSayWords('# Lexicon\n\nNo section here.\n'), /"Never say" section missing/);
});

test('technicalFindings is empty for plain Italian and names each kind of technical word', () => {
  const words = ['git'];
  assert.deepEqual(technicalFindings('Ciao, riprendiamo la campagna.', words), []);
  assert.deepEqual(technicalFindings('Teodo Marr è il fabbro del villaggio.', words), []);
  assert.ok(technicalFindings('Il git ha salvato tutto.', words).includes('word: git'));
  assert.ok(technicalFindings('Aggiornata la `campagna`.', words).includes('backtick'));
  assert.ok(technicalFindings('Versione a1b2c3d salvata.', words).some((f) => f.startsWith('code: ')));
  assert.ok(technicalFindings('Ora è la 0.2.0.', words).includes('version number: 0.2.0'));
  assert.ok(technicalFindings('Il framework è aggiornato.', words).includes('word: framework'));
});

test('paragraphsOf and the update question use the last paragraph', () => {
  assert.deepEqual(paragraphsOf('Uno.\n\n\nDue.\n\n'), ['Uno.', 'Due.']);
  assert.equal(asksToUpdate('Vuoi aggiornare adesso?'), true);
  assert.equal(asksToUpdate('Ricordo domani. Nessuna domanda.'), false);
});

test('todayDates has the UTC date of the instant, and no duplicates', () => {
  const dates = todayDates(new Date('2026-11-09T12:00:00Z'));
  assert.ok(dates.includes(TODAY));
  assert.equal(new Set(dates).size, dates.length);
});

test('parseCaseData accepts the three update cases and refuses mismatches', () => {
  const ok = parseCaseData({ case: 'update-declined', scenario: 'declined', prompt: 'x' });
  assert.equal(ok.scenario, 'declined');
  assert.throws(() => parseCaseData({ case: 'update-declined', scenario: 'stale-campaign', prompt: 'x' }), /needs scenario declined/);
  assert.throws(() => parseCaseData({ case: 'update-x', scenario: 'stale-campaign', prompt: 'x' }), /unknown case/);
  assert.throws(() => parseCaseData({ case: 'update-declined', scenario: 'other', prompt: 'x' }), /unknown scenario/);
  assert.throws(() => parseCaseData({ case: 'update-declined', scenario: 'declined' }), /prompt missing/);
});

// ---------------------------------------------------------------- stale-campaign

test('gradeStale passes when the update ran, saved one version and kept the master text', () => {
  const dir = staleFolder();
  try {
    const results = gradeStale({ dir, setup: STALE_SETUP, report: 'Ciao! La campagna è pronta a ripartire.' });
    assert.deepEqual(failing(results), [], JSON.stringify(results));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gradeStale fails each check that the update broke', () => {
  const cases = [
    ['S1', staleFolder({ files: { ...STALE_FILES(), '.campaign/version.yaml': VERSION_YAML.replace(INSTALLED, '0.0.1') } })],
    ['S2', staleFolder({ files: { ...STALE_FILES(), '.campaign/instructions/agent.md': `Regole.\n${MARKER}\n` } })],
    ['S3', staleFolder({ files: { ...STALE_FILES(), '.campaign/customizations.md': 'Altro testo.\n' } })],
    ['S4', staleFolder({ addSecond: false })],
  ];
  for (const [id, dir] of cases) {
    try {
      const results = gradeStale({ dir, setup: STALE_SETUP, report: 'Ciao!' });
      assert.ok(failing(results).includes(id), `${id} should fail: ${JSON.stringify(results)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('gradeStale fails the technical words in the final message (S5)', () => {
  const dir = staleFolder();
  try {
    const results = gradeStale({ dir, setup: STALE_SETUP, report: 'Il framework è aggiornato alla 0.1.0.' });
    assert.deepEqual(failing(results), ['S5']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- newer-published

test('gradeNewer passes an answer with a question about updating and nothing changed', () => {
  const dir = quietFolder();
  try {
    const report = 'Teodo Marr è il fabbro del villaggio.\n\nVuoi che aggiorni la campagna alla nuova versione?';
    const results = gradeNewer({ dir, setup: NEWER_SETUP, report, todays: [TODAY] });
    assert.deepEqual(failing(results), [], JSON.stringify(results));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gradeNewer fails when the question is missing, a version number is outside the last note, or the notice is missing', () => {
  const dir = quietFolder({ notice: null });
  try {
    const noQuestion = gradeNewer({ dir, setup: NEWER_SETUP, report: 'Teodo Marr è il fabbro.\n\nTutto bene.', todays: [TODAY] });
    assert.ok(failing(noQuestion).includes('N2'));
    assert.ok(failing(noQuestion).includes('N4'));
    const versionFirst = gradeNewer({
      dir,
      setup: NEWER_SETUP,
      report: 'Teodo Marr, versione 0.2.0 disponibile.\n\nVuoi aggiornare?',
      todays: [TODAY],
    });
    assert.ok(failing(versionFirst).includes('N3'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gradeNewer fails when the version changed or a version was saved (N5)', () => {
  const dir = quietFolder({ version: VERSION_YAML.replace(INSTALLED, '0.0.1') });
  try {
    const results = gradeNewer({
      dir,
      setup: NEWER_SETUP,
      report: 'Teodo Marr è il fabbro.\n\nVuoi aggiornare?',
      todays: [TODAY],
    });
    assert.deepEqual(failing(results), ['N5']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- declined

test('gradeDeclined passes an acknowledgement that does not ask again', () => {
  const dir = quietFolder();
  try {
    const results = gradeDeclined({ dir, setup: NEWER_SETUP, report: 'Certo, lo ricordo per domani.' });
    assert.deepEqual(failing(results), [], JSON.stringify(results));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gradeDeclined fails when the update is asked again or a version was saved', () => {
  const dir = quietFolder();
  addCommit(dir);
  try {
    const results = gradeDeclined({ dir, setup: NEWER_SETUP, report: 'Certo. Vuoi aggiornare adesso?' });
    assert.deepEqual(failing(results), ['D1', 'D3']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gradeDeclined fails when the message does not acknowledge the postponement (D2)', () => {
  const dir = quietFolder();
  try {
    const results = gradeDeclined({ dir, setup: NEWER_SETUP, report: 'Teodo Marr è il fabbro del villaggio.' });
    assert.deepEqual(failing(results), ['D2']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- dispatch

test('gradeScenario turns the results into checks, failures and the notice', () => {
  const dir = quietFolder();
  try {
    const graded = gradeScenario({
      scenario: 'declined',
      dir,
      setup: NEWER_SETUP,
      report: 'Certo, lo ricordo per domani.',
      todays: [TODAY],
    });
    assert.equal(graded.pass, true);
    assert.deepEqual(graded.failures, []);
    assert.deepEqual(graded.technical_found, []);
    assert.equal(graded.notice.last_notified_on, TODAY);
    const noReport = gradeScenario({ scenario: 'declined', dir, setup: NEWER_SETUP, report: null, todays: [TODAY] });
    assert.equal(noReport.pass, false);
    assert.equal(noReport.technical_found, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
