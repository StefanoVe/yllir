import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareVersions, isVersion } from './version.js';

describe('compareVersions', () => {
  it('orders MAJOR.MINOR.PATCH numbers numerically', () => {
    assert.equal(compareVersions('1.2.0', '1.1.0'), 1);
    assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
    assert.equal(compareVersions('0.60.3', '0.60.10'), -1);
    assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  });

  it('answers null for anything that is not MAJOR.MINOR.PATCH', () => {
    assert.equal(compareVersions('1.2', '1.1.0'), null);
    assert.equal(compareVersions('1.2.0-beta', '1.1.0'), null);
    assert.equal(compareVersions('01.2.0', '1.1.0'), null);
    assert.equal(isVersion(undefined), false);
  });
});
