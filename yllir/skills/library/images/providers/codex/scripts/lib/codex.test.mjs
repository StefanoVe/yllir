import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeCodex, runCodex } from './codex.mjs';
import { PNG_SIGNATURE } from '../../../../scripts/lib/png-signature.mjs';

const PNG_HEX_BODY = '0000000d49484452';

function makeJobDir(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-codex-'));
  const job = {
    id: 'job-1',
    operation: 'generate',
    document: 'doc.md',
    prompt: 'a red fox in the snow',
    negative: null,
    width: 512,
    height: 768,
    seed: 1,
    input: null,
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job));
  return dir;
}

function makeFake(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-codex-fake-'));
  const file = path.join(dir, 'fake-codex.cjs');
  fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

const WRITE_PNG_FROM_INSTRUCTION = `
const fs = require('fs');
const instruction = process.argv[process.argv.length - 1];
const marker = 'at exactly this path: ';
const start = instruction.indexOf(marker) + marker.length;
const end = instruction.indexOf('. If', start);
const target = instruction.slice(start, end);
fs.writeFileSync(target, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('${PNG_HEX_BODY}', 'hex')]));
process.exit(0);
`;

test('writes the image and run.json when codex produces a PNG', async () => {
  const jobDir = makeJobDir();
  const command = makeFake(WRITE_PNG_FROM_INSTRUCTION);
  const result = await runCodex({ jobDir, command, timeoutMs: 10000, stallMs: 5000 });

  assert.deepEqual(result, { ok: true });
  const png = fs.readFileSync(path.join(jobDir, 'result.png'));
  assert.ok(png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE));
  const run = JSON.parse(fs.readFileSync(path.join(jobDir, 'run.json'), 'utf8'));
  assert.deepEqual(run, { provider: 'codex', parameters: { width: 512, height: 768 } });
  assert.ok(fs.existsSync(path.join(jobDir, 'codex.log')));
});

test('exit 0 without an image is a failure', async () => {
  const jobDir = makeJobDir();
  const command = makeFake('process.exit(0);');
  const result = await runCodex({ jobDir, command, timeoutMs: 10000, stallMs: 5000 });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.equal(result.message, 'no image produced');
  assert.equal(fs.existsSync(path.join(jobDir, 'run.json')), false);
});

test('a stale result.png from an earlier attempt is never a success', async () => {
  const jobDir = makeJobDir();
  fs.writeFileSync(path.join(jobDir, 'result.png'), Buffer.concat([PNG_SIGNATURE, Buffer.from('stale')]));
  fs.writeFileSync(path.join(jobDir, 'run.json'), '{"stale":true}\n');
  const command = makeFake('process.exit(0);');
  const result = await runCodex({ jobDir, command, timeoutMs: 10000, stallMs: 5000 });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.equal(result.message, 'no image produced');
  assert.equal(fs.existsSync(path.join(jobDir, 'result.png')), false);
  assert.equal(fs.existsSync(path.join(jobDir, 'run.json')), false);
});

test('non-zero exit reports the last log line', async () => {
  const jobDir = makeJobDir();
  const command = makeFake("process.stderr.write('boom\\n'); process.exit(3);");
  const result = await runCodex({ jobDir, command, timeoutMs: 10000, stallMs: 5000 });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.ok(result.message.includes('boom'), result.message);
});

test('a silent codex is stopped by the stall watchdog', async () => {
  const jobDir = makeJobDir();
  const command = makeFake('setInterval(() => {}, 1000);');
  const started = Date.now();
  const result = await runCodex({ jobDir, command, timeoutMs: 60000, stallMs: 200 });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'timeout');
  assert.ok(Date.now() - started < 10000, 'the child must be killed quickly');
});

test('stdin is closed, so codex sees end of input and finishes', async () => {
  const jobDir = makeJobDir();
  const command = makeFake(`
const fs = require('fs');
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  const instruction = process.argv[process.argv.length - 1];
  const marker = 'at exactly this path: ';
  const start = instruction.indexOf(marker) + marker.length;
  const end = instruction.indexOf('. If', start);
  fs.writeFileSync(instruction.slice(start, end), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('${PNG_HEX_BODY}', 'hex')]));
  process.exit(0);
});
`);
  const result = await runCodex({ jobDir, command, timeoutMs: 60000, stallMs: 3000 });

  assert.deepEqual(result, { ok: true });
});

test('a missing codex command is unavailable', async () => {
  const jobDir = makeJobDir();
  const result = await runCodex({ jobDir, command: '/nonexistent/codex', timeoutMs: 10000, stallMs: 5000 });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'unavailable');
});

test('remove_background is unsupported and codex is never spawned', async () => {
  const jobDir = makeJobDir({ operation: 'remove_background', input: 'result.png' });
  const result = await runCodex({ jobDir, command: '/nonexistent/codex', timeoutMs: 10000, stallMs: 5000 });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'unsupported');
  assert.equal(fs.existsSync(path.join(jobDir, 'codex.log')), false);
});

test('probeCodex reads the version of a working codex', async () => {
  const command = makeFake("console.log('codex-cli 9.9.9');");
  const probe = await probeCodex({ command, timeoutMs: 5000 });

  assert.equal(probe.available, true);
  assert.equal(probe.version, 'codex-cli 9.9.9');
});

test('probeCodex reports a missing codex as not-installed', async () => {
  const probe = await probeCodex({ command: '/nonexistent/codex', timeoutMs: 5000 });

  assert.equal(probe.available, false);
  assert.equal(probe.reason, 'not-installed');
});
