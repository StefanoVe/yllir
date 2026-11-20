import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRepaintInstruction, codexArgs, probeCodex, runCodex } from './codex.mjs';
import { PNG_SIGNATURE } from '../../../../scripts/lib/png-signature.mjs';

const PNG_HEX_BODY = '0000000d49484452';

// The existing tests run the fake codex with a sandboxed CODEX_HOME, so the fallback never
// reads the real ~/.codex of the machine running the tests.
process.env.CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-codex-home-'));

function makeCodexHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-codex-home-'));
}

function pngBytes(tag) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from(tag)]);
}

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

// ---- repaint jobs: the input picture is attached with -i, the prompt is sent word for word ----

const REPAINT_PROMPT_TEXT = 'Repaint the attached map as one uniform, finished, hand-painted fantasy map in the style: dark, muted, moody fantasy map. Output the same aspect ratio.';

function makeRepaintJobDir() {
  const dir = makeJobDir({ operation: 'repaint', prompt: REPAINT_PROMPT_TEXT, input: 'input.png', negative: null });
  fs.writeFileSync(path.join(dir, 'input.png'), Buffer.concat([PNG_SIGNATURE, Buffer.from('input')]));
  return dir;
}

// Records its own argv in args.json (in the job folder), then writes the PNG like the generate fake.
const RECORD_ARGS_THEN_WRITE_PNG = `
require('fs').writeFileSync('args.json', JSON.stringify(process.argv.slice(2)));
${WRITE_PNG_FROM_INSTRUCTION}
`;

test('repaint attaches the input picture with -i and sends the prompt after --', async () => {
  const jobDir = makeRepaintJobDir();
  const command = makeFake(RECORD_ARGS_THEN_WRITE_PNG);
  const result = await runCodex({ jobDir, command, timeoutMs: 10000, stallMs: 5000 });

  assert.deepEqual(result, { ok: true });
  const argv = JSON.parse(fs.readFileSync(path.join(jobDir, 'args.json'), 'utf8'));
  const i = argv.indexOf('-i');
  assert.ok(i > 0, 'the input must be attached with -i');
  assert.equal(argv[i + 1], path.join(jobDir, 'input.png'));
  assert.equal(argv[i + 2], '--');
  assert.ok(argv[i + 3].startsWith(REPAINT_PROMPT_TEXT + ' '), argv[i + 3]);
  assert.equal(argv.length, i + 4);
  const run = JSON.parse(fs.readFileSync(path.join(jobDir, 'run.json'), 'utf8'));
  assert.deepEqual(run, { provider: 'codex', parameters: { width: 512, height: 768 } });
});

test('repaint without its input picture fails before codex is spawned', async () => {
  const jobDir = makeJobDir({ operation: 'repaint', prompt: REPAINT_PROMPT_TEXT, input: 'input.png' });
  const result = await runCodex({ jobDir, command: '/nonexistent/codex', timeoutMs: 10000, stallMs: 5000 });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.ok(result.message.includes('input'), result.message);
});

test('the generate arguments never carry -i, and the repaint instruction is the prompt plus the save sentence only', () => {
  const generate = makeJobDir();
  const generateJob = JSON.parse(fs.readFileSync(path.join(generate, 'job.json'), 'utf8'));
  assert.equal(codexArgs(generateJob, generate, path.join(generate, 'result.png')).includes('-i'), false);

  const repaintJob = { operation: 'repaint', prompt: REPAINT_PROMPT_TEXT, input: 'input.png' };
  const instruction = buildRepaintInstruction(repaintJob, '/job/result.png');
  assert.equal(instruction.startsWith(REPAINT_PROMPT_TEXT + ' '), true);
  assert.ok(instruction.includes('at exactly this path: /job/result.png. '));
  assert.equal(instruction.includes('Description:'), false);
});

// ---- fallback: codex saved the PNG under <codexHome>/generated_images but did not copy it ----

// Writes the PNG into <home>/generated_images/sess/x.png and exits 0 without writing result.png.
function makeSavesElsewhere(home, name = 'x.png', tag = 'fresh') {
  return makeFake(`
const fs = require('fs');
const path = require('path');
const dir = path.join(${JSON.stringify(home)}, 'generated_images', 'sess');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, ${JSON.stringify(name)}), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('${PNG_HEX_BODY}', 'hex'), Buffer.from(${JSON.stringify(tag)})]));
process.exit(0);
`);
}

test('a PNG codex saved under codexHome is copied to result.png when codex did not copy it', async () => {
  const jobDir = makeJobDir();
  const codexHome = makeCodexHome();
  const command = makeSavesElsewhere(codexHome);
  const result = await runCodex({ jobDir, command, codexHome, timeoutMs: 10000, stallMs: 5000 });

  const source = path.join(codexHome, 'generated_images', 'sess', 'x.png');
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(fs.readFileSync(path.join(jobDir, 'result.png')), fs.readFileSync(source));
  assert.ok(fs.existsSync(source), 'the original must stay where codex saved it');
  const log = fs.readFileSync(path.join(jobDir, 'codex.log'), 'utf8');
  assert.ok(log.includes(`fallback: copied ${source}`), log);
  const run = JSON.parse(fs.readFileSync(path.join(jobDir, 'run.json'), 'utf8'));
  assert.deepEqual(run, { provider: 'codex', parameters: { width: 512, height: 768 } });
});

test('a stale PNG from an earlier run is ignored by the fallback', async () => {
  const jobDir = makeJobDir();
  const codexHome = makeCodexHome();
  const folder = path.join(codexHome, 'generated_images', 'old');
  fs.mkdirSync(folder, { recursive: true });
  const stale = path.join(folder, 'stale.png');
  fs.writeFileSync(stale, pngBytes('stale'));
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(stale, hourAgo, hourAgo);
  const command = makeFake('process.exit(0);');
  const result = await runCodex({ jobDir, command, codexHome, timeoutMs: 10000, stallMs: 5000 });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.equal(result.message, 'no image produced');
  assert.equal(fs.existsSync(path.join(jobDir, 'result.png')), false);
  assert.ok(fs.existsSync(stale), 'the stale original must not be moved or deleted');
});

test('with two fresh candidates the fallback copies the newest one', async () => {
  const jobDir = makeJobDir();
  const codexHome = makeCodexHome();
  const folder = path.join(codexHome, 'generated_images', 'sess');
  // The fake writes both files and sets their mtimes itself, after the run has started.
  const command = makeFake(`
const fs = require('fs');
const path = require('path');
const dir = ${JSON.stringify(folder)};
fs.mkdirSync(dir, { recursive: true });
const older = path.join(dir, 'older.png');
const newer = path.join(dir, 'newer.png');
fs.writeFileSync(newer, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('new')]));
fs.writeFileSync(older, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('old')]));
const now = Date.now();
fs.utimesSync(older, new Date(now - 1000), new Date(now - 1000));
fs.utimesSync(newer, new Date(now), new Date(now));
process.exit(0);
`);
  const result = await runCodex({ jobDir, command, codexHome, timeoutMs: 10000, stallMs: 5000 });

  assert.deepEqual(result, { ok: true });
  const copied = fs.readFileSync(path.join(jobDir, 'result.png'));
  assert.deepEqual(copied, pngBytes('new'), 'the newest candidate must be copied');
});

test('a non-PNG file is ignored by the fallback', async () => {
  const jobDir = makeJobDir();
  const codexHome = makeCodexHome();
  const folder = path.join(codexHome, 'generated_images', 'sess');
  // The fake writes a newer file that is not a PNG (fake png name), an older valid PNG, and a
  // newer PNG-bytes file with a non-PNG extension. Only the valid older PNG may be copied.
  const command = makeFake(`
const fs = require('fs');
const path = require('path');
const dir = ${JSON.stringify(folder)};
fs.mkdirSync(dir, { recursive: true });
const bogus = path.join(dir, 'bogus.png');
const valid = path.join(dir, 'valid.png');
const wrongExt = path.join(dir, 'notes.txt');
fs.writeFileSync(valid, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('valid')]));
fs.writeFileSync(bogus, 'this is not a png at all');
fs.writeFileSync(wrongExt, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('txt')]));
const now = Date.now();
fs.utimesSync(valid, new Date(now - 1000), new Date(now - 1000));
fs.utimesSync(bogus, new Date(now), new Date(now));
fs.utimesSync(wrongExt, new Date(now), new Date(now));
process.exit(0);
`);
  const result = await runCodex({ jobDir, command, codexHome, timeoutMs: 10000, stallMs: 5000 });

  assert.deepEqual(result, { ok: true });
  const copied = fs.readFileSync(path.join(jobDir, 'result.png'));
  assert.ok(copied.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE));
  assert.ok(copied.includes(Buffer.from('valid')), 'only the valid PNG may be copied');
  assert.equal(copied.includes(Buffer.from('txt')), false);
  assert.equal(copied.includes(Buffer.from('not a png')), false);
});

test('without a command argument, runCodex runs the binary named by YLLIR_CODEX_BIN', async () => {
  const jobDir = makeJobDir();
  const command = makeFake(WRITE_PNG_FROM_INSTRUCTION);
  const before = process.env.YLLIR_CODEX_BIN;
  process.env.YLLIR_CODEX_BIN = command;
  try {
    const result = await runCodex({ jobDir, timeoutMs: 10000, stallMs: 5000 });
    assert.deepEqual(result, { ok: true });
    assert.ok(fs.existsSync(path.join(jobDir, 'result.png')));
  } finally {
    if (before === undefined) delete process.env.YLLIR_CODEX_BIN;
    else process.env.YLLIR_CODEX_BIN = before;
  }
});
