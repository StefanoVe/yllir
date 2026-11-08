import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureRepo,
  status,
  saveVersion,
  saveManualChanges,
  listVersions,
  restore,
} from './versions.mjs';
import { stripExitLine } from './cli-exit.mjs';

// Identity logic is exercised only when no global or system git config exists.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'versions.mjs');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
}

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function write(dir, file, text) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

// A campaign repo with one saved version, so the tree starts clean.
function newRepo() {
  const dir = tmp();
  ensureRepo(dir);
  saveVersion(dir, { message: 'Repository created.', kind: 'framework' });
  return dir;
}

function assertCode(fn, code) {
  assert.throws(fn, (err) => err.code === code);
}

test('ensureRepo on an empty dir creates the repo, ignore rules and identity', () => {
  const dir = tmp();
  assert.deepEqual(ensureRepo(dir), { created: true });
  assert.equal(git(dir, 'rev-parse', '--show-toplevel'), fs.realpathSync(dir));
  assert.equal(git(dir, 'symbolic-ref', '--short', 'HEAD'), 'main');
  const ignore = read(dir, '.gitignore');
  assert.ok(ignore.split('\n').includes('.campaign/state/'));
  assert.ok(ignore.split('\n').includes('.campaign/cache/'));
  assert.ok(ignore.split('\n').includes('.claude/settings.local.json'));
  assert.equal(git(dir, 'config', '--get', 'user.name'), 'Yllir');
  assert.equal(git(dir, 'config', '--get', 'user.email'), 'yllir@localhost.invalid');
});

test('ensureRepo keeps an identity that is already set and fills only the missing one', () => {
  const dir = tmp();
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  git(dir, 'config', 'user.name', 'Ada');
  assert.deepEqual(ensureRepo(dir), { created: false });
  assert.equal(git(dir, 'config', '--get', 'user.name'), 'Ada');
  assert.equal(git(dir, 'config', '--get', 'user.email'), 'yllir@localhost.invalid');
});

test('ensureRepo is idempotent and does not duplicate ignore rules', () => {
  const dir = tmp();
  ensureRepo(dir);
  assert.deepEqual(ensureRepo(dir), { created: false });
  const lines = read(dir, '.gitignore').split('\n');
  assert.equal(lines.filter((line) => line === '.campaign/state/').length, 1);
  assert.equal(lines.filter((line) => line === '.campaign/cache/').length, 1);
  assert.equal(lines.filter((line) => line === '.claude/settings.local.json').length, 1);
});

test('ensureRepo appends missing ignore rules to an existing .gitignore', () => {
  const dir = tmp();
  write(dir, '.gitignore', 'node_modules/');
  ensureRepo(dir);
  const lines = read(dir, '.gitignore').split('\n');
  assert.equal(lines[0], 'node_modules/');
  assert.ok(lines.includes('.campaign/state/'));
  assert.ok(lines.includes('.campaign/cache/'));
  assert.ok(lines.includes('.claude/settings.local.json'));
});

test('status parses names with spaces, untracked files and renames', () => {
  const dir = newRepo();
  write(dir, 'old name.md', 'one\n');
  write(dir, 'keep.md', 'kept\n');
  saveVersion(dir, { message: 'Initial pages.', kind: 'framework' });
  git(dir, 'mv', 'old name.md', 'new name.md');
  write(dir, 'with space.md', 'new\n');
  write(dir, 'keep.md', 'changed\n');
  const current = status(dir);
  assert.equal(current.isRepo, true);
  assert.equal(current.clean, false);
  const found = Object.fromEntries(current.changed.map((item) => [item.path, item.change]));
  assert.deepEqual(found, {
    'new name.md': 'renamed',
    'with space.md': 'added',
    'keep.md': 'modified',
  });
});

test('status of a clean repo and of a dir that is not a repo', () => {
  const dir = newRepo();
  assert.deepEqual(status(dir), { isRepo: true, clean: true, changed: [] });
  const plain = tmp();
  assert.deepEqual(status(plain), { isRepo: false, clean: false, changed: [] });
});

test('saveVersion with nothing to save returns saved false', () => {
  const dir = newRepo();
  assert.deepEqual(saveVersion(dir, { message: 'Nothing.', kind: 'framework' }), { saved: false });
});

test('save with a kind trailer is read back by listVersions', () => {
  const dir = newRepo();
  write(dir, 'tavern.md', 'Taverna del porto.\n');
  const saved = saveVersion(dir, { message: 'Aggiunta la taverna del porto.', kind: 'framework' });
  assert.equal(saved.saved, true);
  assert.match(saved.hash, /^[0-9a-f]{4,}$/);
  assert.equal(saved.message, 'Aggiunta la taverna del porto.');
  const versions = listVersions(dir);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].hash, saved.hash);
  assert.equal(versions[0].message, 'Aggiunta la taverna del porto.');
  assert.equal(versions[0].kind, 'framework');
  assert.match(versions[0].date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test('versions without the trailer are listed as unknown, newest first', () => {
  const dir = newRepo();
  write(dir, 'a.md', 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Plain commit without trailer.');
  write(dir, 'b.md', 'b\n');
  saveManualChanges(dir, 'Manual note.');
  const versions = listVersions(dir);
  assert.deepEqual(
    versions.map((item) => [item.message, item.kind]),
    [
      ['Manual note.', 'manual'],
      ['Plain commit without trailer.', 'unknown'],
      ['Repository created.', 'framework'],
    ],
  );
});

test('saveManualChanges records kind manual', () => {
  const dir = newRepo();
  write(dir, 'scene.md', 'Scena.\n');
  assert.equal(saveManualChanges(dir, 'Modifica a mano del master.').saved, true);
  assert.equal(listVersions(dir)[0].kind, 'manual');
});

test('listVersions with paths returns only versions touching those paths', () => {
  const dir = newRepo();
  write(dir, 'a.md', 'a1\n');
  saveVersion(dir, { message: 'Scrive a.', kind: 'framework' });
  write(dir, 'b.md', 'b1\n');
  saveVersion(dir, { message: 'Scrive b.', kind: 'framework' });
  write(dir, 'a.md', 'a2\n');
  saveVersion(dir, { message: 'Cambia a di nuovo.', kind: 'framework' });
  const onlyA = listVersions(dir, { paths: ['a.md'] });
  assert.deepEqual(
    onlyA.map((item) => item.message),
    ['Cambia a di nuovo.', 'Scrive a.'],
  );
  assert.equal(listVersions(dir, { limit: 1 }).length, 1);
});

test('restore of one path returns it to an older version and keeps history', () => {
  const dir = newRepo();
  write(dir, 'a.md', 'one\n');
  write(dir, 'b.md', 'one\n');
  const first = saveVersion(dir, { message: 'Prima versione.', kind: 'framework' });
  write(dir, 'a.md', 'two\n');
  write(dir, 'b.md', 'two\n');
  saveVersion(dir, { message: 'Seconda versione.', kind: 'framework' });

  const result = restore(dir, { to: first.hash, paths: ['a.md'], message: 'Torna la scheda di a.' });
  assert.deepEqual(result.restored, ['a.md']);
  assert.equal(result.saved, true);
  assert.equal(read(dir, 'a.md'), 'one\n');
  assert.equal(read(dir, 'b.md'), 'two\n');
  assert.deepEqual(status(dir).clean, true);

  const versions = listVersions(dir);
  assert.equal(versions.length, 4);
  assert.equal(versions[0].kind, 'restore');
  assert.equal(versions[0].message, 'Torna la scheda di a.');
});

test('whole-tree restore removes a file added after the target version', () => {
  const dir = newRepo();
  write(dir, 'a.md', 'one\n');
  const first = saveVersion(dir, { message: 'Prima versione.', kind: 'framework' });
  write(dir, 'c.md', 'added later\n');
  write(dir, 'a.md', 'two\n');
  saveVersion(dir, { message: 'Seconda versione.', kind: 'framework' });

  const result = restore(dir, { to: first.hash, message: 'Torna com era prima.' });
  assert.ok(result.restored.includes('c.md'));
  assert.ok(result.restored.includes('a.md'));
  assert.equal(fs.existsSync(path.join(dir, 'c.md')), false);
  assert.equal(read(dir, 'a.md'), 'one\n');
  assert.deepEqual(git(dir, 'ls-files').split('\n').sort(), ['.gitignore', 'a.md']);
  assert.equal(status(dir).clean, true);
});

test('restore refuses when the campaign has unsaved changes', () => {
  const dir = newRepo();
  write(dir, 'a.md', 'one\n');
  const first = saveVersion(dir, { message: 'Prima versione.', kind: 'framework' });
  write(dir, 'a.md', 'edited by hand\n');
  assertCode(() => restore(dir, { to: first.hash, message: 'Torna.' }), 'not-clean');
  assert.equal(read(dir, 'a.md'), 'edited by hand\n');
});

test('restore refuses an unknown version', () => {
  const dir = newRepo();
  write(dir, 'a.md', 'one\n');
  saveVersion(dir, { message: 'Prima versione.', kind: 'framework' });
  assertCode(() => restore(dir, { to: 'deadbeef', message: 'Torna.' }), 'unknown-version');
  assertCode(() => restore(dir, { to: '0'.repeat(40), message: 'Torna.' }), 'unknown-version');
  assertCode(() => restore(dir, { to: '--all', message: 'Torna.' }), 'unknown-version');
});

test('ignored local state never appears in status or in a commit', () => {
  const dir = newRepo();
  write(dir, 'a.md', 'one\n');
  write(dir, '.campaign/state/x', 'local\n');
  assert.deepEqual(status(dir).changed.map((item) => item.path), ['a.md']);
  saveVersion(dir, { message: 'Prima versione.', kind: 'framework' });
  const committed = git(dir, 'ls-tree', '-r', '--name-only', 'HEAD');
  assert.ok(!committed.includes('.campaign/state'));
  assert.equal(status(dir).clean, true);
});

test('restore of a version with no changes saves nothing', () => {
  const dir = newRepo();
  write(dir, 'a.md', 'one\n');
  const first = saveVersion(dir, { message: 'Prima versione.', kind: 'framework' });
  assert.deepEqual(restore(dir, { to: first.hash, message: 'Torna.' }), {
    saved: false,
    hash: null,
    restored: [],
  });
  assert.equal(listVersions(dir).length, 2);
});

test('missing git reports no-git', () => {
  const dir = tmp();
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  try {
    assertCode(() => ensureRepo(dir), 'no-git');
  } finally {
    process.env.PATH = savedPath;
  }
});

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: result.status, json: JSON.parse(stripExitLine(result.stdout)) };
}

test('CLI smoke for every command', () => {
  const dir = tmp();

  const ensure = runCli(['ensure', dir]);
  assert.equal(ensure.code, 0);
  assert.deepEqual(ensure.json, { created: true });

  write(dir, 'a.md', 'one\n');
  const st = runCli(['status', dir]);
  assert.equal(st.code, 0);
  assert.equal(st.json.clean, false);

  const save = runCli(['save', dir, '--message', 'Prima versione.']);
  assert.equal(save.code, 0);
  assert.equal(save.json.saved, true);
  const first = save.json.hash;

  write(dir, 'a.md', 'manual\n');
  const manual = runCli(['save-manual', dir, '--message', 'Modifica a mano.']);
  assert.equal(manual.code, 0);
  assert.equal(manual.json.saved, true);

  const list = runCli(['list', dir, '--limit', '5', '--paths', 'a.md']);
  assert.equal(list.code, 0);
  assert.deepEqual(list.json.map((item) => item.kind), ['manual', 'framework']);

  const restored = runCli(['restore', dir, '--to', first, '--paths', 'a.md', '--message', 'Torna a.']);
  assert.equal(restored.code, 0);
  assert.deepEqual(restored.json.restored, ['a.md']);

  const unknown = runCli(['restore', dir, '--to', 'deadbeef', '--message', 'Torna.']);
  assert.equal(unknown.code, 1);
  assert.equal(unknown.json.error, 'unknown-version');

  write(dir, 'a.md', 'dirty\n');
  const notClean = runCli(['restore', dir, '--to', first, '--message', 'Torna.']);
  assert.equal(notClean.code, 1);
  assert.equal(notClean.json.error, 'not-clean');

  const usage = runCli(['save', dir]);
  assert.equal(usage.code, 2);
  assert.equal(usage.json.error, 'usage');
});
