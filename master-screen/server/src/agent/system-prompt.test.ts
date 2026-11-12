import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MASTER_SCREEN_PROMPT } from './system-prompt.js';

describe('MASTER_SCREEN_PROMPT', () => {
  it('exists, is short and names the music tool', () => {
    assert.equal(typeof MASTER_SCREEN_PROMPT, 'string');
    assert.ok(MASTER_SCREEN_PROMPT.length > 0);
    assert.ok(MASTER_SCREEN_PROMPT.length < 1200, `too long: ${MASTER_SCREEN_PROMPT.length}`);
    assert.ok(MASTER_SCREEN_PROMPT.includes('suggest_music'));
  });

  it('has at most eight lines', () => {
    assert.ok(MASTER_SCREEN_PROMPT.split('\n').length <= 8);
  });
});
