import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createCtx, type Ctx } from './context.js';
import { loadFrameworkModule, parseEngineOutput, runEngine } from './engine.js';

// A fake framework: an engine that echoes its arguments, a slow command and a failing one,
// plus one library module. Nothing from the real framework is needed here.
const FAKE_ENGINE = `
const [command, campaign, ...rest] = process.argv.slice(2);
if (command === 'slow') {
  setInterval(() => {}, 1000);
} else if (command === 'fail') {
  process.stdout.write('{"problem":true}\\n');
  process.stdout.write('exit: 3\\n');
  process.exitCode = 3;
} else if (command === 'noisy') {
  process.stdout.write('{"command":"noisy"}\\n');
  process.stderr.write('warning on stderr\\n');
  process.stdout.write('exit: 0\\n');
} else {
  process.stdout.write(JSON.stringify({ command, campaign, rest, ok: true }, null, 2) + '\\n');
  process.stdout.write('exit: 0\\n');
}
`;

const FAKE_PROBE = `export const value = 42;\n`;

describe('parseEngineOutput', () => {
  it('takes the JSON before the last exit line', () => {
    const parsed = parseEngineOutput('{\n  "a": 1\n}\nexit: 0\n');
    assert.equal(parsed.code, 0);
    assert.deepEqual(parsed.json, { a: 1 });
  });

  it('gives a null JSON for a body that is not JSON, and a null code without an exit line', () => {
    assert.deepEqual(parseEngineOutput('plain text\nexit: 4\n'), { code: 4, json: null });
    assert.deepEqual(parseEngineOutput('{"b":2}'), { code: null, json: { b: 2 } });
  });
});

describe('runEngine and loadFrameworkModule', () => {
  let tmp: string;
  let ctx: Ctx;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-engine-'));
    const framework = path.join(tmp, 'framework');
    const campaign = path.join(tmp, 'campaign');
    await fs.mkdir(path.join(framework, 'scripts', 'lib'), { recursive: true });
    await fs.mkdir(campaign, { recursive: true });
    await fs.writeFile(path.join(framework, 'scripts', 'engine.mjs'), FAKE_ENGINE, 'utf8');
    await fs.writeFile(path.join(framework, 'scripts', 'lib', 'probe.mjs'), FAKE_PROBE, 'utf8');
    ctx = createCtx({ campaignRoot: campaign, frameworkRoot: framework, port: 4317, log: () => {} });
  });

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('runs the engine with the campaign folder after the command, and returns code and JSON', async () => {
    const result = await runEngine<{ command: string; campaign: string; rest: string[] }>(ctx, [
      'check',
      '--flag',
      'value with spaces; not a shell',
    ]);
    assert.equal(result.code, 0);
    assert.equal(result.json?.command, 'check');
    assert.equal(result.json?.campaign, ctx.campaignRoot);
    assert.deepEqual(result.json?.rest, ['--flag', 'value with spaces; not a shell']);
  });

  it('returns the code printed by the engine and its JSON when the command fails', async () => {
    const result = await runEngine(ctx, ['fail']);
    assert.equal(result.code, 3);
    assert.deepEqual(result.json, { problem: true });
  });

  it('keeps stdout when the engine writes to stderr', async () => {
    const result = await runEngine(ctx, ['noisy']);
    assert.equal(result.code, 0);
    assert.deepEqual(result.json, { command: 'noisy' });
  });

  it('stops a command that runs past the timeout and reports code 124', async () => {
    const result = await runEngine(ctx, ['slow'], { timeoutMs: 300 });
    assert.equal(result.code, 124);
    assert.equal(result.json, null);
  });

  it('rejects an empty argument list', async () => {
    await assert.rejects(runEngine(ctx, []));
  });

  it('loads a framework library module once and caches it', async () => {
    const first = await loadFrameworkModule<{ value: number }>(ctx, 'probe');
    const second = await loadFrameworkModule<{ value: number }>(ctx, 'probe');
    assert.equal(first.value, 42);
    assert.equal(first, second);
  });

  it('rejects a module name that is not a plain file name', async () => {
    await assert.rejects(loadFrameworkModule(ctx, '../engine'));
  });
});
