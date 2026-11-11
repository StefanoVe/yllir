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
  eventFileName,
  frameworkVersionOf,
  gradeDeclined,
  gradeLegacy,
  gradeNewer,
  gradeScenario,
  gradeStale,
  neverSayWords,
  nextMinorVersion,
  paragraphsOf,
  parseCaseData,
  setFrameworkVersion,
  setupScenario,
  technicalFindings,
  todayDates,
  toLegacyLayout,
  withIsolatedGit,
} from './run-update-case.mjs';
import { updateCampaign } from '../../yllir/skills/library/update/scripts/lib/update-campaign.mjs';
import { checkLinks } from '../../yllir/scripts/lib/links/check-links.mjs';
import { parseFrontmatter } from '../../yllir/scripts/lib/frontmatter.mjs';

const LEXICON = path.resolve(import.meta.dirname, '..', '..', 'yllir', 'skills', 'core', 'yllir', 'lexicon.md');
const FIXTURE = path.resolve(import.meta.dirname, '..', 'fixtures', 'morvalle-legacy', 'campaign');
const LEGACY_SESSIONS = ['Sessione 1', 'Sessione 2', 'Sessione 3'];
const LEGACY_REPORT = 'Ciao! La campagna è pronta a ripartire.';
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

/**
 * Adds one commit that changes a note file, so the folder has one more commit. With a kind, the commit
 * is a saved version with that Yllir-Kind trailer, as saveVersion writes it.
 */
function addCommit(dir, { subject = 'two', kind = null } = {}) {
  fs.writeFileSync(path.join(dir, 'nota.md'), `nota ${Math.random()}\n`);
  git(dir, ['add', '-A']);
  const args = ['commit', '-qm', subject];
  if (kind !== null) args.push('-m', `Yllir-Kind: ${kind}`);
  git(dir, args);
}

/** The failing check ids of a list of [id, ok, reasons] tuples. */
const failing = (results) => results.filter(([, ok]) => !ok).map(([id]) => id);

const FIXTURE_CONFIG = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', '..', 'testbench', 'fixtures', 'morvalle-legacy', 'campaign', 'campaign.yaml'),
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
  if (addSecond) addCommit(dir, { subject: 'Updated Yllir to 0.1.0', kind: 'framework' });
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

test('parseCaseData accepts the legacy-sessions case', () => {
  const ok = parseCaseData({ case: 'update-legacy-sessions', scenario: 'legacy-sessions', prompt: 'x' });
  assert.equal(ok.scenario, 'legacy-sessions');
  assert.throws(() => parseCaseData({ case: 'update-legacy-sessions', scenario: 'stale-campaign', prompt: 'x' }), /needs scenario legacy-sessions/);
});

test('eventFileName removes only the characters a file name cannot hold', () => {
  assert.equal(eventFileName("L'arrivo a Borgo Cenere"), "L'arrivo a Borgo Cenere");
  assert.equal(eventFileName('A/b\\c:d*e?f"g<h>i|j'), 'Abcdefghij');
});

// ---------------------------------------------------------------- legacy-sessions

test('toLegacyLayout writes the old session files and removes the session folders', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'update-legacy-test-'));
  try {
    const dir = path.join(tmp, 'campaign');
    fs.cpSync(FIXTURE, dir, { recursive: true });
    const layout = toLegacyLayout(dir);
    assert.deepEqual(layout.sessionIds, [
      'la-cenere-che-canta-01',
      'la-cenere-che-canta-02',
      'la-cenere-che-canta-03',
    ]);
    assert.deepEqual(Object.keys(layout.scenes), LEGACY_SESSIONS);
    assert.deepEqual(
      layout.scenes['Sessione 2'].map((scene) => scene.title),
      ['Verso il pozzo'],
    );
    for (const session of LEGACY_SESSIONS) {
      assert.equal(fs.existsSync(path.join(dir, 'Trama', session)), false, `${session} folder is still there`);
    }
    const old = path.join(dir, layout.oldFiles[1]);
    assert.equal(layout.oldFiles[1], 'Trama/La cenere che canta/Sessione 2.md');
    const text = fs.readFileSync(old, 'utf8');
    assert.deepEqual(parseFrontmatter(text).data, {
      id: 'la-cenere-che-canta-02',
      depends_on: ['la-cenere-che-canta-01'],
      location: ['pozzo-di-narem'],
    });
    assert.match(text, /^# Verso il pozzo\n\n_Il sentiero sale tra betulle/m);
    assert.match(text, /^Il gruppo sale verso il pozzo con la luce del mattino\./m);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/** Relative link targets (without #anchor) of a Markdown text, outside fenced code blocks. */
function relativeTargets(text) {
  const targets = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || target.startsWith('#')) continue;
      targets.push(target.split('#')[0]);
    }
  }
  return targets;
}

/** Every relative link of the old files resolves to an existing file of the campaign. */
function assertOldLinksResolve(dir, oldFiles) {
  for (const old of oldFiles) {
    const text = fs.readFileSync(path.join(dir, old), 'utf8');
    for (const target of relativeTargets(text)) {
      const abs = path.join(dir, path.posix.dirname(old), decodeURIComponent(target));
      assert.ok(fs.existsSync(abs), `${old}: link ${target} does not resolve`);
    }
  }
}

test('toLegacyLayout rebases the event links to the folder of the old file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'update-legacy-links-test-'));
  try {
    const dir = path.join(tmp, 'campaign');
    fs.cpSync(FIXTURE, dir, { recursive: true });
    const eventFile = path.join(dir, 'Trama', 'Sessione 3', 'Eventi', "L'arrivo a Borgo Cenere.md");
    assert.match(fs.readFileSync(eventFile, 'utf8'), /\]\(\.\.\/\.\.\/\.\.\/Personaggi\/Oria%20Valdes\.md\)/);
    const layout = toLegacyLayout(dir);
    const oldFile = layout.oldFiles.find((file) => file.endsWith('Sessione 3.md'));
    const old = fs.readFileSync(path.join(dir, oldFile), 'utf8');
    assert.ok(old.includes('](../../Personaggi/Oria%20Valdes.md)'), 'link not rebased');
    assert.equal(old.includes('../../../Personaggi'), false);
    // the grading keeps the original (new-layout) body
    const scene = layout.scenes['Sessione 3'].find((s) => s.title === "L'arrivo a Borgo Cenere");
    assert.ok(scene.body.includes('](../../../Personaggi/Oria%20Valdes.md)'));
    assertOldLinksResolve(dir, layout.oldFiles);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('toLegacyLayout puts a session without arc directly in the category folder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'update-legacy-noarc-test-'));
  try {
    const dir = path.join(tmp, 'campaign');
    fs.cpSync(FIXTURE, dir, { recursive: true });
    const main = path.join(dir, 'Trama', 'Sessione 1', 'Sessione 1.md');
    const before = fs.readFileSync(main, 'utf8');
    const after = before.replace(/^arc: .*\n/m, '');
    assert.notEqual(after, before, 'the arc line was not found');
    fs.writeFileSync(main, after);
    const layout = toLegacyLayout(dir);
    assert.equal(layout.oldFiles[0], 'Trama/Sessione 1.md');
    assert.equal(fs.existsSync(path.join(dir, 'Trama', 'Sessione 1.md')), true);
    assert.equal(fs.existsSync(path.join(dir, 'Trama', 'none')), false, 'a folder named none was made');
    assert.equal(fs.existsSync(path.join(dir, 'Trama', 'La cenere che canta', 'Sessione 1.md')), false);
    assert.equal(parseFrontmatter(fs.readFileSync(path.join(dir, layout.oldFiles[0]), 'utf8')).data.id, 'la-cenere-che-canta-01');
    assertOldLinksResolve(dir, layout.oldFiles);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/** A campaign in the old layout, saved, then migrated by the real update. Remove prepared.tmp when done. */
function migratedFolder() {
  const prepared = setupScenario('legacy-sessions');
  const result = withIsolatedGit(() => updateCampaign(prepared.dir));
  assert.equal(result.status, 'updated', JSON.stringify(result.errors));
  assert.equal(result.migrated.length, LEGACY_SESSIONS.length);
  return prepared;
}

test('the migrated session and event files have no broken link and the links are back at event depth', () => {
  const { tmp, dir, setup } = migratedFolder();
  try {
    const files = [];
    for (const [session, scenes] of Object.entries(setup.scenes)) {
      files.push(`Trama/${session}/${session}.md`);
      for (const scene of scenes) files.push(`Trama/${session}/Eventi/${eventFileName(scene.title)}.md`);
    }
    const { errors } = checkLinks(dir, { files });
    assert.deepEqual(errors, [], JSON.stringify(errors));
    const text = fs.readFileSync(path.join(dir, 'Trama', 'Sessione 3', 'Eventi', "L'arrivo a Borgo Cenere.md"), 'utf8');
    assert.ok(text.includes('](../../../Personaggi/Oria%20Valdes.md)'), 'link not back at event depth');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('gradeLegacy passes a campaign migrated by the real update (L1 to L4)', () => {
  const { tmp, dir, setup } = migratedFolder();
  try {
    const results = gradeLegacy({ dir, setup, report: LEGACY_REPORT });
    assert.deepEqual(failing(results), [], JSON.stringify(results));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('gradeLegacy fails L1 when an event file is missing', () => {
  const { tmp, dir, setup } = migratedFolder();
  try {
    fs.rmSync(path.join(dir, 'Trama', 'Sessione 2', 'Eventi', 'Verso il pozzo.md'));
    const results = gradeLegacy({ dir, setup, report: LEGACY_REPORT });
    assert.ok(failing(results).includes('L1'), JSON.stringify(results));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('gradeLegacy accepts the added links and provenance and kind lines (L3)', () => {
  const { tmp, dir, setup } = migratedFolder();
  try {
    const file = path.join(dir, 'Trama', 'Sessione 2', 'Eventi', 'Verso il pozzo.md');
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.includes('provenance: master'), 'the migration adds provenance');
    const linked = text.replace('Il sentiero si divide', 'Il sentiero [si divide](../../../Luoghi/Pozzo.md)');
    fs.writeFileSync(file, linked.replace('\n---\n', '\nkind: event\n---\n'));
    const results = gradeLegacy({ dir, setup, report: LEGACY_REPORT });
    assert.deepEqual(results.find(([id]) => id === 'L3')[2], [], JSON.stringify(results));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('gradeLegacy fails L3 when a frontmatter line other than provenance or kind changes', () => {
  const { tmp, dir, setup } = migratedFolder();
  try {
    const file = path.join(dir, 'Trama', 'Sessione 2', 'Eventi', 'Verso il pozzo.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('depends_on: []', 'depends_on: [altro]'));
    const results = gradeLegacy({ dir, setup, report: LEGACY_REPORT });
    assert.deepEqual(results.find(([id]) => id === 'L3')[2], ['Verso il pozzo: frontmatter changed']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('gradeLegacy fails L3 when a scene text is altered', () => {
  const { tmp, dir, setup } = migratedFolder();
  try {
    const file = path.join(dir, 'Trama', 'Sessione 2', 'Eventi', 'Verso il pozzo.md');
    const text = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, text.replace('Il gruppo sale verso il pozzo', 'Il gruppo corre verso il pozzo'));
    const results = gradeLegacy({ dir, setup, report: LEGACY_REPORT });
    assert.ok(failing(results).includes('L3'), JSON.stringify(results));
    assert.deepEqual(
      results.find(([id]) => id === 'L3')[2],
      ['Verso il pozzo: text changed'],
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

test('gradeStale accepts the format version and the update version, both framework (S4)', () => {
  const dir = staleFolder({ addSecond: false });
  addCommit(dir, { subject: 'Campaign format update', kind: 'framework' });
  addCommit(dir, { subject: 'Updated Yllir to 0.1.0', kind: 'framework' });
  try {
    const results = gradeStale({ dir, setup: STALE_SETUP, report: 'Ciao!' });
    assert.deepEqual(failing(results), [], JSON.stringify(results));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gradeStale fails S4 when a manual version follows the setup, or no version is the update', () => {
  const manual = staleFolder({ addSecond: false });
  addCommit(manual, { subject: 'Updated Yllir to 0.1.0', kind: 'framework' });
  addCommit(manual, { subject: 'Modifiche a mano', kind: 'manual' });
  const noUpdate = staleFolder({ addSecond: false });
  addCommit(noUpdate, { subject: 'Campaign format update', kind: 'framework' });
  try {
    const first = gradeStale({ dir: manual, setup: STALE_SETUP, report: 'Ciao!' });
    assert.ok(failing(first).includes('S4'), JSON.stringify(first));
    assert.ok(first.find(([id]) => id === 'S4')[2].some((reason) => reason.includes('is manual')));
    const second = gradeStale({ dir: noUpdate, setup: STALE_SETUP, report: 'Ciao!' });
    assert.ok(failing(second).includes('S4'), JSON.stringify(second));
    assert.ok(second.find(([id]) => id === 'S4')[2].some((reason) => reason.includes('Updated Yllir')));
  } finally {
    fs.rmSync(manual, { recursive: true, force: true });
    fs.rmSync(noUpdate, { recursive: true, force: true });
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
