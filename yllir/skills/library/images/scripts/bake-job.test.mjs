// Tests of bake-job.mjs. No Codex is run: runBake gets a fake runner, and the command
// line is only checked in --dry-run, which spawns nothing.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BAKE_PROMPT, BAKE_STYLES, buildBakePrompt, runBake } from './bake-job.mjs';
import { PNG_SIGNATURE } from './lib/png-signature.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BAKE_CLI = path.join(HERE, 'bake-job.mjs');

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-bake-'));
  tmpDirs.push(dir);
  return dir;
}

/** A PNG header of the given size: the signature, the IHDR chunk and a few padding bytes. */
function pngBytes(width, height, marker = 'x') {
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  return Buffer.concat([PNG_SIGNATURE, u32(13), Buffer.from('IHDR'), u32(width), u32(height), Buffer.from(marker)]);
}

function writeInput(dir, width = 640, height = 480) {
  const file = path.join(dir, 'atlas-input.png');
  fs.writeFileSync(file, pngBytes(width, height));
  return file;
}

/** A fake runner: writes result.png into the job folder and reports success. */
function fakeRunner(result = pngBytes(640, 480, 'painted')) {
  const calls = [];
  const runner = async ({ jobDir }) => {
    calls.push(jobDir);
    if (result === null) return { ok: false, error: 'timeout', message: 'codex did not finish in time and was stopped' };
    fs.writeFileSync(path.join(jobDir, 'result.png'), result);
    return { ok: true };
  };
  return { runner, calls };
}

test('the prompt is the fixed text with only the style description added', () => {
  for (const [id, description] of Object.entries(BAKE_STYLES)) {
    const prompt = buildBakePrompt(id);
    assert.equal(prompt, BAKE_PROMPT.replace('{STYLE}', description));
    assert.ok(prompt.includes(`in the style: ${description}.`), id);
    assert.equal(prompt.includes('{STYLE}'), false);
    assert.equal(BAKE_PROMPT.split('{STYLE}').length - 1, 1);
  }
  assert.deepEqual(Object.keys(BAKE_STYLES), ['fantasy-color', 'antique-parchment', 'dark-fantasy']);
});

test('the prompt is multi-line with the sections in order', () => {
  const sections = [
    'TASK:',
    'READ THE INPUT:',
    'GEOMETRY IS FIXED (highest priority):',
    'NOTHING ADDED, NOTHING REMOVED:',
    'NO TEXT OR FURNITURE:',
    'UNIFORMITY:',
    'OUTPUT:',
  ];
  const lines = BAKE_PROMPT.split('\n');
  const starts = sections.map((label) => {
    assert.ok(lines.includes(label), label);
    return lines.indexOf(label);
  });
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.ok(lines.length > sections.length);
});

test('the prompt carries the geometry, no-text and uniformity rules', () => {
  const prompt = buildBakePrompt('fantasy-color');
  for (const phrase of [
    'same pixel position',
    'no crop',
    'no rotation',
    'no zoom',
    'no shift',
    'no mirror',
    'no perspective',
    'Do not add islands',
    'no text',
    'No text, letters, numbers',
    'same aspect ratio',
    'One consistent light direction',
    'no fade to white or black',
  ]) {
    assert.ok(prompt.toLowerCase().includes(phrase.toLowerCase()), phrase);
  }
});

test('an unknown style has no prompt', () => {
  assert.equal(buildBakePrompt('watercolour'), null);
  assert.equal(buildBakePrompt('constructor'), null);
});

test('runBake builds the job folder, runs it and copies the result to the output', async () => {
  const dir = tempDir();
  const input = writeInput(dir);
  const out = path.join(dir, 'out', 'baked.png');
  const jobDir = path.join(dir, 'bake-job');
  const { runner, calls } = fakeRunner();

  const result = await runBake({ inputPath: input, styleId: 'dark-fantasy', outPath: out, jobDir, runner });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [jobDir]);
  const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
  assert.equal(job.operation, 'bake');
  assert.equal(job.prompt, buildBakePrompt('dark-fantasy'));
  assert.equal(job.input, 'input.png');
  assert.equal(job.width, 640);
  assert.equal(job.height, 480);
  assert.ok(fs.readFileSync(path.join(jobDir, 'input.png')).equals(pngBytes(640, 480)));
  assert.ok(fs.readFileSync(out).equals(pngBytes(640, 480, 'painted')));
});

test('a failed run is reported with its error and writes no output', async () => {
  const dir = tempDir();
  const out = path.join(dir, 'baked.png');
  const { runner } = fakeRunner(null);

  const result = await runBake({
    inputPath: writeInput(dir), styleId: 'antique-parchment', outPath: out, jobDir: path.join(dir, 'job'), runner,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'timeout');
  assert.equal(fs.existsSync(out), false);
});

test('a bake job never reuses a result of an earlier job folder', async () => {
  const dir = tempDir();
  const jobDir = path.join(dir, 'job');
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'result.png'), pngBytes(1, 1, 'stale'));
  const runner = async () => ({ ok: false, error: 'failed', message: 'no image produced' });

  const result = await runBake({
    inputPath: writeInput(dir), styleId: 'fantasy-color', outPath: path.join(dir, 'baked.png'), jobDir, runner,
  });

  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(dir, 'baked.png')), false);
});

test('an input that is not a PNG is refused before any run', async () => {
  const dir = tempDir();
  const input = path.join(dir, 'atlas-input.png');
  fs.writeFileSync(input, 'not a picture');
  const { runner, calls } = fakeRunner();

  const result = await runBake({
    inputPath: input, styleId: 'fantasy-color', outPath: path.join(dir, 'baked.png'), jobDir: path.join(dir, 'job'), runner,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.deepEqual(calls, []);
});

test('an unknown style is refused before any run', async () => {
  const dir = tempDir();
  const { runner, calls } = fakeRunner();

  const result = await runBake({
    inputPath: writeInput(dir), styleId: 'neon', outPath: path.join(dir, 'baked.png'), jobDir: path.join(dir, 'job'), runner,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(calls, []);
});

test('--dry-run prints the exact prompt and the command, and writes nothing', () => {
  const dir = tempDir();
  const input = writeInput(dir);
  const out = path.join(dir, 'baked.png');
  const result = spawnSync(process.execPath, [BAKE_CLI, '--atlas-input', input, '--style', 'fantasy-color', '--out', out, '--dry-run'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const prompt = buildBakePrompt('fantasy-color');
  // The prompt is multi-line, so it is printed first as a whole; the command line follows it.
  assert.ok(result.stdout.startsWith(`prompt: ${prompt}\ncommand: `), result.stdout);
  const lines = result.stdout.split('\n');
  const commandLine = lines.at(-3);
  assert.ok(commandLine.startsWith('command: codex exec --skip-git-repo-check --enable image_generation --sandbox workspace-write -C '), commandLine);
  // The command line carries the prompt JSON-quoted on one line, so newlines are escaped there.
  const quotedPrompt = JSON.stringify(prompt).slice(0, -1);
  assert.ok(commandLine.includes(` -i ${path.join(dir, 'bake-job', 'input.png')} -- ${quotedPrompt} `), commandLine);
  assert.equal(lines.at(-2), 'exit: 0');
  assert.equal(fs.existsSync(path.join(dir, 'bake-job')), false);
  assert.equal(fs.existsSync(out), false);
});

test('a missing option is a usage error (exit 2)', () => {
  const result = spawnSync(process.execPath, [BAKE_CLI, '--style', 'fantasy-color', '--out', 'x.png'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes('usage: node bake-job.mjs'), result.stderr);
});

test('an unknown style on the command line is a usage error (exit 2)', () => {
  const dir = tempDir();
  const result = spawnSync(process.execPath, [BAKE_CLI, '--atlas-input', writeInput(dir), '--style', 'neon', '--out', path.join(dir, 'x.png')], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes('unknown style neon'), result.stderr);
});

test('a non-PNG input on the command line prints a failure line and exits 1', () => {
  const dir = tempDir();
  const input = path.join(dir, 'atlas-input.png');
  fs.writeFileSync(input, 'nope');
  const result = spawnSync(process.execPath, [BAKE_CLI, '--atlas-input', input, '--style', 'fantasy-color', '--out', path.join(dir, 'x.png')], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.ok(result.stdout.startsWith('result: failed\nerror: failed\nmessage: '), result.stdout);
  assert.ok(result.stdout.endsWith('exit: 1\n'), result.stdout);
});
