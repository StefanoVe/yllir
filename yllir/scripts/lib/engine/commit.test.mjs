import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorldIndex } from '../world-graph.mjs';
import { DRAFT_DIR, checkBatch, commitBatch } from './commit.mjs';
import { ensureRepo } from '../versions.mjs';
import { toCommentMetadata } from '../frontmatter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../../../../testbench/fixtures/morvalle-legacy/campaign');

const MIRA_PATH = 'Personaggi/Mira Sanna.md';
const MIRA = `---
id: mira-sanna
template: npc
location: [borgo-cenere]
kind: character
provenance: master
---
# Mira Sanna

## Ruolo

Sarta del borgo. Lavora ai mantelli di lana e conosce Lino Valdes dal molo.

## Aspetto e modi

_Una donna minuta, con le dita sempre punte da aghi._

Parla poco e guarda negli occhi chi le parla.

## Al tavolo

Può cucire un mantello per il gruppo in cambio di pelli di capra.

<!-- master -->
## Master

### Indicazioni per il master

Non sa nulla del pozzo.
<!-- /master -->
`;

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

/** A fresh copy of the morvalle campaign, as a git repository with one commit. */
function makeCampaign(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(FIXTURE, dir, { recursive: true, verbatimSymlinks: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Test Master']);
  git(dir, ['config', 'user.email', 'master@test.invalid']);
  ensureRepo(dir);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'fixture']);
  return dir;
}

function head(dir) {
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

function commitCount(dir) {
  return Number(git(dir, ['rev-list', '--count', 'HEAD']).trim());
}

function writeDraft(dir, rel, text) {
  const full = path.join(dir, DRAFT_DIR, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function writeReview(dir, outcome = 'APPLY') {
  const full = path.join(dir, '.campaign/state/engine/review.json');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify({ outcome, reason: 'test review' })}\n`);
  return full;
}

function writeCheck(dir, record) {
  const full = path.join(dir, '.campaign/state/engine/check.json');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify(record, null, 2)}\n`);
}

function readAt(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function engineTempDirs(tmp = os.tmpdir()) {
  return fs.readdirSync(tmp).filter((name) => name.startsWith('yllir-engine-')).sort();
}

test('a new character sheet passes check, is written, linked, saved as one version and loses its draft', async (t) => {
  const dir = makeCampaign(t);
  const before = commitCount(dir);
  writeDraft(dir, MIRA_PATH, MIRA);

  const check = await checkBatch(dir, { files: [MIRA_PATH] });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  assert.equal(check.reviewRequired, true);
  assert.deepEqual(check.finalFiles, ['Personaggi/Morvalle/Borgo Cenere/Mira Sanna.md']);
  assert.ok(fs.existsSync(path.join(dir, '.campaign/state/engine/check.json')));

  writeReview(dir);
  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna', note: 'test' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.saved && /^[0-9a-f]+$/.test(result.saved.hash));
  assert.equal(commitCount(dir), before + 1);

  const finalPath = result.finalFiles[0];
  const written = readAt(dir, finalPath);
  assert.match(written, /\[Lino Valdes\]\(\.\.\/Lago%20Grigio\/Lino%20Valdes\.md\)/);
  assert.equal(fs.existsSync(path.join(dir, DRAFT_DIR, MIRA_PATH)), false);
  assert.equal(fs.existsSync(path.join(dir, '.campaign/state/engine/review.json')), false);
  assert.equal(git(dir, ['status', '--porcelain']).trim(), '');
});

test('the work note is written after the save and names the saved version', async (t) => {
  const dir = makeCampaign(t);
  writeDraft(dir, MIRA_PATH, MIRA);
  await checkBatch(dir, { files: [MIRA_PATH] });
  writeReview(dir);
  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna', note: 'next: the well' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  const note = readAt(dir, '.campaign/state/work-note.md');
  const lines = note.trim().split('\n');
  assert.equal(lines[0], '# Work in progress');
  assert.match(lines[1], /^updated: \d{4}-\d{2}-\d{2}T/);
  assert.equal(lines[2], `last saved: ${result.saved.hash} Add Mira Sanna`);
  assert.equal(lines[3], `files: ${result.finalFiles.join(', ')}`);
  assert.equal(lines[4], 'note: next: the well');
});

test('the drafts and the work state are never part of a saved version', async (t) => {
  const dir = makeCampaign(t);
  writeDraft(dir, MIRA_PATH, MIRA);
  await checkBatch(dir, { files: [MIRA_PATH] });
  writeReview(dir);
  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const tracked = git(dir, ['ls-files']).split('\n');
  assert.equal(tracked.some((file) => file.startsWith('.campaign/drafts/') || file.startsWith('.campaign/state/')), false);
});

test('commit without review.json fails with review-missing and writes nothing', async (t) => {
  const dir = makeCampaign(t);
  const commitBefore = head(dir);
  writeDraft(dir, MIRA_PATH, MIRA);
  const check = await checkBatch(dir, { files: [MIRA_PATH] });
  assert.equal(check.ok, true);

  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.code), ['review-missing']);
  assert.equal(result.saved, null);
  assert.equal(head(dir), commitBefore);
  assert.equal(fs.existsSync(path.join(dir, 'Personaggi/Morvalle/Borgo Cenere/Mira Sanna.md')), false);
  assert.equal(fs.existsSync(path.join(dir, DRAFT_DIR, MIRA_PATH)), true);
});

test('a review older than the check fails with review-missing', async (t) => {
  const dir = makeCampaign(t);
  const commitBefore = head(dir);
  writeDraft(dir, MIRA_PATH, MIRA);
  await checkBatch(dir, { files: [MIRA_PATH] });
  const review = writeReview(dir);
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(review, old, old);

  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.code), ['review-missing']);
  assert.equal(head(dir), commitBefore);
});

test('a review that does not say APPLY fails with review-missing', async (t) => {
  const dir = makeCampaign(t);
  const commitBefore = head(dir);
  writeDraft(dir, MIRA_PATH, MIRA);
  await checkBatch(dir, { files: [MIRA_PATH] });
  writeReview(dir, 'REJECT');
  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna' });
  assert.deepEqual(result.errors.map((e) => e.code), ['review-missing']);
  assert.equal(head(dir), commitBefore);
});

test('changing a draft after check fails with review-missing (hash mismatch)', async (t) => {
  const dir = makeCampaign(t);
  const commitBefore = head(dir);
  writeDraft(dir, MIRA_PATH, MIRA);
  await checkBatch(dir, { files: [MIRA_PATH] });
  writeReview(dir);
  writeDraft(dir, MIRA_PATH, `${MIRA}\nUna riga in più.\n`);

  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.code), ['review-missing']);
  assert.equal(head(dir), commitBefore);
});

test('a draft with an unknown relation target gives a world-graph error and nothing is written', async (t) => {
  const dir = makeCampaign(t);
  const commitBefore = head(dir);
  const broken = MIRA.replace('kind: character\n', 'kind: character\nrelations:\n  - to: fantasma-inesistente\n    type: ally-of\n');
  writeDraft(dir, MIRA_PATH, broken);

  const check = await checkBatch(dir, { files: [MIRA_PATH] });
  assert.equal(check.ok, false);
  const error = check.errors.find((e) => e.code === 'unknown-reference');
  assert.ok(error, JSON.stringify(check.errors));
  assert.equal(error.file, 'Personaggi/Morvalle/Borgo Cenere/Mira Sanna.md');
  assert.ok(error.message.includes('fantasma-inesistente'));

  // A check that passed earlier (written by hand here) must not let the commit skip its own evaluation.
  writeCheck(dir, { draftsHash: check.draftsHash, ok: true, reviewRequired: true, finalFiles: check.finalFiles, checkedAt: new Date().toISOString() });
  writeReview(dir);
  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'unknown-reference'), JSON.stringify(result.errors));
  assert.equal(head(dir), commitBefore);
  assert.equal(fs.existsSync(path.join(dir, 'Personaggi/Morvalle/Borgo Cenere/Mira Sanna.md')), false);
  assert.equal(fs.existsSync(path.join(dir, DRAFT_DIR, MIRA_PATH)), true);
});

test('errors that already exist in the campaign do not block the batch', async (t) => {
  const dir = makeCampaign(t);
  // The fixture already has world errors (missing kind and provenance in older sheets).
  assert.ok(buildWorldIndex(dir).errors.length > 0);
  writeDraft(dir, MIRA_PATH, MIRA);
  const check = await checkBatch(dir, { files: [MIRA_PATH] });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  writeReview(dir);
  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('a draft written with a dashes block is saved in the comment form', async (t) => {
  const dir = makeCampaign(t);
  writeDraft(dir, MIRA_PATH, MIRA);
  const check = await checkBatch(dir, { files: [MIRA_PATH] });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  writeReview(dir);
  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  const saved = readAt(dir, result.finalFiles[0]);
  assert.ok(saved.startsWith('<!-- yllir\n'), saved.slice(0, 40));
  assert.match(saved, /^id: mira-sanna$/m);
  assert.match(saved, /^-->$/m);
  assert.doesNotMatch(saved, /^---$/m);
});

test('a file edited by hand outside the batch is saved as a manual version and its provenance becomes master', async (t) => {
  const dir = makeCampaign(t);
  // A generated document, committed as the starting state.
  const rel = 'Storia/Voce del Pozzo.md';
  const original = readAt(dir, rel);
  fs.writeFileSync(path.join(dir, rel), original.replace('\n---\n', '\nprovenance: generated\n---\n'));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'generated state']);
  const before = commitCount(dir);

  // The master edits it by hand, without saving.
  fs.writeFileSync(path.join(dir, rel), `${readAt(dir, rel)}\nUna nota scritta a mano.\n`);

  writeDraft(dir, MIRA_PATH, MIRA);
  await checkBatch(dir, { files: [MIRA_PATH] });
  writeReview(dir);
  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.manualChanges, [rel]);
  assert.equal(commitCount(dir), before + 2, 'one manual version and one framework version');

  const text = readAt(dir, rel);
  assert.match(text, /^provenance: master$/m);
  assert.doesNotMatch(text, /provenance: generated/);
  assert.match(text, /Una nota scritta a mano\./);
  const manualSubject = git(dir, ['log', '-n', '1', '--format=%s', 'HEAD~1']).trim();
  assert.equal(manualSubject, 'Modifiche fatte a mano');
});

test('a hand edit to a comment-form document makes its provenance master', async (t) => {
  const dir = makeCampaign(t);
  const rel = 'Storia/Voce del Pozzo.md';
  const commentForm = toCommentMetadata(readAt(dir, rel));
  assert.notEqual(commentForm, null, 'the fixture document starts with a dashes block');
  fs.writeFileSync(path.join(dir, rel), commentForm.replace('\n-->\n', '\nprovenance: generated\n-->\n'));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'generated state in comment form']);
  const before = commitCount(dir);

  fs.writeFileSync(path.join(dir, rel), `${readAt(dir, rel)}\nUna nota scritta a mano.\n`);

  writeDraft(dir, MIRA_PATH, MIRA);
  await checkBatch(dir, { files: [MIRA_PATH] });
  writeReview(dir);
  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.manualChanges, [rel]);
  assert.equal(commitCount(dir), before + 2, 'one manual version and one framework version');

  const text = readAt(dir, rel);
  assert.ok(text.startsWith('<!-- yllir\n'));
  assert.match(text, /^provenance: master$/m);
  assert.doesNotMatch(text, /provenance: generated/);
  assert.match(text, /Una nota scritta a mano\./);
});

test('a file edited by hand inside the batch is saved, refused with manual-change, and redrafted', async (t) => {
  const dir = makeCampaign(t);
  const rel = 'Personaggi/Fosco il Ramaio.md';
  const before = commitCount(dir);
  writeDraft(dir, rel, readAt(dir, rel).replace('Ripete i prezzi due volte', 'Ripete i prezzi tre volte'));
  fs.writeFileSync(path.join(dir, rel), `${readAt(dir, rel)}\nNota a mano.\n`);

  // The check reports the conflict without saving anything.
  const check = await checkBatch(dir, { files: [rel] });
  assert.equal(check.ok, false);
  assert.deepEqual(check.errors.map((e) => e.code), ['manual-change']);
  assert.equal(commitCount(dir), before);

  // The first commit saves the hand edit as a manual version, then refuses the stale draft.
  writeReview(dir);
  const first = await commitBatch(dir, { files: [rel], message: 'Revise Fosco' });
  assert.equal(first.ok, false);
  assert.deepEqual(first.errors.map((e) => e.code), ['manual-change']);
  assert.equal(first.errors[0].file, rel);
  assert.equal(first.errors[0].message, 'changed by hand since the last saved version: read it again and redo the draft');
  assert.equal(first.saved, null);
  assert.deepEqual(first.manualChanges, [rel]);
  assert.equal(commitCount(dir), before + 1);
  assert.equal(git(dir, ['log', '-n', '1', '--format=%s']).trim(), 'Modifiche fatte a mano');
  assert.match(readAt(dir, rel), /Nota a mano\./);

  // After the author reads the file again and redrafts it, the batch goes through.
  writeDraft(dir, rel, readAt(dir, rel).replace('Ripete i prezzi due volte', 'Ripete i prezzi tre volte'));
  const again = await checkBatch(dir, { files: [rel] });
  assert.equal(again.ok, true, JSON.stringify(again.errors));
  writeReview(dir);
  const second = await commitBatch(dir, { files: [rel], message: 'Revise Fosco' });
  assert.equal(second.ok, true, JSON.stringify(second.errors));
  assert.deepEqual(second.manualChanges, []);
  assert.match(readAt(dir, second.finalFiles[0]), /Ripete i prezzi tre volte/);
  assert.match(readAt(dir, second.finalFiles[0]), /Nota a mano\./);
});

test('a delete removes the file and is saved after its review', async (t) => {
  const dir = makeCampaign(t);
  const rel = 'Appunti/Idee.md';
  assert.ok(fs.existsSync(path.join(dir, rel)));

  const check = await checkBatch(dir, { deletes: [rel] });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  assert.equal(check.reviewRequired, true);

  writeReview(dir);
  const result = await commitBatch(dir, { deletes: [rel], message: 'Remove the notes' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(fs.existsSync(path.join(dir, rel)), false);
  assert.equal(git(dir, ['ls-files', rel]).trim(), '');
});

test('a delete of a missing file is refused with missing-file', async (t) => {
  const dir = makeCampaign(t);
  const check = await checkBatch(dir, { deletes: ['Appunti/Non esiste.md'] });
  assert.equal(check.ok, false);
  assert.deepEqual(check.errors.map((e) => e.code), ['missing-file']);
});

test('a missing draft and a path outside the campaign rules are refused by check', async (t) => {
  const dir = makeCampaign(t);
  const missing = await checkBatch(dir, { files: [MIRA_PATH] });
  assert.deepEqual(missing.errors.map((e) => e.code), ['missing-draft']);

  writeDraft(dir, '../escape.md', MIRA);
  const escape = await checkBatch(dir, { files: ['../escape.md'] });
  assert.deepEqual(escape.errors.map((e) => e.code), ['bad-path']);

  const notMarkdown = await checkBatch(dir, { files: ['Personaggi/note.txt'] });
  assert.deepEqual(notMarkdown.errors.map((e) => e.code), ['bad-path']);
});

test('the temporary copy is removed after check and after commit', async (t) => {
  // A private folder for the copies: other processes use the shared temp folder at the same time.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-tmp-'));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  const dir = makeCampaign(t);
  writeDraft(dir, MIRA_PATH, MIRA);
  await checkBatch(dir, { files: [MIRA_PATH], tmpRoot });
  assert.deepEqual(engineTempDirs(tmpRoot), []);
  writeReview(dir);
  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna', tmpRoot });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(engineTempDirs(tmpRoot), []);
});

test('a campaign that is not a git repository is refused without writing', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-test-nogit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(FIXTURE, dir, { recursive: true, verbatimSymlinks: true });
  writeDraft(dir, MIRA_PATH, MIRA);

  const check = await checkBatch(dir, { files: [MIRA_PATH] });
  assert.deepEqual(check.errors.map((e) => e.code), ['no-git']);
  assert.equal(fs.existsSync(path.join(dir, '.campaign/state/engine/check.json')), false);

  const commit = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna' });
  assert.deepEqual(commit.errors.map((e) => e.code), ['no-git']);
  assert.equal(fs.existsSync(path.join(dir, MIRA_PATH)), false);
});

test('bad arguments are programming errors and throw', async (t) => {
  const dir = makeCampaign(t);
  await assert.rejects(commitBatch(dir, { files: [], message: '' }), TypeError);
  await assert.rejects(commitBatch(dir, { files: [], message: undefined }), TypeError);
  await assert.rejects(checkBatch(dir, { files: 'Personaggi/Mira Sanna.md' }), TypeError);
  await assert.rejects(checkBatch('', {}), TypeError);
});

test('a source placed by a framework script is saved without being a manual change', async (t) => {
  const dir = makeCampaign(t);
  const rel = 'Appunti/Trascrizione.md';
  fs.writeFileSync(path.join(dir, rel), '# Trascrizione\n\nTesto trascritto dalla foto.\n');
  const check = await checkBatch(dir, { sources: [rel] });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  assert.equal(check.reviewRequired, true, 'a Markdown source needs the review');
  writeReview(dir);
  const result = await commitBatch(dir, { sources: [rel], message: 'Import the transcription' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.manualChanges, []);
  assert.equal(git(dir, ['ls-files', rel]).trim(), rel);
});

test('a non-Markdown source needs no review', async (t) => {
  const dir = makeCampaign(t);
  const rel = 'Storia/scansione.txt';
  fs.writeFileSync(path.join(dir, rel), 'Trascrizione grezza.\n');
  const check = await checkBatch(dir, { sources: [rel] });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  assert.equal(check.reviewRequired, false);
  assert.equal(check.layoutOnly, false);
  const result = await commitBatch(dir, { sources: [rel], message: 'Keep the scan' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(git(dir, ['ls-files', rel]).trim(), rel);
});

test('a missing source is refused with missing-source', async (t) => {
  const dir = makeCampaign(t);
  const check = await checkBatch(dir, { sources: ['Appunti/Assente.md'] });
  assert.equal(check.ok, false);
  assert.deepEqual(check.errors.map((e) => e.code), ['missing-source']);
});

test('a source changed after check fails with review-missing (hash covers the source content)', async (t) => {
  const dir = makeCampaign(t);
  const rel = 'Appunti/Trascrizione.md';
  const commitBefore = head(dir);
  fs.writeFileSync(path.join(dir, rel), '# Trascrizione\n\nPrima versione.\n');
  await checkBatch(dir, { sources: [rel] });
  fs.writeFileSync(path.join(dir, rel), '# Trascrizione\n\nSeconda versione.\n');
  writeReview(dir);
  const result = await commitBatch(dir, { sources: [rel], message: 'Import the transcription' });
  assert.deepEqual(result.errors.map((e) => e.code), ['review-missing']);
  assert.equal(head(dir), commitBefore);
});

test('a layout-only commit applies the pending geographic moves without review', async (t) => {
  const dir = makeCampaign(t);
  // The fixture is not laid out yet: the layout has pending moves.
  const check = await checkBatch(dir, {});
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  assert.equal(check.reviewRequired, false);
  assert.equal(check.layoutOnly, true);

  const before = commitCount(dir);
  const result = await commitBatch(dir, { message: 'Apply the geographic layout' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.reviewRequired, false);
  assert.equal(result.layoutOnly, true);
  assert.ok(result.saved);
  assert.equal(commitCount(dir), before + 1);
  assert.ok(fs.existsSync(path.join(dir, 'Creature/Morvalle/Capra cinerina.md')));
  assert.equal(fs.existsSync(path.join(dir, 'Creature/Capra cinerina.md')), false);
  assert.deepEqual(result.manualChanges, []);
});

test('check reports a hand edit of a batch file without saving it', async (t) => {
  const dir = makeCampaign(t);
  const rel = 'Personaggi/Fosco il Ramaio.md';
  const before = commitCount(dir);
  writeDraft(dir, rel, readAt(dir, rel));
  fs.writeFileSync(path.join(dir, rel), `${readAt(dir, rel)}\nNota a mano.\n`);
  const check = await checkBatch(dir, { files: [rel] });
  assert.equal(check.ok, false);
  assert.deepEqual(check.errors.map((e) => e.code), ['manual-change']);
  assert.equal(commitCount(dir), before);
  assert.notEqual(git(dir, ['status', '--porcelain']).trim(), '');
});

test('the ignore rules that ensureRepo adds belong to the framework version, not to hand edits', async (t) => {
  const dir = makeCampaign(t);
  // An older campaign: the ignore file has none of the current rules, and nothing else is hand-edited.
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'older rules']);
  const before = commitCount(dir);
  writeDraft(dir, MIRA_PATH, MIRA);
  await checkBatch(dir, { files: [MIRA_PATH] });
  writeReview(dir);
  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.manualChanges, []);
  assert.equal(commitCount(dir), before + 1, 'no manual version when the master changed nothing');
  assert.match(git(dir, ['show', '-s', '--format=%B', 'HEAD']), /Yllir-Kind: framework/);
  assert.match(git(dir, ['show', 'HEAD:.gitignore']), /\.campaign\/drafts\//);
});

test('a .gitignore that the master edited by hand is a manual change', async (t) => {
  const dir = makeCampaign(t);
  const before = commitCount(dir);
  fs.appendFileSync(path.join(dir, '.gitignore'), 'bozze-locali/\n');
  writeDraft(dir, MIRA_PATH, MIRA);
  await checkBatch(dir, { files: [MIRA_PATH] });
  writeReview(dir);
  const result = await commitBatch(dir, { files: [MIRA_PATH], message: 'Add Mira Sanna' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.manualChanges, ['.gitignore']);
  assert.equal(commitCount(dir), before + 2, 'one manual version and one framework version');
  assert.equal(git(dir, ['log', '-n', '1', '--format=%s', 'HEAD~1']).trim(), 'Modifiche fatte a mano');
});

test('a batch that only adds links to a sheet needs no review', async (t) => {
  const dir = makeCampaign(t);
  const rel = 'Cronaca/2026-10-03.md';
  // First batch, with review: a mention of Fosco that is not linked yet (a lowercase name is uncertain).
  const current = fs.readFileSync(path.join(dir, rel), 'utf8');
  const sentence = 'Fosco il Ramaio ha venduto un martello.';
  writeDraft(dir, rel, `${current}\n${sentence}\n`);
  const first = await checkBatch(dir, { files: [rel] });
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  assert.equal(first.reviewRequired, true);
  writeReview(dir);
  const committed = await commitBatch(dir, { files: [rel], message: 'Add a sentence' });
  assert.equal(committed.ok, true, JSON.stringify(committed.errors));
  const finalPath = committed.finalFiles[0];
  const sentenceAt = (text) => text.indexOf(sentence);
  assert.ok(sentenceAt(readAt(dir, finalPath)) >= 0);

  // Second batch, no review: the same text with a link around the mention.
  const onDisk = readAt(dir, finalPath);
  const target = path.posix.relative(path.posix.dirname(finalPath), 'Personaggi/Morvalle/Borgo Cenere/Fosco il Ramaio.md');
  const linked = onDisk.replace('Fosco il Ramaio ha', `[Fosco il Ramaio](${target.replace(/ /g, '%20')}) ha`);
  assert.notEqual(linked, onDisk);
  writeDraft(dir, finalPath, linked);
  const check = await checkBatch(dir, { files: [finalPath] });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  assert.equal(check.reviewRequired, false);
  const result = await commitBatch(dir, { files: [finalPath], message: 'Link the mention' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.reviewRequired, false);
  assert.match(readAt(dir, finalPath), /\[Fosco il Ramaio\]\(/);

  // A draft that changes text, not only links, still needs the review.
  writeDraft(dir, finalPath, `${readAt(dir, finalPath)}\nUna riga nuova.\n`);
  const textual = await checkBatch(dir, { files: [finalPath] });
  assert.equal(textual.reviewRequired, true);
});

test('a relative symlink to a folder outside the campaign passes check and survives commit', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-ext-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const campaign = path.join(parent, 'campaign');
  fs.mkdirSync(path.join(parent, 'outside/World'), { recursive: true });
  fs.writeFileSync(path.join(parent, 'outside/World/Place.md'), '# Place\n\nA place outside the campaign.\n');
  fs.cpSync(FIXTURE, campaign, { recursive: true, verbatimSymlinks: true });
  git(campaign, ['init', '-q', '-b', 'main']);
  git(campaign, ['config', 'user.name', 'Test Master']);
  git(campaign, ['config', 'user.email', 'master@test.invalid']);
  fs.mkdirSync(path.join(campaign, 'Sources'));
  fs.symlinkSync('../../outside/World', path.join(campaign, 'Sources/World'));
  const yamlPath = path.join(campaign, 'campaign.yaml');
  const yaml = fs.readFileSync(yamlPath, 'utf8');
  const structureEnd = '    folder: Appunti\n    type: notes\n';
  if (!yaml.includes(structureEnd)) throw new Error('structure anchor');
  fs.writeFileSync(yamlPath, yaml.replace(structureEnd, structureEnd + '  - id: fonti\n    folder: Sources/World\n    type: external\n'));
  ensureRepo(campaign);
  git(campaign, ['add', '-A']);
  git(campaign, ['commit', '-q', '-m', 'fixture']);

  writeDraft(campaign, MIRA_PATH, MIRA);
  const check = await checkBatch(campaign, { files: [MIRA_PATH] });
  assert.equal(check.ok, true, JSON.stringify(check.errors));

  writeReview(campaign);
  const result = await commitBatch(campaign, { files: [MIRA_PATH], message: 'Add Mira Sanna', note: 'test' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(fs.readlinkSync(path.join(campaign, 'Sources/World')), '../../outside/World');
});
