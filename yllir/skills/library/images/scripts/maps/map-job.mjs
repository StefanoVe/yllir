#!/usr/bin/env node
// Map jobs: a layout in grid cells becomes a guide picture; the fitted art becomes a bundle for generate2dmap.
// Usage:
//   node map-job.mjs <root> create --document <relPath> --layout <absPath>
//   node map-job.mjs <root> art --job <jobId> --image-job <imageJobId>
//   node map-job.mjs <root> bundle --job <jobId>
// Exit codes: 0 done, 1 refused (error: and message or problem lines), 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { validateLayout, guidePixels, buildBundle, CELL_PX } from './lib/map-layout.mjs';
import { encodePng, pngSize } from './lib/png.mjs';
import { slugify } from '../lib/image-job.mjs';
import { exitWith, runCli } from '../../../../../scripts/lib/cli-exit.mjs';

const USAGE = [
  'usage: node map-job.mjs <root> create --document <relPath> --layout <absPath>',
  '       node map-job.mjs <root> art --job <jobId> --image-job <imageJobId>',
  '       node map-job.mjs <root> bundle --job <jobId>',
].join('\n');

const COMMANDS = {
  create: ['document', 'layout'],
  art: ['job', 'image-job'],
  bundle: ['job'],
};
const JOB_ID = /^[a-z0-9][a-z0-9-]*$/;
const GUIDE_SCALE = 8;

function parseArgs(argv) {
  const [root, command, ...rest] = argv;
  if (!root || root.startsWith('--') || !command || !Object.hasOwn(COMMANDS, command)) return null;
  const allowed = new Set(COMMANDS[command]);
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (!key.startsWith('--') || !allowed.has(key.slice(2))) return null;
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) return null;
    opts[key.slice(2)] = value;
    i++;
  }
  for (const key of allowed) {
    if (opts[key] === undefined) return null;
  }
  return { root, command, opts };
}

function fail(error, message) {
  return { code: 1, lines: [`error: ${error}`, `message: ${message}`] };
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Normalized campaign-relative path, or null when it would leave the campaign. */
function safeRelative(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

function mapsRoot(rootAbs) {
  return path.join(rootAbs, '.campaign', 'state', 'maps');
}

function create(rootAbs, { document, layout: layoutPath }) {
  const rel = safeRelative(document);
  if (rel === null || !isFile(path.join(rootAbs, rel))) {
    return fail('not-found', `document not found: ${document}`);
  }

  let layout;
  try {
    layout = JSON.parse(fs.readFileSync(path.resolve(layoutPath), 'utf8'));
  } catch (err) {
    return { code: 1, lines: ['error: bad-layout', `problem: bad-json ${err.message}`] };
  }
  const problems = validateLayout(layout);
  if (problems.length > 0) {
    return {
      code: 1,
      lines: ['error: bad-layout', ...problems.map((p) => `problem: ${p.code} ${p.message}`)],
    };
  }

  const base = `${slugify(path.posix.basename(rel, '.md')) || 'map'}-map`;
  const root = mapsRoot(rootAbs);
  let n = 1;
  while (fs.existsSync(path.join(root, `${base}-${n}`))) n++;
  const jobId = `${base}-${n}`;
  const jobDir = path.join(root, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const { cols, rows } = layout;
  fs.writeFileSync(path.join(jobDir, 'layout.json'), `${JSON.stringify(layout, null, 2)}\n`, { flag: 'wx' });
  const guide = guidePixels(layout, GUIDE_SCALE);
  const guidePath = path.join(jobDir, 'guide.png');
  fs.writeFileSync(guidePath, encodePng(guide.width, guide.height, guide.rgb), { flag: 'wx' });
  const job = { id: jobId, document: rel, cols, rows, cell: CELL_PX };
  fs.writeFileSync(path.join(jobDir, 'job.json'), `${JSON.stringify(job, null, 2)}\n`, { flag: 'wx' });

  return {
    code: 0,
    lines: [
      `job: ${jobId}`,
      `folder: ${jobDir}`,
      `guide: ${guidePath}`,
      `size: ${cols * CELL_PX}x${rows * CELL_PX}`,
    ],
  };
}

function art(rootAbs, { job: jobId, 'image-job': imageJobId }) {
  if (!JOB_ID.test(jobId)) return fail('no-job', `job not found: ${jobId}`);
  const jobDir = path.join(mapsRoot(rootAbs), jobId);
  if (!isDir(jobDir)) return fail('no-job', `job not found: ${jobId}`);
  if (!JOB_ID.test(imageJobId)) return fail('no-result', `image job has no result.png: ${imageJobId}`);

  const resultPath = path.join(rootAbs, '.campaign', 'state', 'images', imageJobId, 'result.png');
  let buffer = null;
  if (isFile(resultPath)) buffer = fs.readFileSync(resultPath);
  if (buffer === null || pngSize(buffer) === null) {
    return fail('no-result', `image job has no PNG result: ${imageJobId}`);
  }

  const artDir = path.join(jobDir, 'art');
  fs.mkdirSync(artDir, { recursive: true });
  const target = path.join(artDir, 'source.png');
  fs.writeFileSync(target, buffer);
  return { code: 0, lines: [`art: ${target}`] };
}

function bundle(rootAbs, { job: jobId }) {
  if (!JOB_ID.test(jobId)) return fail('no-job', `job not found: ${jobId}`);
  const jobDir = path.join(mapsRoot(rootAbs), jobId);
  if (!isDir(jobDir)) return fail('no-job', `job not found: ${jobId}`);

  const layout = JSON.parse(fs.readFileSync(path.join(jobDir, 'layout.json'), 'utf8'));
  const expectWidth = layout.cols * CELL_PX;
  const expectHeight = layout.rows * CELL_PX;
  const fitPath = path.join(jobDir, 'fit', 'background.png');
  if (!isFile(fitPath)) {
    return fail('bad-art', `missing fit/background.png, expected ${expectWidth}x${expectHeight}`);
  }
  const size = pngSize(fs.readFileSync(fitPath));
  if (size === null || size.width !== expectWidth || size.height !== expectHeight) {
    const found = size === null ? 'not a PNG' : `${size.width}x${size.height}`;
    return fail('bad-art', `expected ${expectWidth}x${expectHeight}, found ${found}`);
  }

  const target = path.join(jobDir, 'map-bundle.json');
  const data = buildBundle(layout, { id: jobId, art: 'fit/background.png' });
  fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
  return { code: 0, lines: [`bundle: ${target}`] };
}

const COMMAND_FNS = { create, art, bundle };

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);
  const result = COMMAND_FNS[args.command](path.resolve(args.root), args.opts);
  for (const line of result.lines) process.stdout.write(`${line}\n`);
  exitWith(result.code);
}

runCli(main);
