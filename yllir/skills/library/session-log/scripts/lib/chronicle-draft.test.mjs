import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildChronicleSource } from './chronicle-draft.mjs';
import { openSession, addEntry, updateEntry, endSession } from './log-store.mjs';

const DAY = new Date(2026, 10, 12, 20, 0);

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-chron-'));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), 'name: Test\n');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function playedEvening() {
  openSession(root, { title: 'The drowned ferry', sessionRef: 'Plot/Ferry/Ferry.md', now: DAY });
  addEntry(root, { kind: 'fact', text: 'Varn found the boat.', scene: 'Plot/Ferry/Dock.md', subjects: ['varn'], now: DAY });
  addEntry(root, { kind: 'thread', text: 'Who owns the key?', resolved: false, now: DAY });
  addEntry(root, { kind: 'decision', text: 'Do not speak to the captain.', now: DAY });
  addEntry(root, { kind: 'fact', text: 'The captain lied about the cargo.', now: DAY });
  addEntry(root, { kind: 'intention', text: 'Brenna will watch the harbour.', now: DAY });
  addEntry(root, { kind: 'thread', text: 'Where is the lantern?', resolved: true, now: DAY });
}

describe('buildChronicleSource', () => {
  test('gives title, date, sections in order and threads split open and resolved', () => {
    playedEvening();
    const result = buildChronicleSource(root);
    assert.equal(result.ok, true);
    const md = result.markdown;
    assert.match(md, /^# The drowned ferry\n/);
    assert.match(md, /Session date: 2026-11-12/);
    assert.match(md, /Plot session: Plot\/Ferry\/Ferry\.md/);
    const order = [
      md.indexOf('## Facts'),
      md.indexOf('## Decisions'),
      md.indexOf('## Intentions'),
      md.indexOf('## Threads'),
      md.indexOf('### Open'),
      md.indexOf('### Resolved'),
    ];
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.ok(order.every((index) => index > 0));
  });

  test('facts keep the order of the log, with scene and subjects after the text', () => {
    playedEvening();
    const md = buildChronicleSource(root).markdown;
    const first = md.indexOf('Varn found the boat.');
    const second = md.indexOf('The captain lied about the cargo.');
    assert.ok(first > 0 && second > first);
    assert.match(md, /- Varn found the boat\. \[scene: Plot\/Ferry\/Dock\.md; subjects: varn\]/);
  });

  test('open threads come before resolved ones and only the right one is listed in each', () => {
    playedEvening();
    const md = buildChronicleSource(root).markdown;
    const openPart = md.slice(md.indexOf('### Open'), md.indexOf('### Resolved'));
    const resolvedPart = md.slice(md.indexOf('### Resolved'));
    assert.match(openPart, /Who owns the key\?/);
    assert.doesNotMatch(openPart, /Where is the lantern\?/);
    assert.match(resolvedPart, /Where is the lantern\?/);
    assert.doesNotMatch(resolvedPart, /Who owns the key\?/);
  });

  test('is plain working text: no metadata block and no campaign document marks', () => {
    playedEvening();
    const md = buildChronicleSource(root).markdown;
    assert.doesNotMatch(md, /<!--/);
    assert.doesNotMatch(md, /^---$/m);
    assert.doesNotMatch(md, /provenance:|played:/);
  });

  test('an empty section says so', () => {
    openSession(root, { now: DAY });
    const md = buildChronicleSource(root).markdown;
    assert.match(md, /## Facts\n\n- none recorded/);
  });

  test('an edited entry shows its new text', () => {
    playedEvening();
    updateEntry(root, 'e-0001', { text: 'Varn found the boat, half sunk.' });
    assert.match(buildChronicleSource(root).markdown, /Varn found the boat, half sunk\./);
  });

  test('defaults to the active session, else to the last ended one', () => {
    playedEvening();
    endSession(root, { now: DAY });
    openSession(root, { title: 'Second evening', now: DAY });
    assert.equal(buildChronicleSource(root).sessionId, '2026-11-12-2');
    endSession(root, { now: DAY });
    assert.equal(buildChronicleSource(root).sessionId, '2026-11-12-2');
    assert.match(buildChronicleSource(root).markdown, /# Second evening/);
  });

  test('an explicit session id is used', () => {
    playedEvening();
    endSession(root, { now: DAY });
    openSession(root, { title: 'Second evening', now: DAY });
    const first = buildChronicleSource(root, '2026-11-12');
    assert.equal(first.ok, true);
    assert.match(first.markdown, /# The drowned ferry/);
  });

  test('no session gives no-session, an unknown id gives session-not-found', () => {
    assert.equal(buildChronicleSource(root).error.code, 'no-session');
    assert.equal(buildChronicleSource(root, '2026-11-13').error.code, 'session-not-found');
    assert.equal(buildChronicleSource(root, '../x').error.code, 'invalid-session-id');
  });

  test('a folder without campaign.yaml is refused', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-chron-bare-'));
    try {
      assert.equal(buildChronicleSource(bare).error.code, 'not-a-campaign');
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});
