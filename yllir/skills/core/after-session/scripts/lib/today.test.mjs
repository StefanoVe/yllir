import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { today } from './today.mjs';

describe('today', () => {
  test('returns the local date as YYYY-MM-DD', () => {
    assert.equal(today(new Date(2026, 10, 8)), '2026-11-08');
  });

  test('zero-pads month and day', () => {
    assert.equal(today(new Date(2026, 0, 5)), '2026-01-05');
  });

  test('late-evening local time keeps the same day', () => {
    assert.equal(today(new Date(2026, 10, 8, 23, 59)), '2026-11-08');
  });

  test('defaults to the current local date', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    assert.equal(today(), expected);
  });
});
