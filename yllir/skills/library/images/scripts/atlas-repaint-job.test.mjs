// Tests of atlas-repaint-job.mjs. No Codex is run: runRepaint gets a fake runner, and the CLI
// tests either stop before the provider (dry run, usage errors) or use a fake codex binary
// through YLLIR_CODEX_BIN.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildRepaintPrompt,
  MAX_PROMPT_CHARS,
  readPromptFile,
  REPAINT_STYLES,
  REPAINT_WRAPPER,
  repaintJobDir,
  runRepaint,
  SEA_WRAPPER,
} from './atlas-repaint-job.mjs';
import { PNG_SIGNATURE } from './lib/png-signature.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPAINT_CLI = path.join(HERE, 'atlas-repaint-job.mjs');

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-repaint-'));
  tmpDirs.push(dir);
  return dir;
}

/** A PNG of the given size: the signature, the IHDR chunk and `padding` zero bytes after it. */
function pngBytes(width, height, padding = 2048) {
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  return Buffer.concat([PNG_SIGNATURE, u32(13), Buffer.from('IHDR'), u32(width), u32(height), Buffer.alloc(5 + padding)]);
}

const PROMPT_TEXT = 'Paint the coast in the east, keep Velmar and the old bridge visible.';

function writePrompt(dir, text = PROMPT_TEXT, name = 'prompt.txt') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
}

function writeInput(dir, width = 640, height = 480) {
  const file = path.join(dir, 'crop.png');
  fs.writeFileSync(file, pngBytes(width, height));
  return file;
}

/** A fake runner: writes result.png into the job folder and reports success. */
function fakeRunner(result = pngBytes(640, 480, 4096)) {
  const calls = [];
  const runner = async ({ jobDir }) => {
    calls.push(jobDir);
    if (result === null) return { ok: false, error: 'timeout', message: 'codex did not finish in time and was stopped' };
    fs.writeFileSync(path.join(jobDir, 'result.png'), result);
    return { ok: true };
  };
  return { runner, calls };
}

function cli(args, env = process.env) {
  return spawnSync(process.execPath, [REPAINT_CLI, ...args], { encoding: 'utf8', env });
}

// ---- the prompt ----

test('the prompt is the fixed wrapper, the style, the frame and the request, with no placeholder left', () => {
  for (const mode of ['crop', 'base']) {
    const prompt = buildRepaintPrompt({ mode, promptText: PROMPT_TEXT, styleId: 'dark-fantasy', width: 640, height: 480 });
    assert.ok(prompt.startsWith('TASK:\n'), mode);
    assert.ok(prompt.includes('in the style: dark, muted, moody fantasy map.'), mode);
    assert.equal(prompt.includes('{STYLE}'), false);
    assert.equal(prompt.includes('{FRAME}'), false);
    assert.ok(prompt.endsWith(`REQUEST:\n${PROMPT_TEXT}`), mode);
  }
  assert.ok(REPAINT_WRAPPER.includes('{STYLE}') && REPAINT_WRAPPER.includes('{FRAME}'));
});

test('the wrapper forbids text and furniture, and keeps every named settlement visible', () => {
  const prompt = buildRepaintPrompt({ mode: 'crop', promptText: PROMPT_TEXT, styleId: 'fantasy-color', width: 640, height: 480 });
  for (const phrase of [
    'Never write any text anywhere on the image',
    'compass rose',
    'scale bar',
    'coordinate grid',
    'Every named settlement in the REQUEST must stay visible',
    'same pixel position',
    'no crop',
    'no zoom',
    'Add or remove nothing unless the REQUEST asks for it',
  ]) {
    assert.ok(prompt.includes(phrase), phrase);
  }
});

test('a crop prompt names the attached reference, a base prompt names the aspect ratio', () => {
  const crop = buildRepaintPrompt({ mode: 'crop', promptText: PROMPT_TEXT, styleId: 'fantasy-color', width: 640, height: 480 });
  assert.ok(crop.includes('A reference image is attached'));
  assert.equal(crop.includes('There is no reference image'), false);

  const base = buildRepaintPrompt({ mode: 'base', promptText: PROMPT_TEXT, styleId: 'fantasy-color', width: 1024, height: 768 });
  assert.ok(base.includes('There is no reference image'));
  assert.ok(base.includes('1024x768'));
  assert.equal(base.includes('A reference image is attached'), false);
});

test('a sea prompt is the sea wrapper, says whether a reference is attached, and ends with the request', () => {
  const withRef = buildRepaintPrompt({ mode: 'sea', promptText: PROMPT_TEXT, styleId: 'fantasy-color', width: 1024, height: 1024, hasInput: true });
  const noRef = buildRepaintPrompt({ mode: 'sea', promptText: PROMPT_TEXT, styleId: 'fantasy-color', width: 1024, height: 1024 });
  for (const prompt of [withRef, noRef]) {
    assert.ok(prompt.startsWith('TASK:\n'));
    assert.ok(prompt.includes('top-down texture of open sea water'));
    assert.ok(prompt.includes('in the style: colourful hand-painted fantasy map.'));
    assert.equal(prompt.includes('{STYLE}'), false);
    assert.equal(prompt.includes('{FRAME}'), false);
    assert.ok(prompt.endsWith(`REQUEST:\n${PROMPT_TEXT}`));
  }
  assert.ok(withRef.includes('A reference image is attached') && withRef.includes('Match its water colour'));
  assert.equal(withRef.includes('There is no reference image'), false);
  assert.ok(noRef.includes('There is no reference image'));
  assert.equal(noRef.includes('A reference image is attached'), false);
  assert.ok(SEA_WRAPPER.includes('{STYLE}') && SEA_WRAPPER.includes('{FRAME}'));
});

test('the styles are the three descriptions of the earlier style table, and an unknown style has no prompt', () => {
  assert.deepEqual(REPAINT_STYLES, {
    'fantasy-color': 'colourful hand-painted fantasy map',
    'antique-parchment': 'aged parchment map in sepia inks',
    'dark-fantasy': 'dark, muted, moody fantasy map',
  });
  assert.equal(buildRepaintPrompt({ mode: 'base', promptText: 'x', styleId: 'neon', width: 1, height: 1 }), null);
  assert.equal(buildRepaintPrompt({ mode: 'base', promptText: 'x', styleId: 'constructor', width: 1, height: 1 }), null);
});

test('the prompt file is refused when it is empty or longer than the limit', () => {
  const dir = tempDir();
  assert.equal(readPromptFile(writePrompt(dir, 'a'.repeat(MAX_PROMPT_CHARS))).length, MAX_PROMPT_CHARS);
  assert.throws(() => readPromptFile(writePrompt(dir, 'a'.repeat(MAX_PROMPT_CHARS + 1), 'long.txt')), /longer than 6000/);
  assert.throws(() => readPromptFile(writePrompt(dir, '  \n', 'empty.txt')), /empty/);
  assert.throws(() => readPromptFile(path.join(dir, 'missing.txt')), /not readable/);
});

// ---- runRepaint ----

test('a crop repaint sends the crop as the input picture and copies the result', async () => {
  const dir = tempDir();
  const input = writeInput(dir, 800, 600);
  const out = path.join(dir, 'out', 'base.png');
  const jobDir = repaintJobDir(out);
  assert.equal(jobDir, path.join(dir, 'out', 'repaint-job'));
  const { runner, calls } = fakeRunner();

  const result = await runRepaint({
    mode: 'crop', promptText: PROMPT_TEXT, styleId: 'dark-fantasy', inputPath: input, outPath: out, jobDir, runner,
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [jobDir]);
  const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
  assert.equal(job.operation, 'repaint');
  assert.equal(job.input, 'input.png');
  assert.equal(job.width, 800);
  assert.equal(job.height, 600);
  assert.equal(job.prompt, buildRepaintPrompt({ mode: 'crop', promptText: PROMPT_TEXT, styleId: 'dark-fantasy', width: 800, height: 600 }));
  assert.ok(fs.readFileSync(path.join(jobDir, 'input.png')).equals(pngBytes(800, 600)));
  assert.ok(fs.readFileSync(out).equals(pngBytes(640, 480, 4096)));
});

test('a base repaint has no input picture and takes its size from --size', async () => {
  const dir = tempDir();
  const out = path.join(dir, 'base.png');
  const jobDir = repaintJobDir(out);
  const { runner } = fakeRunner();

  const result = await runRepaint({
    mode: 'base', promptText: PROMPT_TEXT, styleId: 'fantasy-color', size: { width: 1024, height: 768 }, outPath: out, jobDir, runner,
  });

  assert.deepEqual(result, { ok: true });
  const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
  assert.equal(job.operation, 'repaint');
  assert.equal(job.input, null);
  assert.equal(job.width, 1024);
  assert.equal(job.height, 768);
  assert.equal(fs.existsSync(path.join(jobDir, 'input.png')), false);
  assert.ok(fs.existsSync(out));
});

test('a failed run is reported with its error and writes no output', async () => {
  const dir = tempDir();
  const out = path.join(dir, 'base.png');
  const { runner } = fakeRunner(null);

  const result = await runRepaint({
    mode: 'base', promptText: PROMPT_TEXT, styleId: 'fantasy-color', size: { width: 512, height: 512 },
    outPath: out, jobDir: repaintJobDir(out), runner,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'timeout');
  assert.equal(fs.existsSync(out), false);
});

test('a result that is not a usable PNG (tiny, or not a PNG) is a failure and writes no output', async () => {
  for (const [name, bytes] of [
    ['tiny', pngBytes(640, 480, 10)],
    ['text', Buffer.from('this is not a picture, just words'.repeat(100))],
  ]) {
    const dir = tempDir();
    const out = path.join(dir, 'base.png');
    const { runner } = fakeRunner(bytes);
    const result = await runRepaint({
      mode: 'base', promptText: PROMPT_TEXT, styleId: 'fantasy-color', size: { width: 512, height: 512 },
      outPath: out, jobDir: repaintJobDir(out), runner,
    });
    assert.equal(result.ok, false, name);
    assert.equal(result.error, 'failed', name);
    assert.equal(fs.existsSync(out), false, name);
  }
});

test('a repaint never reuses a result of an earlier job folder', async () => {
  const dir = tempDir();
  const out = path.join(dir, 'base.png');
  const jobDir = repaintJobDir(out);
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'result.png'), pngBytes(640, 480, 4096));
  const runner = async () => ({ ok: false, error: 'failed', message: 'no image produced' });

  const result = await runRepaint({
    mode: 'base', promptText: PROMPT_TEXT, styleId: 'fantasy-color', size: { width: 640, height: 480 }, outPath: out, jobDir, runner,
  });

  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(out), false);
});

test('a crop input that is not a PNG is refused before any run', async () => {
  const dir = tempDir();
  const input = path.join(dir, 'crop.png');
  fs.writeFileSync(input, 'not a picture');
  const { runner, calls } = fakeRunner();

  const result = await runRepaint({
    mode: 'crop', promptText: PROMPT_TEXT, styleId: 'fantasy-color', inputPath: input,
    outPath: path.join(dir, 'base.png'), jobDir: path.join(dir, 'job'), runner,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.deepEqual(calls, []);
});

test('a sea repaint without input has no input picture and uses the given square size', async () => {
  const dir = tempDir();
  const out = path.join(dir, 'sea.png');
  const jobDir = repaintJobDir(out);
  const { runner, calls } = fakeRunner();

  const result = await runRepaint({
    mode: 'sea', promptText: PROMPT_TEXT, styleId: 'fantasy-color', size: { width: 1024, height: 1024 }, outPath: out, jobDir, runner,
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [jobDir]);
  const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
  assert.equal(job.input, null);
  assert.equal(job.width, 1024);
  assert.equal(job.height, 1024);
  assert.equal(fs.existsSync(path.join(jobDir, 'input.png')), false);
  assert.ok(fs.existsSync(out));
});

test('a sea repaint with input sends the reference but keeps the requested output size', async () => {
  const dir = tempDir();
  const input = writeInput(dir, 640, 480);
  const out = path.join(dir, 'sea.png');
  const jobDir = repaintJobDir(out);
  const { runner } = fakeRunner();

  const result = await runRepaint({
    mode: 'sea', promptText: PROMPT_TEXT, styleId: 'fantasy-color', inputPath: input,
    size: { width: 1024, height: 1024 }, outPath: out, jobDir, runner,
  });

  assert.deepEqual(result, { ok: true });
  const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
  assert.equal(job.input, 'input.png');
  assert.equal(job.width, 1024);
  assert.equal(job.height, 1024);
  assert.ok(fs.readFileSync(path.join(jobDir, 'input.png')).equals(pngBytes(640, 480)));
  assert.ok(job.prompt.includes('A reference image is attached'));
});

// ---- the command line ----

test('--dry-run prints the final prompt and the command, and writes nothing', () => {
  const dir = tempDir();
  const prompt = writePrompt(dir);
  const input = writeInput(dir, 640, 480);
  const out = path.join(dir, 'base.png');

  const result = cli(['--mode', 'crop', '--prompt-file', prompt, '--out', out, '--input', input, '--style', 'dark-fantasy', '--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  const finalPrompt = buildRepaintPrompt({ mode: 'crop', promptText: PROMPT_TEXT, styleId: 'dark-fantasy', width: 640, height: 480 });
  assert.ok(result.stdout.startsWith(`prompt: ${finalPrompt}\ncommand: codex exec `), result.stdout);
  assert.ok(result.stdout.endsWith('exit: 0\n'), result.stdout);
  const commandLine = result.stdout.split('\n').at(-3);
  assert.ok(commandLine.includes(` -i ${path.join(dir, 'repaint-job', 'input.png')} -- `), commandLine);
  assert.equal(fs.existsSync(path.join(dir, 'repaint-job')), false);
  assert.equal(fs.existsSync(out), false);
});

test('--dry-run of a base repaint has no -i in the command', () => {
  const dir = tempDir();
  const result = cli(['--mode', 'base', '--prompt-file', writePrompt(dir), '--out', path.join(dir, 'b.png'), '--size', '1024x768', '--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('1024x768'));
  const commandLine = result.stdout.split('\n').at(-3);
  assert.equal(commandLine.includes(' -i '), false, commandLine);
});

test('usage errors exit 2 with the reason on stderr', () => {
  const dir = tempDir();
  const prompt = writePrompt(dir);
  const longPrompt = writePrompt(dir, 'a'.repeat(MAX_PROMPT_CHARS + 1), 'long.txt');
  const input = writeInput(dir);
  const out = path.join(dir, 'x.png');
  const cases = [
    [['--mode', 'base', '--prompt-file', prompt], 'usage: node atlas-repaint-job.mjs'],
    [['--mode', 'crop', '--prompt-file', prompt, '--out', out], 'needs --input'],
    [['--mode', 'base', '--prompt-file', prompt, '--out', out, '--input', input, '--size', '640x480'], 'takes no --input'],
    [['--mode', 'base', '--prompt-file', prompt, '--out', out], 'needs --size'],
    [['--mode', 'base', '--prompt-file', prompt, '--out', out, '--size', 'big'], '--size must be WxH'],
    [['--mode', 'paint', '--prompt-file', prompt, '--out', out, '--size', '640x480'], '--mode must be base or crop'],
    [['--mode', 'base', '--prompt-file', longPrompt, '--out', out, '--size', '640x480'], 'longer than 6000 characters'],
    [['--mode', 'base', '--prompt-file', prompt, '--out', out, '--size', '640x480', '--style', 'neon'], 'unknown style neon'],
  ];
  for (const [args, reason] of cases) {
    const result = cli(args);
    assert.equal(result.status, 2, `${reason}: ${result.stdout}`);
    assert.ok(result.stderr.includes(reason), `${reason}: ${result.stderr}`);
    assert.equal(fs.existsSync(out), false);
  }
});

test('the CLI runs the provider through YLLIR_CODEX_BIN and reports the picture it saved', () => {
  const dir = tempDir();
  const fixed = path.join(dir, 'fixed.png');
  fs.writeFileSync(fixed, pngBytes(640, 480, 4096));
  // A fake codex: records its arguments in the job folder and copies the fixed PNG to the path in the instruction.
  const fakeCodex = path.join(dir, 'fake-codex.cjs');
  fs.writeFileSync(fakeCodex, `#!${process.execPath}
const fs = require('fs');
const argv = process.argv.slice(2);
fs.writeFileSync('args.json', JSON.stringify(argv));
const instruction = argv[argv.length - 1];
const marker = 'at exactly this path: ';
const start = instruction.indexOf(marker) + marker.length;
const end = instruction.indexOf('. If', start);
fs.copyFileSync(process.env.FAKE_PNG, instruction.slice(start, end));
process.exit(0);
`);
  fs.chmodSync(fakeCodex, 0o755);
  const env = { ...process.env, YLLIR_CODEX_BIN: fakeCodex, FAKE_PNG: fixed };
  const out = path.join(dir, 'out', 'crop-repainted.png');

  const result = cli(
    ['--mode', 'crop', '--prompt-file', writePrompt(dir), '--input', writeInput(dir), '--out', out, '--style', 'antique-parchment'],
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `result: ok\nfile: ${out}\nexit: 0\n`);
  assert.ok(fs.readFileSync(out).equals(pngBytes(640, 480, 4096)));
  const argv = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'repaint-job', 'args.json'), 'utf8'));
  const i = argv.indexOf('-i');
  assert.ok(i > 0, 'the crop is attached with -i');
  assert.equal(argv[i + 1], path.join(dir, 'out', 'repaint-job', 'input.png'));
  assert.equal(argv[i + 2], '--');
  assert.ok(argv[i + 3].startsWith(buildRepaintPrompt({ mode: 'crop', promptText: PROMPT_TEXT, styleId: 'antique-parchment', width: 640, height: 480 })));
});

test('--dry-run of a sea repaint without input prints the sea wrapper and the request, with no -i', () => {
  const dir = tempDir();
  const out = path.join(dir, 'sea.png');
  const result = cli(['--mode', 'sea', '--prompt-file', writePrompt(dir), '--out', out, '--style', 'dark-fantasy', '--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  const finalPrompt = buildRepaintPrompt({ mode: 'sea', promptText: PROMPT_TEXT, styleId: 'dark-fantasy', width: 1024, height: 1024 });
  assert.ok(result.stdout.startsWith(`prompt: ${finalPrompt}\ncommand: codex exec `), result.stdout);
  assert.ok(result.stdout.includes('top-down texture of open sea water'));
  assert.ok(result.stdout.includes(`REQUEST:\n${PROMPT_TEXT}`));
  assert.ok(result.stdout.includes('There is no reference image'));
  const commandLine = result.stdout.split('\n').at(-3);
  assert.equal(commandLine.includes(' -i '), false, commandLine);
  assert.equal(fs.existsSync(path.join(dir, 'repaint-job')), false);
  assert.equal(fs.existsSync(out), false);
});

test('--dry-run of a sea repaint with --input sends the reference, like crop does', () => {
  const dir = tempDir();
  const result = cli([
    '--mode', 'sea', '--prompt-file', writePrompt(dir), '--input', writeInput(dir, 640, 480), '--out', path.join(dir, 'sea.png'), '--dry-run',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('A reference image is attached'), result.stdout);
  const commandLine = result.stdout.split('\n').at(-3);
  assert.ok(commandLine.includes(` -i ${path.join(dir, 'repaint-job', 'input.png')} -- `), commandLine);
});

test('a sea tile must be square: a non-square --size is a usage error with exit 2', () => {
  const dir = tempDir();
  const out = path.join(dir, 'sea.png');
  const result = cli(['--mode', 'sea', '--prompt-file', writePrompt(dir), '--out', out, '--size', '1024x768', '--dry-run']);

  assert.equal(result.status, 2, result.stdout);
  assert.ok(result.stderr.includes('needs a square --size'), result.stderr);
  assert.equal(fs.existsSync(out), false);
});

test('a missing codex binary is a failed result with exit 1', () => {
  const dir = tempDir();
  const out = path.join(dir, 'base.png');
  const env = { ...process.env, YLLIR_CODEX_BIN: path.join(dir, 'no-such-codex') };

  const result = cli(['--mode', 'base', '--prompt-file', writePrompt(dir), '--size', '640x480', '--out', out], env);

  assert.equal(result.status, 1);
  assert.ok(result.stdout.startsWith('result: failed\nerror: unavailable\nmessage: '), result.stdout);
  assert.ok(result.stdout.endsWith('exit: 1\n'), result.stdout);
  assert.equal(fs.existsSync(out), false);
});
