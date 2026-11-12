import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFrameworkPath } from './framework-path.mjs';

function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-fwpath-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

test('writes the framework root as one line under <home>/.yllir', (t) => {
  const home = tempHome(t);
  const framework = path.join(home, 'frame work', 'yllir');
  assert.equal(writeFrameworkPath(framework, home), true);
  const file = path.join(home, '.yllir', 'framework-path');
  assert.equal(fs.readFileSync(file, 'utf8'), `${framework}\n`);
  assert.deepEqual(
    fs.readdirSync(path.join(home, '.yllir')),
    ['framework-path'],
    'no temp file is left behind',
  );
});

test('does not rewrite the file when the content is unchanged', (t) => {
  const home = tempHome(t);
  writeFrameworkPath('/opt/yllir', home);
  const file = path.join(home, '.yllir', 'framework-path');
  const before = fs.statSync(file).ino;
  assert.equal(writeFrameworkPath('/opt/yllir', home), true);
  assert.equal(fs.statSync(file).ino, before, 'same inode: nothing was replaced');
});

test('replaces the file atomically when the framework moved', (t) => {
  const home = tempHome(t);
  writeFrameworkPath('/opt/old', home);
  const file = path.join(home, '.yllir', 'framework-path');
  const before = fs.statSync(file).ino;
  assert.equal(writeFrameworkPath('/opt/new', home), true);
  assert.equal(fs.readFileSync(file, 'utf8'), '/opt/new\n');
  assert.notEqual(fs.statSync(file).ino, before, 'the file was replaced by a rename');
});

test('returns false and does not throw when the folder cannot be written', (t) => {
  const home = tempHome(t);
  fs.writeFileSync(path.join(home, '.yllir'), 'a file, not a folder');
  assert.equal(writeFrameworkPath('/opt/yllir', home), false);
});
