import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI = path.resolve(import.meta.dirname, '../json-check.mjs');

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-json-'));
  tempDirs.push(dir);
  return dir;
}

/** Writes a file with the given text and returns its path. */
function file(text) {
  const full = path.join(tempDir(), 'data.json');
  fs.writeFileSync(full, text);
  return full;
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

describe('json-check', () => {
  test('a valid JSON file without a flag is ok', () => {
    const result = run([file('{"a": 1}')]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'json: ok\nexit: 0\n');
  });

  test('a scalar is valid JSON without a flag', () => {
    const result = run([file('null')]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'json: ok\nexit: 0\n');
  });

  test('--array accepts an array', () => {
    const result = run([file('[1, "due", {}]'), '--array']);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'json: ok\nexit: 0\n');
  });

  test('--array rejects an object, and an empty file is invalid JSON', () => {
    const notArray = run([file('{}'), '--array']);
    assert.equal(notArray.status, 1);
    assert.equal(notArray.stdout, 'json: invalid (not an array)\nexit: 1\n');
    const empty = run([file(''), '--array']);
    assert.equal(empty.status, 1);
    assert.match(empty.stdout, /^json: invalid \(.+\)\nexit: 1\n$/);
  });

  test('--object accepts a plain object', () => {
    const result = run([file('{"a": [1]}'), '--object']);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'json: ok\nexit: 0\n');
  });

  test('--object rejects an array and null', () => {
    const array = run([file('[]'), '--object']);
    assert.equal(array.status, 1);
    assert.equal(array.stdout, 'json: invalid (not an object)\nexit: 1\n');
    const nul = run([file('null'), '--object']);
    assert.equal(nul.status, 1);
    assert.equal(nul.stdout, 'json: invalid (not an object)\nexit: 1\n');
  });

  test('a syntax error prints one line with the reason and exits 1', () => {
    const result = run([file('{"a": 1,\n"b": }')]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^json: invalid \(.+\)\nexit: 1\n$/);
    assert.equal(result.stdout.trim().split('\n').length, 2);
  });

  test('a missing file prints missing file and exits 1', () => {
    const result = run([path.join(tempDir(), 'absent.json')]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, 'json: invalid (missing file)\nexit: 1\n');
  });

  test('no file is a usage error with exit 2', () => {
    const result = run([]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, 'exit: 2\n');
    assert.match(result.stderr, /usage: node json-check\.mjs/);
  });

  test('two flags, an unknown flag or two files are usage errors with exit 2', () => {
    const both = run([file('{}'), '--array', '--object']);
    assert.equal(both.status, 2);
    const unknown = run([file('{}'), '--strict']);
    assert.equal(unknown.status, 2);
    const twoFiles = run([file('{}'), file('[]')]);
    assert.equal(twoFiles.status, 2);
    assert.equal(twoFiles.stdout, 'exit: 2\n');
  });
});
