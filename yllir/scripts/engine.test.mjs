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
