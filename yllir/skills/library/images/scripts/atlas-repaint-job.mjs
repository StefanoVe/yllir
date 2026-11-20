#!/usr/bin/env node
// Repaints the atlas picture through the Codex provider. --mode crop sends a zoomed crop of the
// current base as the reference image; --mode base makes a new base picture with no input;
// --mode sea makes a square, seamless tile of open sea water (optionally matched to a crop of the
// real sea given as --input). The prompt is one fixed English wrapper, the public text of --prompt-file and one style
// description. Nothing else from the campaign is ever sent, and this script never reads a campaign.
// Consent: the caller must first run image-select.mjs --operation repaint, which asks the master
// before an external service gets the picture. This script does not ask.
// Usage: node atlas-repaint-job.mjs --mode base|crop|sea --prompt-file <txt> --out <png> [--input <png>] [--size <WxH>] [--style <style id>] [--dry-run]
// Sea size defaults to 1024x1024 and must be square; --input is optional for sea.
// Exit codes: 0 repainted (or dry run printed), 1 failed (result: failed, error: ..., message: ...), 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodex, codexArgs } from '../providers/codex/scripts/lib/codex.mjs';
import { pngSize } from '../../../../scripts/lib/png.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';
import { PNG_SIGNATURE } from './lib/png-signature.mjs';

const USAGE =
  'usage: node atlas-repaint-job.mjs --mode base|crop|sea --prompt-file <txt> --out <png> [--input <png>] [--size <WxH>] [--style <style id>] [--dry-run]';

const MODES = ['base', 'crop', 'sea'];
const DEFAULT_STYLE = 'fantasy-color';
/** Sea tiles are square; this is the size used when --size is not given. */
export const SEA_DEFAULT_SIZE = '1024x1024';
/** The prompt file is refused above this many characters. */
export const MAX_PROMPT_CHARS = 6000;
/** A provider result smaller than this is not a usable picture. */
export const MIN_PNG_BYTES = 1024;

/** Style ids and the English description each one adds to the fixed wrapper. */
export const REPAINT_STYLES = {
  'fantasy-color': 'colourful hand-painted fantasy map',
  'antique-parchment': 'aged parchment map in sepia inks',
  'dark-fantasy': 'dark, muted, moody fantasy map',
};

/** The fixed English wrapper. {STYLE} and {FRAME} are replaced; the request text follows REQUEST:. */
export const REPAINT_WRAPPER = [
  'TASK:',
  'This is a tabletop-RPG map. Paint it as one finished, uniform, hand-painted fantasy map in the style: {STYLE}.',
  '',
  'FRAME:',
  '{FRAME}',
  '',
  'NO TEXT OR FURNITURE:',
  'Never write any text anywhere on the image: no letters, numbers, runes, names, labels, titles, legend, ' +
    'compass rose, scale bar, coordinate grid, border, frame, margin, cartouche or signature, including along the edges.',
  '',
  'SETTLEMENTS:',
  'Every named settlement in the REQUEST must stay visible on the map, painted as a settlement. ' +
    'Its name is never written on the image.',
  '',
  'UNIFORMITY:',
  'One consistent light direction (soft light from the top-left, gentle shadows), one palette, one level of detail. ' +
    'Repeated elements share one scale and one painting style. Sea and ground run to the borders with no fade to white or black.',
  '',
  'REQUEST:',
].join('\n');

/** The fixed English wrapper for sea mode. {STYLE} and {FRAME} are replaced; the request text follows REQUEST:. */
export const SEA_WRAPPER = [
  'TASK:',
  'This is a square, top-down texture of open sea water for a tabletop-RPG map. Paint it in the style: {STYLE}.',
  '',
  'FRAME:',
  '{FRAME}',
  '',
  'CONTENT:',
  'Only open water. No land, no islands, no reefs, no ships, no boats, no coastline, no horizon, no sky, no clouds, ' +
    'no fog, no creatures. Never write any text anywhere on the image: no letters, numbers, runes, names, labels, ' +
    'compass rose, scale bar, coordinate grid, border, frame, margin or signature.',
  '',
  'SEAMLESS:',
  'The picture must repeat endlessly as a tile: the left edge joins the right edge and the top edge joins the bottom edge ' +
    'with no visible seam. Even lighting over the whole picture, no darker or lighter centre, no single strong feature, ' +
    'no focal point, no vignette, no fade to white or black at any edge.',
  '',
  'UNIFORMITY:',
  'One consistent light direction, one palette, one level of detail. Wave patterns repeat at one scale and one painting style.',
  '',
  'REQUEST:',
].join('\n');

const FRAME_SEA_REFERENCE =
  'A reference image is attached: a crop of the real sea of the map. Match its water colour, brightness and wave style. ' +
  'Paint no land, ship or feature from it; the picture is only water.';
const FRAME_SEA_NONE =
  'There is no reference image: choose a water colour, brightness and wave style that suit the chosen style.';

const FRAME_CROP =
  'A reference image is attached: a zoomed crop of the current map. Keep its framing exactly: same canvas size ' +
  'and aspect ratio, no crop, no rotation, no zoom, no shift, no mirror, no perspective. Every coastline, shore, ' +
  'river, road, wall and feature stays at the same pixel position with the same shape. ' +
  'Add or remove nothing unless the REQUEST asks for it.';

function frameForBase(width, height) {
  return `There is no reference image: create the whole map from scratch, with an aspect ratio of ${width}x${height} (width by height).`;
}

/**
 * The full prompt for one repaint. Returns null for an unknown style id.
 * @param {{ mode: 'base'|'crop'|'sea', promptText: string, styleId: string, width: number, height: number, hasInput?: boolean }} options
 */
export function buildRepaintPrompt({ mode, promptText, styleId, width, height, hasInput = false }) {
  if (!Object.hasOwn(REPAINT_STYLES, styleId)) return null;
  let frame;
  if (mode === 'sea') frame = hasInput ? FRAME_SEA_REFERENCE : FRAME_SEA_NONE;
  else frame = mode === 'crop' ? FRAME_CROP : frameForBase(width, height);
  const wrapper = mode === 'sea' ? SEA_WRAPPER : REPAINT_WRAPPER;
  const head = wrapper
    .replace('{STYLE}', () => REPAINT_STYLES[styleId])
    .replace('{FRAME}', () => frame);
  return `${head}\n${String(promptText).trim()}`;
}

/** The job folder for an output file: a fresh folder beside the output, never shared. */
export function repaintJobDir(outPath) {
  return path.join(path.dirname(outPath), 'repaint-job');
}

/** Reads the prompt file. Throws (usage error) when it is unreadable, empty or longer than MAX_PROMPT_CHARS. */
export function readPromptFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(`the prompt file is not readable: ${file}`);
  }
  if (text.trim() === '') throw new Error('the prompt file is empty');
  if (text.length > MAX_PROMPT_CHARS) {
    throw new Error(`the prompt file is longer than ${MAX_PROMPT_CHARS} characters`);
  }
  return text;
}

/** Reads a PNG file: its bytes and size, or null when it is not a PNG. */
export function readPngFile(file) {
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch {
    return null;
  }
  const size = pngSize(buffer);
  return size === null ? null : { buffer, width: size.width, height: size.height };
}

/** A provider result counts only when it has the PNG signature, a header and is not tiny. */
function isUsablePicture(buffer) {
  return buffer.length >= MIN_PNG_BYTES && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) && pngSize(buffer) !== null;
}

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Builds the job folder (job.json, and input.png when there is a reference), runs it through the provider and
 * copies the picture to outPath. `runner` defaults to the Codex client and receives { jobDir };
 * tests pass a fake one. `size` is required for base and sea (the output size); crop takes it from the input.
 * @returns {Promise<{ ok: true } | { ok: false, error: string, message: string }>}
 */
export async function runRepaint({
  mode,
  promptText,
  styleId,
  inputPath = null,
  size = null,
  outPath,
  jobDir,
  runner = runCodex,
}) {
  let input = null;
  if (mode === 'crop' || (mode === 'sea' && inputPath !== null)) {
    input = readPngFile(inputPath);
    if (input === null) return { ok: false, error: 'failed', message: 'the reference picture is not a readable PNG file' };
  }
  const width = mode === 'crop' ? input.width : size.width;
  const height = mode === 'crop' ? input.height : size.height;
  const prompt = buildRepaintPrompt({ mode, promptText, styleId, width, height, hasInput: input !== null });
  if (prompt === null) return { ok: false, error: 'failed', message: `unknown style ${styleId}` };

  fs.rmSync(jobDir, { recursive: true, force: true });
  fs.mkdirSync(jobDir, { recursive: true });
  const job = {
    id: 'repaint',
    operation: 'repaint',
    document: null,
    prompt,
    negative: null,
    width,
    height,
    seed: null,
    input: input ? 'input.png' : null,
  };
  fs.writeFileSync(path.join(jobDir, 'job.json'), `${JSON.stringify(job, null, 2)}\n`);
  if (input) fs.writeFileSync(path.join(jobDir, 'input.png'), input.buffer);

  const result = await runner({ jobDir });
  if (!result.ok) return { ok: false, error: result.error, message: oneLine(result.message) };

  let picture = null;
  try {
    picture = fs.readFileSync(path.join(jobDir, 'result.png'));
  } catch {
    picture = null;
  }
  if (picture === null || !isUsablePicture(picture)) {
    return { ok: false, error: 'failed', message: 'the provider did not return a usable PNG picture' };
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, picture);
  return { ok: true };
}

/** Parses "WxH" into positive integers, or null. */
function parseSize(text) {
  const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(text ?? '');
  return match === null ? null : { width: Number(match[1]), height: Number(match[2]) };
}

function parseArgs(argv) {
  const opts = { mode: null, promptFile: null, out: null, input: null, size: null, style: null, dryRun: false };
  const valueOptions = {
    '--mode': 'mode',
    '--prompt-file': 'promptFile',
    '--out': 'out',
    '--input': 'input',
    '--size': 'size',
    '--style': 'style',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (Object.hasOwn(valueOptions, arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      opts[valueOptions[arg]] = value;
      i++;
    } else {
      return null;
    }
  }
  if (opts.mode === null || opts.promptFile === null || opts.out === null) return null;
  return opts;
}

/** Quotes one argument for the printed command line, only when it needs quotes. */
function shellWord(arg) {
  return /^[\w./:=-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

/** Checks the options that depend on each other. Throws (exit 2) with the reason. */
function checkOptions(args) {
  if (!MODES.includes(args.mode)) throw new Error(`--mode must be base or crop, or sea, not ${args.mode}; ${USAGE}`);
  if (args.mode === 'crop' && args.input === null) throw new Error(`--mode crop needs --input <png>; ${USAGE}`);
  if (args.mode === 'base' && args.input !== null) throw new Error(`--mode base takes no --input; ${USAGE}`);
  if (args.mode === 'base' && args.size === null) throw new Error(`--mode base needs --size <WxH>; ${USAGE}`);
  if (args.size !== null && parseSize(args.size) === null) throw new Error(`--size must be WxH, for example 1024x768; ${USAGE}`);
  if (args.mode === 'sea') {
    if (args.size === null) args.size = SEA_DEFAULT_SIZE;
    const { width, height } = parseSize(args.size);
    if (width !== height) throw new Error(`--mode sea needs a square --size, for example 1024x1024, not ${args.size}; ${USAGE}`);
  }
  const style = args.style ?? DEFAULT_STYLE;
  if (!Object.hasOwn(REPAINT_STYLES, style)) {
    throw new Error(`unknown style ${style}; use one of ${Object.keys(REPAINT_STYLES).join(', ')}`);
  }
  return style;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);
  const styleId = checkOptions(args);
  const promptText = readPromptFile(path.resolve(args.promptFile));

  const outPath = path.resolve(args.out);
  const inputPath = args.input === null ? null : path.resolve(args.input);
  const size = args.size === null ? null : parseSize(args.size);
  const jobDir = repaintJobDir(outPath);

  if (args.dryRun) {
    let width = size?.width;
    let height = size?.height;
    if (inputPath !== null) {
      const input = readPngFile(inputPath);
      if (input === null) {
        process.stdout.write('result: failed\nerror: failed\nmessage: the reference picture is not a readable PNG file\n');
        exitWith(1);
        return;
      }
      if (args.mode === 'crop') ({ width, height } = input);
    }
    const prompt = buildRepaintPrompt({ mode: args.mode, promptText, styleId, width, height, hasInput: inputPath !== null });
    const job = { operation: 'repaint', prompt, input: inputPath !== null ? 'input.png' : null };
    const argv = ['codex', ...codexArgs(job, jobDir, path.join(jobDir, 'result.png'))];
    process.stdout.write(`prompt: ${prompt}\ncommand: ${argv.map(shellWord).join(' ')}\n`);
    exitWith(0);
    return;
  }

  const result = await runRepaint({ mode: args.mode, promptText, styleId, inputPath, size, outPath, jobDir });
  if (result.ok) {
    process.stdout.write(`result: ok\nfile: ${outPath}\n`);
    exitWith(0);
    return;
  }
  process.stdout.write(`result: failed\nerror: ${result.error}\nmessage: ${result.message}\n`);
  exitWith(1);
}

// Runs only as the command; importing the functions (tests) never starts the CLI.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli(main);
