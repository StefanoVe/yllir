import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { makeCampaign } from '../live/test-support.js';
import { addDays, isSnoozed, localDate, NOTICE_RELATIVE_PATH, readNotice, writeSnooze } from './notice.js';

describe('the notice memory', () => {
  it('reads nothing when the file is missing or unreadable', () => {
    const root = makeCampaign();
    assert.deepEqual(readNotice(root), { lastNotifiedVersion: null, lastNotifiedOn: null, snoozedUntil: null });
    assert.equal(isSnoozed(readNotice(root), '2026-11-14', '1.2.0'), false);
  });

  it('writes the framework format with a one-day snooze and reads it back', () => {
    const root = makeCampaign();
    writeSnooze(root, { version: '1.2.0', today: '2026-11-14' });
    const text = fs.readFileSync(path.join(root, NOTICE_RELATIVE_PATH), 'utf8');
    assert.equal(
      text,
      'last_notified_version: "1.2.0"\nlast_notified_on: "2026-11-14"\nsnoozed_until: "2026-11-15"\n',
    );
    const memory = readNotice(root);
    assert.equal(memory.lastNotifiedVersion, '1.2.0');
    assert.equal(memory.lastNotifiedOn, '2026-11-14');
    assert.equal(memory.snoozedUntil, '2026-11-15');
    assert.equal(isSnoozed(memory, '2026-11-14', '1.2.0'), true);
    assert.equal(isSnoozed(memory, '2026-11-15', '1.2.0'), false, 'the snooze ends the next day');
  });

  it('a snooze set for the published version is a snooze', () => {
    const root = makeCampaign({
      '.campaign/state/update-notice.yaml':
        'last_notified_version: "1.2.0"\nlast_notified_on: "2026-11-14"\nsnoozed_until: "2026-11-15"\n',
    });
    assert.equal(isSnoozed(readNotice(root), '2026-11-14', '1.2.0'), true);
  });

  it('a snooze set for an older version does not hide a newer published one', () => {
    const root = makeCampaign({
      '.campaign/state/update-notice.yaml':
        'last_notified_version: "1.2.0"\nlast_notified_on: "2026-11-14"\nsnoozed_until: "2026-11-15"\n',
    });
    const memory = readNotice(root);
    assert.equal(isSnoozed(memory, '2026-11-14', '1.3.0'), false);
    assert.equal(isSnoozed(memory, '2026-11-14', null), false, 'no published version means no snooze');
  });

  it('reads a file written by the framework update check', () => {
    const root = makeCampaign({
      '.campaign/state/update-notice.yaml': 'last_notified_version: "1.2.0"\nlast_notified_on: "2026-11-13"\n',
    });
    const memory = readNotice(root);
    assert.equal(memory.lastNotifiedOn, '2026-11-13');
    assert.equal(memory.snoozedUntil, null);
    assert.equal(isSnoozed(memory, '2026-11-14', '1.2.0'), false);
  });

  it('a corrupt snooze date is not a snooze', () => {
    const root = makeCampaign({
      '.campaign/state/update-notice.yaml': 'last_notified_version: "1.2.0"\nsnoozed_until: "soon"\n',
    });
    assert.equal(isSnoozed(readNotice(root), '2026-11-14', '1.2.0'), false);
  });
});

describe('dates', () => {
  it('adds days across month and year ends', () => {
    assert.equal(addDays('2026-11-30', 1), '2026-12-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });

  it('uses the local calendar date', () => {
    assert.equal(localDate(new Date(2026, 10, 4, 12, 0, 0)), '2026-11-04');
  });
});
