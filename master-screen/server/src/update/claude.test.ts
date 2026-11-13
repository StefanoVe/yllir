import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { installPathOf } from './claude.js';

describe('installPathOf', () => {
  it('takes the install folder of the yllir plugin from the list', () => {
    const listing = JSON.stringify([
      { id: 'other@market', installPath: '/elsewhere' },
      { id: 'yllir@yllir', version: '1.2.0', installPath: '/plugins/yllir' },
    ]);
    assert.equal(installPathOf(listing), '/plugins/yllir');
  });

  it('gives null when the plugin is not listed or the list is not understood', () => {
    assert.equal(installPathOf(JSON.stringify([{ id: 'other@market', installPath: '/x' }])), null);
    assert.equal(installPathOf('not json'), null);
    assert.equal(installPathOf(JSON.stringify({ id: 'yllir@yllir', installPath: '/x' })), null);
    assert.equal(installPathOf(JSON.stringify([{ id: 'yllir@yllir' }])), null);
  });
});
