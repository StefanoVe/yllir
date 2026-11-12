import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRepo } from './lib/versions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, 'engine.mjs');
const FIXTURE = path.resolve(here, '../../testbench/fixtures/morvalle-legacy/campaign');
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
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function makeCampaign(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-cli-'));
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

/**
 * Runs the CLI in a child process. Returns the status, the parsed JSON (the output
 * without its last line), and checks that the last line is `exit: <status>`.
 */
function cli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  const match = /^exit: (\d+)\n$/.exec(result.stdout.slice(result.stdout.lastIndexOf('exit: ')));
  assert.ok(match, `last line must be exit: N, got: ${JSON.stringify(result.stdout.slice(-80))}`);
  assert.equal(Number(match[1]), result.status, 'exit line must match the process status');
  const body = result.stdout.replace(/exit: \d+\n$/, '');
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr };
}

function writeDraft(dir, rel, text) {
  const full = path.join(dir, '.campaign/drafts', rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function writeReview(dir) {
  const full = path.join(dir, '.campaign/state/engine/review.json');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify({ outcome: 'APPLY' })}\n`);
}

function assertUsage(result) {
  assert.equal(result.status, 2);
  assert.equal(result.json?.error, 'usage', result.stdout);
}

test('index writes the subject and world indexes and prints the counts with exit 0', (t) => {
  const dir = makeCampaign(t);
  const result = cli(['index', dir]);
  assert.equal(result.status, 0, result.stdout);
  assert.ok(result.json.subjects > 0);
  assert.equal(typeof result.json.errors, 'number');
  assert.equal(typeof result.json.ok, 'boolean');
  assert.ok(fs.existsSync(path.join(dir, '.campaign/cache/subjects.json')));
  assert.ok(fs.existsSync(path.join(dir, '.campaign/cache/world.json')));
});

test('context prints the pack and writes the same JSON under .campaign/state with --out', (t) => {
  const dir = makeCampaign(t);
  const out = '.campaign/state/context.json';
  const result = cli(['context', dir, '--subjects', 'fosco-il-ramaio', '--out', out]);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(typeof result.json, 'object');
  const written = JSON.parse(fs.readFileSync(path.join(dir, out), 'utf8'));
  assert.deepEqual(written, result.json);
});

test('context refuses an --out outside .campaign/state with a usage error', (t) => {
  const dir = makeCampaign(t);
  assertUsage(cli(['context', dir, '--out', 'Appunti/pack.json']));
  assertUsage(cli(['context', dir, '--out', '.campaign/state/../../pack.json']));
  assert.equal(fs.existsSync(path.join(dir, 'Appunti/pack.json')), false);
});

test('check exits 0 for a clean batch and 1 for a refused one', (t) => {
  const dir = makeCampaign(t);
  writeDraft(dir, MIRA_PATH, MIRA);
  const clean = cli(['check', dir, '--files', `${MIRA_PATH}, `]);
  assert.equal(clean.status, 0, clean.stdout);
  assert.equal(clean.json.ok, true);
  assert.equal(clean.json.reviewRequired, true);
  assert.deepEqual(clean.json.finalFiles, ['Personaggi/Morvalle/Borgo Cenere/Mira Sanna.md']);

  const refused = cli(['check', dir, '--files', 'Personaggi/Assente.md']);
  assert.equal(refused.status, 1);
  assert.equal(refused.json.ok, false);
  assert.equal(refused.json.errors[0].code, 'missing-draft');
});

test('commit is refused without review (exit 1), then saves a version (exit 0)', (t) => {
  const dir = makeCampaign(t);
  const before = git(dir, ['rev-list', '--count', 'HEAD']);
  writeDraft(dir, MIRA_PATH, MIRA);
  const args = ['commit', dir, '--files', MIRA_PATH, '--message', 'Add Mira Sanna', '--note', 'from the cli'];

  const refused = cli(args);
  assert.equal(refused.status, 1);
  assert.equal(refused.json.errors[0].code, 'review-missing');
  assert.equal(git(dir, ['rev-list', '--count', 'HEAD']), before);

  cli(['check', dir, '--files', MIRA_PATH]);
  writeReview(dir);
  const saved = cli(args);
  assert.equal(saved.status, 0, saved.stdout);
  assert.equal(saved.json.ok, true);
  assert.ok(saved.json.saved.hash);
  assert.equal(git(dir, ['rev-list', '--count', 'HEAD']), String(Number(before) + 1));
  assert.match(fs.readFileSync(path.join(dir, '.campaign/state/work-note.md'), 'utf8'), /note: from the cli/);
});

test('a layout-only commit needs only --message and applies the pending moves', (t) => {
  const dir = makeCampaign(t);
  const check = cli(['check', dir]);
  assert.equal(check.status, 0, check.stdout);
  assert.equal(check.json.layoutOnly, true);
  assert.equal(check.json.reviewRequired, false);

  const result = cli(['commit', dir, '--message', 'Apply the geographic layout']);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.layoutOnly, true);
  assert.equal(result.json.reviewRequired, false);
  assert.ok(result.json.saved);
  assert.ok(fs.existsSync(path.join(dir, 'Creature/Morvalle/Capra cinerina.md')));
});

test('commit without --message is a usage error', (t) => {
  const dir = makeCampaign(t);
  assertUsage(cli(['commit', dir, '--files', MIRA_PATH]));
  assertUsage(cli(['commit', dir, '--message', '   ']));
});

test('query prints the results with exit 0, a bad name or argument count exits 1', (t) => {
  const dir = makeCampaign(t);
  const found = cli(['query', dir, 'find', 'Fosco']);
  assert.equal(found.status, 0, found.stdout);
  assert.equal(found.json.query, 'find');
  assert.ok(Array.isArray(found.json.results));

  const unknown = cli(['query', dir, 'nosuch']);
  assert.equal(unknown.status, 1);
  assert.equal(typeof unknown.json.error, 'string');

  const counted = cli(['query', dir, 'at']);
  assert.equal(counted.status, 1);
  assert.equal(typeof counted.json.error, 'string');
});

test('usage errors exit 2 with the usage text, and the last line is exit: 2', (t) => {
  const dir = makeCampaign(t);
  assertUsage(cli([]));
  assertUsage(cli(['frobnicate', dir]));
  assertUsage(cli(['check']));
  assertUsage(cli(['check', '--files', 'x.md']));
  assertUsage(cli(['check', dir, '--bogus', 'x']));
  assertUsage(cli(['check', dir, '--files']));
  assertUsage(cli(['check', dir, '--files', '--deletes', 'x.md']));
  assertUsage(cli(['query', dir]));
  assertUsage(cli(['index', dir, '--extra', 'x']));
  const usage = cli(['check', dir, '--bogus', 'x']);
  assert.match(usage.json.message, /usage: node engine\.mjs/);
  assert.match(usage.stdout, /exit: 2\n$/);
});

test('deletes and sources go through check with their own options', (t) => {
  const dir = makeCampaign(t);
  const deleted = cli(['check', dir, '--deletes', 'Appunti/Idee.md']);
  assert.equal(deleted.status, 0, deleted.stdout);
  assert.equal(deleted.json.reviewRequired, true);

  const missing = cli(['check', dir, '--sources', 'Appunti/Assente.md']);
  assert.equal(missing.status, 1);
  assert.equal(missing.json.errors[0].code, 'missing-source');
});

test('change-plan prints the census of a subject with exit 0, an unknown id exits 1, a missing --subject is a usage error', (t) => {
  const dir = makeCampaign(t);
  const before = git(dir, ['status', '--porcelain']);
  const census = cli(['change-plan', dir, '--subject', 'fosco-il-ramaio']);
  assert.equal(census.status, 0, census.stdout);
  assert.equal(census.json.ok, true);
  assert.equal(census.json.subject.id, 'fosco-il-ramaio');
  assert.deepEqual(census.json.errors, []);
  assert.ok(Array.isArray(census.json.links) && Array.isArray(census.json.mentions));

  const unknown = cli(['change-plan', dir, '--subject', 'nessuno-del-tutto']);
  assert.equal(unknown.status, 1);
  assert.equal(unknown.json.ok, false);
  assert.equal(unknown.json.errors[0].code, 'unknown-subject');

  assertUsage(cli(['change-plan', dir]));
  assert.equal(git(dir, ['status', '--porcelain']), before);
});

test('change-draft rename writes the drafts of a rename with exit 0, a taken name exits 1 with nothing written', (t) => {
  const dir = makeCampaign(t);
  const sheet = 'Personaggi/Teodo Marr.md';
  const original = fs.readFileSync(path.join(dir, sheet), 'utf8');
  const renamed = cli(['change-draft', dir, '--op', 'rename', '--subject', 'teodo-marr', '--title', 'Teodo Brevald']);
  assert.equal(renamed.status, 0, renamed.stdout);
  assert.equal(renamed.json.ok, true);
  assert.equal(renamed.json.op, 'rename');
  assert.equal(renamed.json.subject, 'teodo-marr');
  assert.deepEqual(renamed.json.deletes, [sheet]);
  assert.ok(renamed.json.files.includes('Personaggi/Teodo Brevald.md'), JSON.stringify(renamed.json.files));
  assert.ok(fs.existsSync(path.join(dir, '.campaign/drafts/Personaggi/Teodo Brevald.md')));
  assert.equal(fs.readFileSync(path.join(dir, sheet), 'utf8'), original, 'the campaign sheet is not changed by a draft');

  const taken = cli(['change-draft', dir, '--op', 'rename', '--subject', 'oria-valdes', '--title', 'Lino Valdes']);
  assert.equal(taken.status, 1, taken.stdout);
  assert.equal(taken.json.ok, false);
  assert.equal(taken.json.errors[0].code, 'path-taken');
});

test('change-draft delete writes the drafts of a delete with exit 0, a referenced subject exits 1 with still-referenced', (t) => {
  const dir = makeCampaign(t);
  const deleted = cli(['change-draft', dir, '--op', 'delete', '--subject', 'oria-valdes']);
  assert.equal(deleted.status, 0, deleted.stdout);
  assert.equal(deleted.json.ok, true);
  assert.equal(deleted.json.op, 'delete');
  assert.deepEqual(deleted.json.deletes, ['Personaggi/Oria Valdes.md']);
  assert.ok(Array.isArray(deleted.json.files) && deleted.json.files.length > 0, JSON.stringify(deleted.json));

  const referenced = cli(['change-draft', dir, '--op', 'delete', '--subject', 'borgo-cenere']);
  assert.equal(referenced.status, 1, referenced.stdout);
  assert.equal(referenced.json.ok, false);
  assert.ok(referenced.json.errors.every((error) => error.code === 'still-referenced'));
  assert.equal(fs.existsSync(path.join(dir, '.campaign/drafts/Mondo/Morvalle/Borgo Cenere/Borgo Cenere.md')), false);
});

test('change-draft usage: a missing op or subject, a title with delete or without rename are usage errors', (t) => {
  const dir = makeCampaign(t);
  assertUsage(cli(['change-draft', dir, '--subject', 'teodo-marr', '--title', 'X']));
  assertUsage(cli(['change-draft', dir, '--op', 'rename', '--title', 'X']));
  assertUsage(cli(['change-draft', dir, '--op', 'rename', '--subject', 'teodo-marr']));
  assertUsage(cli(['change-draft', dir, '--op', 'delete', '--subject', 'oria-valdes', '--title', 'X']));
  assertUsage(cli(['change-draft', dir, '--op', 'merge', '--subject', 'teodo-marr']));
});
