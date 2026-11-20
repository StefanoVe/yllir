#!/usr/bin/env node
// Bakes the drawn atlas map into one uniform painted picture, through the Codex provider.
// The atlas skill renders the input without labels and without master-only content; the
// prompt is one fixed English text with only the style description added. Nothing else
// from the campaign is ever sent.
// Consent: the caller must first run image-select.mjs --operation bake, which asks the
// master before an external service gets the picture. This script does not read the campaign.
// Usage: node bake-job.mjs --atlas-input <png> --style <style id> --out <png> [--dry-run]
// Exit codes: 0 baked (or dry run printed), 1 failed (result: failed, error: ..., message: ...), 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodex, codexArgs } from '../providers/codex/scripts/lib/codex.mjs';
import { pngSize } from '../../../../scripts/lib/png.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node bake-job.mjs --atlas-input <png> --style <style id> --out <png> [--dry-run]';

/** Atlas style ids and the English description each one adds to the fixed prompt. */
export const BAKE_STYLES = {
  'fantasy-color': 'colourful hand-painted fantasy map',
  'antique-parchment': 'aged parchment map in sepia inks',
  'dark-fantasy': 'dark, muted, moody fantasy map',
};

const STYLE_PLACEHOLDER = '{STYLE}';

/** The fixed repaint prompt. Only {STYLE} is replaced, by a description from BAKE_STYLES. */
export const BAKE_PROMPT = [
  'TASK:',
  'The attached image is a flat schematic layout of a tabletop-RPG map, not a finished picture. ' +
    'Repaint it as one finished, uniform, hand-painted fantasy map in the style: {STYLE}.',
  '',
  'READ THE INPUT:',
  'Each flat colour area and each small repeated symbol of the input marks a kind of terrain or object: ' +
    'sea, land, lakes, rivers, mountains, hills, forests, swamp, desert, ice, roads, walls, towers, streets, ' +
    'city blocks, buildings, parks, fields. Keep every one of them and paint it as what it is.',
  '',
  'GEOMETRY IS FIXED (highest priority):',
  'Same canvas size and aspect ratio. No crop, no rotation, no zoom, no shift, no mirror, no perspective, ' +
    'no change of scale. Every coastline, shore, river, road, wall, street, block, building, mountain, forest ' +
    'and lake stays at the same pixel position, with the same shape, size and proportions. ' +
    'Outlines may be refined in texture, never moved.',
  '',
  'NOTHING ADDED, NOTHING REMOVED:',
  'Do not add islands, land, rivers, lakes, roads, bridges, towns, buildings, ships, boats, creatures, people, ' +
    'banners, decorations or any other feature that is not in the input. Do not remove or merge any feature. ' +
    'Where the input is empty (open sea, plain ground), keep it plain with only subtle texture. ' +
    'If something is unclear, keep it as in the input.',
  '',
  'NO TEXT OR FURNITURE:',
  'No text, letters, numbers, runes, glyphs, names, labels, titles, cartouches, legends, scale bars, compass roses, ' +
    'coordinate grid, borders, frames, margins, vignettes, signatures or watermarks anywhere, including along the edges.',
  '',
  'UNIFORMITY:',
  'One consistent light direction (soft light from the top-left, gentle shadows), one palette, one level of detail, ' +
    'and the same texture quality across the whole image. Repeated elements (trees, hills, mountains, houses) share ' +
    'one scale and one painting style. Edges of the image continue naturally: sea or ground runs to the borders, ' +
    'with no fade to white or black.',
  '',
  'OUTPUT:',
  'Exactly one image, same aspect ratio as the input, nothing else.',
].join('\n');

/** The full prompt for one style id, or null when the style id is unknown. */
export function buildBakePrompt(styleId) {
  if (!Object.hasOwn(BAKE_STYLES, styleId)) return null;
  return BAKE_PROMPT.replace(STYLE_PLACEHOLDER, BAKE_STYLES[styleId]);
}

/** The job folder for an output file: a fresh folder beside the output, never shared. */
export function bakeJobDir(outPath) {
  return path.join(path.dirname(outPath), 'bake-job');
}

/** Reads the input picture: its bytes and size, or null when it is not a PNG. */
export function readBakeInput(inputPath) {
  let buffer;
  try {
    buffer = fs.readFileSync(inputPath);
  } catch {
    return null;
  }
  const size = pngSize(buffer);
  return size === null ? null : { buffer, width: size.width, height: size.height };
}

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Builds the job folder (job.json and input.png) and runs it through the Codex provider.
 * On success the result is copied to outPath. `runner` defaults to the Codex client and
 * receives { jobDir }; tests pass a fake one.
 * @returns {Promise<{ ok: true } | { ok: false, error: string, message: string }>}
 */
export async function runBake({ inputPath, styleId, outPath, jobDir, runner = runCodex }) {
  const prompt = buildBakePrompt(styleId);
  if (prompt === null) return { ok: false, error: 'failed', message: `unknown style ${styleId}` };
  const input = readBakeInput(inputPath);
  if (input === null) return { ok: false, error: 'failed', message: 'the atlas input is not a readable PNG file' };

  fs.rmSync(jobDir, { recursive: true, force: true });
  fs.mkdirSync(jobDir, { recursive: true });
  const job = {
    id: 'bake',
    operation: 'bake',
    document: null,
    prompt,
    negative: null,
    width: input.width,
    height: input.height,
    seed: null,
    input: 'input.png',
  };
  fs.writeFileSync(path.join(jobDir, 'job.json'), `${JSON.stringify(job, null, 2)}\n`);
  fs.writeFileSync(path.join(jobDir, 'input.png'), input.buffer);

  const result = await runner({ jobDir });
  if (!result.ok) return { ok: false, error: result.error, message: oneLine(result.message) };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.copyFileSync(path.join(jobDir, 'result.png'), outPath);
  return { ok: true };
}

function parseArgs(argv) {
  const opts = { atlasInput: null, style: null, out: null, dryRun: false };
  const valueOptions = { '--atlas-input': 'atlasInput', '--style': 'style', '--out': 'out' };
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
  if (opts.atlasInput === null || opts.style === null || opts.out === null) return null;
  return opts;
}

/** Quotes one argument for the printed command line, only when it needs quotes. */
function shellWord(arg) {
  return /^[\w./:=-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);
  if (!Object.hasOwn(BAKE_STYLES, args.style)) {
    throw new Error(`unknown style ${args.style}; use one of ${Object.keys(BAKE_STYLES).join(', ')}`);
  }

  const inputPath = path.resolve(args.atlasInput);
  const outPath = path.resolve(args.out);
  const jobDir = bakeJobDir(outPath);

  if (args.dryRun) {
    const prompt = buildBakePrompt(args.style);
    const input = readBakeInput(inputPath);
    if (input === null) {
      process.stdout.write('result: failed\nerror: failed\nmessage: the atlas input is not a readable PNG file\n');
      exitWith(1);
      return;
    }
    const job = { operation: 'bake', prompt, input: 'input.png' };
    const argv = ['codex', ...codexArgs(job, jobDir, path.join(jobDir, 'result.png'))];
    process.stdout.write(`prompt: ${prompt}\ncommand: ${argv.map(shellWord).join(' ')}\n`);
    exitWith(0);
    return;
  }

  const result = await runBake({ inputPath, styleId: args.style, outPath, jobDir });
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
