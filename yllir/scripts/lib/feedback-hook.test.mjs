import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { frameworkVersion, hookRoot, isCampaign } from './feedback-hook.mjs';

test('isCampaign is true only when campaign.yaml exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-fbhook-'));
  try {
    assert.equal(isCampaign(dir), false);
    fs.writeFileSync(path.join(dir, 'campaign.yaml'), 'name: t\n');
    assert.equal(isCampaign(dir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('frameworkVersion returns a semver-like version', () => {
  assert.match(frameworkVersion(), /^\d+\.\d+\.\d+/);
});

test('hookRoot uses the first non-flag argument', () => {
  assert.equal(hookRoot(['node', 'script.mjs', 'some/dir']), path.resolve('some/dir'));
  assert.equal(hookRoot(['node', 'script.mjs', '--x', '/abs/dir']), path.resolve('/abs/dir'));
});

test('hookRoot falls back to CLAUDE_PROJECT_DIR, then the working directory', () => {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  try {
    process.env.CLAUDE_PROJECT_DIR = '/some/project';
    assert.equal(hookRoot(['node', 'script.mjs']), path.resolve('/some/project'));
    delete process.env.CLAUDE_PROJECT_DIR;
    assert.equal(hookRoot(['node', 'script.mjs']), path.resolve(process.cwd()));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = saved;
  }
});
