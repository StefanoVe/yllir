import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  openSession,
  getActive,
  addEntry,
  updateEntry,
  removeEntry,
  listEntries,
  endSession,
  readSession,
} from './log-store.mjs';

const DAY = new Date(2026, 10, 12, 20, 0);

let root;

function makeCampaign() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-log-'));
  fs.writeFileSync(path.join(dir, 'campaign.yaml'), 'name: Test\nlanguage:\n  main: en\n');
  return dir;
}

beforeEach(() => {
  root = makeCampaign();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function expectError(result, code) {
  assert.equal(result.ok, false, `expected failure ${code}, got ${JSON.stringify(result)}`);
  assert.equal(result.error.code, code);
  assert.equal(typeof result.error.message, 'string');
}

describe('sessions', () => {
  test('open creates the session and makes it active', () => {
    const opened = openSession(root, { title: 'The bridge', now: DAY });
    assert.equal(opened.ok, true);
    assert.equal(opened.session.id, '2026-11-12');
    assert.equal(opened.session.title, 'The bridge');
    assert.equal(getActive(root).session.id, '2026-11-12');
  });

  test('the title defaults to the id and the session reference is kept', () => {
    const opened = openSession(root, { sessionRef: 'Plot/Bridge/Bridge.md', now: DAY });
    assert.equal(opened.session.title, '2026-11-12');
    assert.equal(opened.session.sessionRef, 'Plot/Bridge/Bridge.md');
  });

  test('opening twice gives already-open', () => {
    assert.equal(openSession(root, { now: DAY }).ok, true);
    expectError(openSession(root, { now: DAY }), 'already-open');
  });

  test('the same day gets the -2 and -3 suffixes after each end', () => {
    assert.equal(openSession(root, { now: DAY }).session.id, '2026-11-12');
    endSession(root, { now: DAY });
    assert.equal(openSession(root, { now: DAY }).session.id, '2026-11-12-2');
    endSession(root, { now: DAY });
    assert.equal(openSession(root, { now: DAY }).session.id, '2026-11-12-3');
  });

  test('end clears the active session and keeps the files', () => {
    openSession(root, { now: DAY });
    const ended = endSession(root, { now: DAY });
    assert.equal(ended.ok, true);
    assert.ok(ended.session.endedAt);
    assert.equal(getActive(root).session, null);
    const read = readSession(root, '2026-11-12');
    assert.equal(read.ok, true);
    assert.equal(read.session.endedAt, ended.session.endedAt);
  });

  test('a campaign folder without campaign.yaml is refused', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-bare-'));
    try {
      expectError(openSession(bare, { now: DAY }), 'not-a-campaign');
      expectError(getActive(bare), 'not-a-campaign');
      expectError(listEntries(bare), 'not-a-campaign');
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  test('open validates the title and the session reference', () => {
    expectError(openSession(root, { title: '  ', now: DAY }), 'invalid-title');
    expectError(openSession(root, { title: 'a\nb', now: DAY }), 'invalid-title');
    expectError(openSession(root, { sessionRef: '../Plot.md', now: DAY }), 'invalid-session-ref');
    assert.equal(getActive(root).session, null);
  });

  test('readSession rejects a malformed id and a missing session', () => {
    expectError(readSession(root, '../../etc'), 'invalid-session-id');
    expectError(readSession(root, '2026-11-12'), 'session-not-found');
  });
});

describe('entries', () => {
  test('ids run ascending and are never reused after a removal', () => {
    openSession(root, { now: DAY });
    const first = addEntry(root, { kind: 'fact', text: 'The bridge fell.', now: DAY });
    const second = addEntry(root, { kind: 'fact', text: 'The ferry sank.', now: DAY });
    assert.equal(first.entry.id, 'e-0001');
    assert.equal(second.entry.id, 'e-0002');
    assert.equal(removeEntry(root, 'e-0002').ok, true);
    const third = addEntry(root, { kind: 'decision', text: 'Go north.', now: DAY });
    assert.equal(third.entry.id, 'e-0003');
    assert.deepEqual(listEntries(root).entries.map((e) => e.id), ['e-0001', 'e-0003']);
  });

  test('a new session starts again from e-0001', () => {
    openSession(root, { now: DAY });
    addEntry(root, { kind: 'fact', text: 'One.', now: DAY });
    endSession(root, { now: DAY });
    openSession(root, { now: DAY });
    assert.equal(addEntry(root, { kind: 'fact', text: 'Two.', now: DAY }).entry.id, 'e-0001');
  });

  test('an entry keeps the master words, trimmed, with its time and default by', () => {
    openSession(root, { now: DAY });
    const added = addEntry(root, { kind: 'fact', text: '  Varn found the boat.  ', now: DAY });
    assert.equal(added.entry.text, 'Varn found the boat.');
    assert.equal(added.entry.by, 'master');
    assert.equal(added.entry.at, DAY.toISOString());
    assert.equal(added.entry.scene, undefined);
  });

  test('add without an active session gives no-active-session', () => {
    expectError(addEntry(root, { kind: 'fact', text: 'Nothing open.', now: DAY }), 'no-active-session');
    expectError(updateEntry(root, 'e-0001', { text: 'x' }), 'no-active-session');
    expectError(removeEntry(root, 'e-0001'), 'no-active-session');
    expectError(endSession(root, { now: DAY }), 'no-active-session');
    assert.deepEqual(listEntries(root), { ok: true, entries: [] });
  });

  test('validation codes for kind, text, subjects, by and resolved', () => {
    openSession(root, { now: DAY });
    expectError(addEntry(root, { kind: 'rumour', text: 'x', now: DAY }), 'invalid-kind');
    expectError(addEntry(root, { kind: 'fact', text: '   ', now: DAY }), 'invalid-text');
    expectError(addEntry(root, { kind: 'fact', text: 'a'.repeat(2001), now: DAY }), 'invalid-text');
    expectError(addEntry(root, { kind: 'fact', text: 'x', subjects: 'a,b', now: DAY }), 'invalid-subjects');
    expectError(
      addEntry(root, { kind: 'fact', text: 'x', subjects: Array.from({ length: 21 }, (_, i) => `s${i}`), now: DAY }),
      'invalid-subjects',
    );
    expectError(addEntry(root, { kind: 'fact', text: 'x', subjects: [3], now: DAY }), 'invalid-subjects');
    expectError(addEntry(root, { kind: 'fact', text: 'x', by: 'robot', now: DAY }), 'invalid-by');
    expectError(addEntry(root, { kind: 'fact', text: 'x', resolved: true, now: DAY }), 'resolved-not-thread');
    expectError(addEntry(root, { kind: 'thread', text: 'x', resolved: 'yes', now: DAY }), 'invalid-resolved');
    assert.deepEqual(listEntries(root).entries, []);
  });

  test('scene must be a campaign-relative path: path traversal is rejected', () => {
    openSession(root, { now: DAY });
    for (const scene of ['../outside.md', '/etc/passwd.md', 'Scenes/../../x.md', 'C:/x.md', 'Scenes\\x.md', 'a//b.md', '']) {
      expectError(addEntry(root, { kind: 'fact', text: 'x', scene, now: DAY }), 'invalid-scene');
    }
    const ok = addEntry(root, { kind: 'fact', text: 'x', scene: 'Plot/Bridge/Scene one.md', now: DAY });
    assert.equal(ok.ok, true);
    assert.equal(ok.entry.scene, 'Plot/Bridge/Scene one.md');
  });

  test('subjects are trimmed, de-duplicated and kept as a list', () => {
    openSession(root, { now: DAY });
    const added = addEntry(root, { kind: 'fact', text: 'x', subjects: [' varn ', 'varn', 'brenna'], now: DAY });
    assert.deepEqual(added.entry.subjects, ['varn', 'brenna']);
  });

  test('resolved is kept for threads only', () => {
    openSession(root, { now: DAY });
    const thread = addEntry(root, { kind: 'thread', text: 'Who owns the key?', resolved: false, now: DAY });
    assert.equal(thread.entry.resolved, false);
    const fixed = updateEntry(root, thread.entry.id, { resolved: true });
    assert.equal(fixed.entry.resolved, true);
    const changed = updateEntry(root, thread.entry.id, { kind: 'fact' });
    assert.equal(changed.entry.resolved, undefined);
    expectError(updateEntry(root, thread.entry.id, { resolved: true }), 'resolved-not-thread');
  });

  test('update changes only the given fields and keeps the id', () => {
    openSession(root, { now: DAY });
    const added = addEntry(root, { kind: 'fact', text: 'The bridge fell.', scene: 'Plot/A/s1.md', subjects: ['bridge'], now: DAY });
    const updated = updateEntry(root, added.entry.id, { text: 'The bridge burned.' });
    assert.equal(updated.ok, true);
    assert.equal(updated.entry.id, added.entry.id);
    assert.equal(updated.entry.text, 'The bridge burned.');
    assert.equal(updated.entry.scene, 'Plot/A/s1.md');
    const cleared = updateEntry(root, added.entry.id, { scene: null, subjects: null });
    assert.equal(cleared.entry.scene, undefined);
    assert.equal(cleared.entry.subjects, undefined);
  });

  test('update and remove report what is wrong with plain codes', () => {
    openSession(root, { now: DAY });
    addEntry(root, { kind: 'fact', text: 'x', now: DAY });
    expectError(updateEntry(root, 'e-0009', { text: 'y' }), 'entry-not-found');
    expectError(updateEntry(root, 'fact-1', { text: 'y' }), 'invalid-id');
    expectError(updateEntry(root, 'e-0001', {}), 'invalid-patch');
    expectError(updateEntry(root, 'e-0001', { by: 'agent' }), 'invalid-patch');
    expectError(updateEntry(root, 'e-0001', { text: '' }), 'invalid-text');
    expectError(removeEntry(root, 'e-0009'), 'entry-not-found');
  });
});

describe('storage', () => {
  test('a damaged log file is reported, not overwritten', () => {
    openSession(root, { now: DAY });
    const logFile = path.join(root, '.campaign', 'state', 'live', '2026-11-12', 'log.json');
    fs.writeFileSync(logFile, '{ not json');
    expectError(listEntries(root), 'corrupt-state');
    assert.equal(fs.readFileSync(logFile, 'utf8'), '{ not json');
  });
});
