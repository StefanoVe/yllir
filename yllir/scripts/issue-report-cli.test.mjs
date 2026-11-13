import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./issue-report.mjs', import.meta.url));

function cli(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

function lastLine(stdout) {
  return stdout.trimEnd().split('\n').at(-1);
}

test('missing --summary is a usage error with exit 2', () => {
  const result = cli(['create', '--title', 'Broken']);
  assert.equal(result.status, 2);
  assert.equal(lastLine(result.stdout), 'exit: 2');
  assert.match(result.stderr, /--summary is required/);
});

test('missing --title is a usage error with exit 2', () => {
  const result = cli(['create', '--summary', 'Broken']);
  assert.equal(result.status, 2);
  assert.equal(lastLine(result.stdout), 'exit: 2');
  assert.match(result.stderr, /--title is required/);
});

test('an unknown option is a usage error with exit 2', () => {
  const result = cli(['create', '--title', 'T', '--summary', 'S', '--bogus', 'x']);
  assert.equal(result.status, 2);
  assert.equal(lastLine(result.stdout), 'exit: 2');
});

test('dry run prints one JSON object and ends with exit 0', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-issue-cli-'));
  try {
    const result = cli(['create', root, '--title', 'Map is blank', '--summary', 'The map stays empty.', '--steps', 'Open it', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(lastLine(result.stdout), 'exit: 0');
    const json = JSON.parse(result.stdout.slice(0, result.stdout.lastIndexOf('\nexit:')));
    assert.equal(json.status, 'text');
    assert.equal(json.title, 'Map is blank');
    assert.deepEqual(json.tried, []);
    assert.equal(json.issue_url, null);
    assert.match(json.prefilled_url, /^https:\/\/github\.com\/StefanoVe\/yllir\/issues\/new\?/);
    assert.equal(fs.existsSync(path.join(root, json.body_file)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
