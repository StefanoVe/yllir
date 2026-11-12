import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../../migrations/shortcut-v1/deterministic.mjs';
import { loadRegistry } from './registry.mjs';
import { shortcutFileName } from '../../../new-campaign/scripts/lib/shortcut.mjs';
import { ensureRepo, saveVersion, status } from '../../../../../scripts/lib/versions.mjs';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const SUPPORTED = ['darwin', 'linux', 'win32'].includes(process.platform);
const MARKER = 'yllir-shortcut v1';

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-shortcut-v1-'));
  tempDirs.push(dir);
  return dir;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

/** An old campaign: a git repository with campaign.yaml, a saved version and no shortcut. */
function oldCampaign(language = 'it') {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'campaign.yaml'), `schema: 1\ncampaign:\n  name: "Prova"\nlanguage:\n  main: ${language}\n`);
  fs.writeFileSync(path.join(root, '.gitignore'), '.campaign/state/\n');
  ensureRepo(root);
  saveVersion(root, { message: 'Before the shortcut', kind: 'framework' });
  return root;
}

function shortcutFiles(root, prefix) {
  return fs.readdirSync(root).filter((name) => name.startsWith(`${prefix}.`));
}

test('the registry runs shortcut-v1 after metadata-comment-v1', () => {
  const registry = loadRegistry();
  assert.deepEqual(registry.errors, []);
  const migration = registry.migrations.find((m) => m.id === 'shortcut-v1');
  assert.deepEqual(migration.after, ['metadata-comment-v1']);
  assert.deepEqual(migration.needed, { from_version_below: '0.45.0' });
  assert.equal(migration.guided, null);
});

test('a dry run reports the shortcut and the ignore rules without writing anything', { skip: !SUPPORTED }, () => {
  const root = oldCampaign('it');
  const before = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

  const result = apply(root, { dryRun: true });

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.changed.sort(), ['.gitignore', shortcutFileName('it')].sort());
  assert.deepEqual(shortcutFiles(root, 'Apri master screen'), []);
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), before);
});

test('apply writes the Italian shortcut, ignores it in git, and a second run changes nothing', { skip: !SUPPORTED }, () => {
  const root = oldCampaign('it');

  const first = apply(root);
  assert.equal(first.status, 'complete');
  assert.deepEqual(first.errors, []);
  assert.ok(first.changed.includes('.gitignore'));
  const files = shortcutFiles(root, 'Apri master screen');
  assert.ok(files.length >= 1, 'the shortcut exists');
  const main = files.find((name) => !name.endsWith('.desktop'));
  assert.ok(fs.readFileSync(path.join(root, main), 'utf8').includes(MARKER), 'the marker is in the file');
  if (process.platform !== 'win32') {
    assert.ok((fs.statSync(path.join(root, main)).mode & 0o111) !== 0, 'the shortcut is executable');
  }
  assert.deepEqual(apply(root, { dryRun: true }).changed, []);

  const second = apply(root);
  assert.deepEqual(second.changed, []);
});

test('the shortcut is not seen as an unsaved change, so the git history stays clean', { skip: !SUPPORTED }, () => {
  const root = oldCampaign('en');
  apply(root);
  const state = status(root);
  assert.deepEqual(state.changed.map((entry) => entry.path), ['.gitignore']);
  saveVersion(root, { message: 'Shortcut ignore rules', kind: 'framework' });
  assert.equal(status(root).clean, true);
  assert.equal(git(root, ['ls-files']).includes('Open master screen'), false);
  assert.equal(shortcutFiles(root, 'Open master screen').length >= 1, true);
});

test('a file with the shortcut name and no marker is never overwritten', { skip: !SUPPORTED }, () => {
  const root = oldCampaign('it');
  const main = process.platform === 'darwin' ? 'Apri master screen.command' : process.platform === 'win32' ? 'Apri master screen.cmd' : 'Apri master screen.sh';
  fs.writeFileSync(path.join(root, main), 'my own notes\n');

  const result = apply(root);

  assert.equal(result.status, 'complete');
  assert.equal(fs.readFileSync(path.join(root, main), 'utf8'), 'my own notes\n');
});

test('a write error is reported as skipped and does not fail the update', { skip: !SUPPORTED }, () => {
  const root = oldCampaign('it');
  const main = process.platform === 'darwin' ? 'Apri master screen.command' : process.platform === 'win32' ? 'Apri master screen.cmd' : 'Apri master screen.sh';
  // A folder where the shortcut should be makes the write fail.
  fs.mkdirSync(path.join(root, main));

  const result = apply(root);

  assert.equal(result.status, 'complete');
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'shortcut-failed');
});
