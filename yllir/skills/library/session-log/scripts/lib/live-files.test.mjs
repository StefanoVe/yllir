import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJsonAtomic, readJson, compareSessionIds, nextSessionId, listSessionIds } from './live-files.mjs';
import { openSession, addEntry, endSession } from './log-store.mjs';

const DAY = new Date(2026, 10, 12, 20, 0);

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-files-'));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), 'name: Test\n');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function allFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...allFiles(full));
    else found.push(full);
  }
  return found;
}

describe('atomic writes', () => {
  test('a successful save leaves no temporary files behind', () => {
    openSession(root, { now: DAY });
    for (let i = 0; i < 5; i++) addEntry(root, { kind: 'fact', text: `Fact ${i}.`, now: DAY });
    const live = path.join(root, '.campaign', 'state', 'live');
    const files = allFiles(live).map((file) => path.basename(file));
    assert.deepEqual(files.sort(), ['active.json', 'session.json', 'log.json'].sort());
    assert.equal(files.some((name) => name.endsWith('.tmp')), false);
  });

  test('a failed save removes its temporary file and reports write-failed', () => {
    const target = path.join(root, 'blocked.json');
    fs.mkdirSync(target); // a folder where the file should be: the rename must fail
    const result = writeJsonAtomic(target, { a: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'write-failed');
    assert.deepEqual(fs.readdirSync(root).filter((name) => name.endsWith('.tmp')), []);
  });

  test('saved files are readable only by the owner', { skip: process.platform === 'win32' }, () => {
    openSession(root, { now: DAY });
    const sessionFile = path.join(root, '.campaign', 'state', 'live', '2026-11-12', 'session.json');
    assert.equal(fs.statSync(sessionFile).mode & 0o777, 0o600);
  });

  test('readJson treats a missing file as null and a broken file as corrupt-state', () => {
    assert.deepEqual(readJson(path.join(root, 'none.json')), { ok: true, value: null });
    const broken = path.join(root, 'broken.json');
    fs.writeFileSync(broken, '{');
    assert.equal(readJson(broken).error.code, 'corrupt-state');
  });
});

describe('storage boundary', () => {
  test('nothing is written outside .campaign/state/live/', () => {
    openSession(root, { now: DAY });
    addEntry(root, { kind: 'decision', text: 'Go north.', now: DAY });
    endSession(root, { now: DAY });
    const topLevel = fs.readdirSync(root).sort();
    assert.deepEqual(topLevel, ['.campaign', 'campaign.yaml']);
    assert.deepEqual(fs.readdirSync(path.join(root, '.campaign')), ['state']);
    assert.deepEqual(fs.readdirSync(path.join(root, '.campaign', 'state')), ['live']);
  });
});

describe('session ids', () => {
  test('compareSessionIds orders by date, then by suffix', () => {
    const ids = ['2026-11-12-3', '2026-11-11', '2026-11-12', '2026-11-12-2'];
    assert.deepEqual([...ids].sort(compareSessionIds), ['2026-11-11', '2026-11-12', '2026-11-12-2', '2026-11-12-3']);
  });

  test('nextSessionId gives the date first, then -2 and -3 for the same day', () => {
    const live = path.join(root, '.campaign', 'state', 'live');
    assert.equal(nextSessionId(root, '2026-11-12'), '2026-11-12');
    fs.mkdirSync(path.join(live, '2026-11-12'), { recursive: true });
    assert.equal(nextSessionId(root, '2026-11-12'), '2026-11-12-2');
    fs.mkdirSync(path.join(live, '2026-11-12-2'));
    assert.equal(nextSessionId(root, '2026-11-12'), '2026-11-12-3');
    assert.deepEqual(listSessionIds(root), ['2026-11-12', '2026-11-12-2']);
  });
});
