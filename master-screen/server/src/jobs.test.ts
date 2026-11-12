import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCtx } from './context.js';
import { runExclusiveJob } from './jobs.js';
import { plainSentence } from './plain.js';

describe('per-campaign job lock', () => {
  const ctxFor = (root: string) => createCtx({ campaignRoot: root, frameworkRoot: root, port: 1, log: () => {} });

  it('refuses a second job of the same campaign while the first runs, and releases after', async () => {
    const ctx = ctxFor('/tmp/lock-a');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runExclusiveJob(ctx, () => held.then(() => 'done'));
    const second = await runExclusiveJob(ctx, async () => 'never');
    assert.deepEqual(second, { busy: true });
    release();
    assert.deepEqual(await first, { busy: false, value: 'done' });
    assert.deepEqual(await runExclusiveJob(ctx, async () => 'again'), { busy: false, value: 'again' });
  });

  it('releases the slot when the job throws', async () => {
    const ctx = ctxFor('/tmp/lock-b');
    await assert.rejects(runExclusiveJob(ctx, async () => {
      throw new Error('boom');
    }));
    assert.deepEqual(await runExclusiveJob(ctx, async () => 1), { busy: false, value: 1 });
  });

  it('does not block other campaigns', async () => {
    const held = new Promise<void>(() => {});
    void runExclusiveJob(ctxFor('/tmp/lock-c'), () => held);
    assert.deepEqual(await runExclusiveJob(ctxFor('/tmp/lock-d'), async () => 'free'), { busy: false, value: 'free' });
  });
});

describe('plainSentence', () => {
  it('keeps a short plain sentence', () => {
    assert.equal(plainSentence('Two entries share the same name.', 'fallback'), 'Two entries share the same name.');
  });

  it('replaces paths, file names, code words and control characters with the fallback', () => {
    for (const bad of [
      '/Users/x/campaign/a.md is broken',
      'C:\\Users\\x',
      'failed in scripts/engine.mjs',
      'the commit failed',
      'sha mismatch',
      'bad frontmatter here',
      'line\nbreak',
      '',
      'x'.repeat(301),
    ]) {
      assert.equal(plainSentence(bad, 'fallback'), 'fallback', bad);
    }
    assert.equal(plainSentence(42, 'fallback'), 'fallback');
  });
});
