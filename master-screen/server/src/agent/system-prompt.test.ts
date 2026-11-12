import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MASTER_SCREEN_PROMPT } from './system-prompt.js';

describe('MASTER_SCREEN_PROMPT', () => {
  it('exists, is short and names the music tool', () => {
    assert.equal(typeof MASTER_SCREEN_PROMPT, 'string');
    assert.ok(MASTER_SCREEN_PROMPT.length > 0);
    assert.ok(MASTER_SCREEN_PROMPT.length < 2000, `too long: ${MASTER_SCREEN_PROMPT.length}`);
    assert.ok(MASTER_SCREEN_PROMPT.includes('suggest_music'));
  });

  it('has at most twelve lines', () => {
    assert.ok(MASTER_SCREEN_PROMPT.split('\n').length <= 12);
  });

  it('asks for images to be shown with campaign-relative paths only', () => {
    assert.ok(MASTER_SCREEN_PROMPT.includes('![Short description](images/valdrin.png)'));
    assert.ok(MASTER_SCREEN_PROMPT.includes('never an absolute path'));
    assert.ok(MASTER_SCREEN_PROMPT.includes('```mermaid'));
  });
});
