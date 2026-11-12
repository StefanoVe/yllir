import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Git identity and config must come from the test only.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, 'session-start.mjs');
const FRAMEWORK_ROOT = path.resolve(here, '..');
const HEADER = 'YLLIR SESSION CHECK (for the assistant, not for the master)';

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Runs the hook with a fake home (YLLIR_HOME_DIR) and a fake HOME, so the real home is never used. */
function runHook(args, { home, fakeHome }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, YLLIR_HOME_DIR: home },
  });
}

test('writes the framework root to <YLLIR_HOME_DIR>/.yllir/framework-path on every run', (t) => {
  const home = tempDir(t, 'yllir-hook-home-');
  const fakeHome = tempDir(t, 'yllir-hook-fake-');
  const root = tempDir(t, 'yllir-hook-root-');

  const result = runHook([root], { home, fakeHome });

  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(HEADER.replace(/[()]/g, '\\$&')));
  assert.equal(fs.readFileSync(path.join(home, '.yllir', 'framework-path'), 'utf8'), `${FRAMEWORK_ROOT}\n`);
  assert.equal(fs.existsSync(path.join(fakeHome, '.yllir')), false, 'the fake HOME is not used when YLLIR_HOME_DIR is set');
});

test('keeps the file correct when it holds an old path', (t) => {
  const home = tempDir(t, 'yllir-hook-home-');
  const fakeHome = tempDir(t, 'yllir-hook-fake-');
  const root = tempDir(t, 'yllir-hook-root-');
  fs.mkdirSync(path.join(home, '.yllir'));
  fs.writeFileSync(path.join(home, '.yllir', 'framework-path'), '/old/place\n');

  const result = runHook([root], { home, fakeHome });

  assert.equal(result.status, 0);
  assert.equal(fs.readFileSync(path.join(home, '.yllir', 'framework-path'), 'utf8'), `${FRAMEWORK_ROOT}\n`);
});

test('an unwritable home never fails the hook and prints the check as usual', (t) => {
  const blocker = tempDir(t, 'yllir-hook-blocker-');
  const home = path.join(blocker, 'file-not-folder');
  fs.writeFileSync(home, 'x');
  const fakeHome = tempDir(t, 'yllir-hook-fake-');
  const root = tempDir(t, 'yllir-hook-root-');

  const result = runHook([root], { home, fakeHome });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /YLLIR SESSION CHECK/);
});

test('--json still prints the check as JSON', (t) => {
  const home = tempDir(t, 'yllir-hook-home-');
  const fakeHome = tempDir(t, 'yllir-hook-fake-');
  const root = tempDir(t, 'yllir-hook-root-');

  const result = runHook([root, '--json'], { home, fakeHome });

  assert.equal(result.status, 0);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
});
