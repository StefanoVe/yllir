import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { musicEnabledAtStartup, musicEnabledInYaml } from './config.js';

describe('musicEnabledInYaml', () => {
  it('reads modules.music true, in any quoting, with a comment', () => {
    assert.equal(musicEnabledInYaml('modules:\n  music: true\n'), true);
    assert.equal(musicEnabledInYaml('modules:\n  music: "true"  # on\n'), true);
    assert.equal(musicEnabledInYaml("modules: # all\n  print: false\n  music: 'true'\n"), true);
  });

  it('is off when the flag is false, missing, or outside the modules block', () => {
    assert.equal(musicEnabledInYaml('modules:\n  music: false\n'), false);
    assert.equal(musicEnabledInYaml('modules:\n  print: true\n'), false);
    assert.equal(musicEnabledInYaml('campaign:\n  name: x\n'), false);
    assert.equal(musicEnabledInYaml('music: true\n'), false);
    assert.equal(musicEnabledInYaml('modules:\n  print: true\nother:\n  music: true\n'), false);
  });

  it('is off when campaign.yaml does not exist', () => {
    assert.equal(musicEnabledAtStartup('/definitely/not/a/campaign/folder'), false);
  });
});
