import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { runFrameworkCli, splitCliOutput, FrameworkCliError, TIMED_OUT_CODE } from './cli.js';
import { createCtx, type Ctx } from './context.js';
import { FAKE_PRINT_CLI, makeFakeFramework, type FakeFramework } from './fake-framework.js';

describe('splitCliOutput', () => {
  it('takes the text before the last exit line as the body', () => {
    assert.deepEqual(splitCliOutput('{\n"a": 1\n}\nexit: 1\n'), { code: 1, body: '{\n"a": 1\n}' });
  });

  it('reports no code when the exit line is missing', () => {
    assert.deepEqual(splitCliOutput('{"a":1}'), { code: null, body: '{"a":1}' });
  });
});

describe('runFrameworkCli', () => {
  let fake: FakeFramework;
  let ctx: Ctx;
  let campaign: string;

  before(async () => {
    fake = await makeFakeFramework();
    campaign = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-cli-campaign-'));
    ctx = createCtx({ campaignRoot: campaign, frameworkRoot: fake.frameworkRoot, port: 1, log: () => {} });
  });

  after(async () => {
    await fake.cleanup();
    await fs.rm(campaign, { recursive: true, force: true });
  });

  it('returns the exit code and the JSON printed before the exit line', async () => {
    await fake.respond('list', { code: 1, json: { cards: [], note: 'partial' } });
    const result = await runFrameworkCli(ctx, FAKE_PRINT_CLI, ['list', campaign]);
    assert.equal(result.code, 1);
    assert.deepEqual(result.json, { cards: [], note: 'partial' });
  });

  it('passes the arguments as a list, never through a shell', async () => {
    await fake.respond('weird', { code: 0, json: {} });
    await runFrameworkCli(ctx, FAKE_PRINT_CLI, ['weird', '$(id); rm -rf /', '--x']);
    const calls = await fake.calls();
    const last = calls[calls.length - 1];
    assert.deepEqual(last.args, ['weird', '$(id); rm -rf /', '--x']);
  });

  it('turns output that is not JSON into a plain domain error without echoing it', async () => {
    await fake.respond('broken', { code: 0, raw: 'not json at all /Users/someone/secret' });
    await assert.rejects(
      runFrameworkCli(ctx, FAKE_PRINT_CLI, ['broken']),
      (err: unknown) => {
        assert.ok(err instanceof FrameworkCliError);
        assert.equal(err.reason, 'bad-output');
        assert.doesNotMatch(err.message, /secret|Users/);
        return true;
      },
    );
  });

  it('gives code 124 and no JSON when the CLI runs past the timeout', async () => {
    await fake.respond('slow', { code: 0, json: {}, sleepMs: 5000 });
    const result = await runFrameworkCli(ctx, FAKE_PRINT_CLI, ['slow'], { timeoutMs: 300 });
    assert.equal(result.code, TIMED_OUT_CODE);
    assert.equal(result.json, null);
  });
});
