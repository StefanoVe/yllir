#!/usr/bin/env node
// Writes the Universal VTT file (map.uvtt) of a map job from its layout and fitted picture.
// Usage: node map-uvtt.mjs <root> --job <jobId>
// Exit codes: 0 written, 1 refused (error: and message lines), 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { buildUvtt } from './lib/uvtt.mjs';
import { exitWith, runCli } from '../../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node map-uvtt.mjs <root> --job <jobId>';
const JOB_ID = /^[a-z0-9][a-z0-9-]*$/;

function parseArgs(argv) {
  const [root, flag, jobId, ...rest] = argv;
  if (!root || root.startsWith('--') || flag !== '--job' || rest.length > 0) return null;
  if (!jobId || jobId.startsWith('--')) return null;
  return { root, jobId };
}

function fail(error, message) {
  process.stdout.write(`error: ${error}\n`);
  process.stdout.write(`message: ${message}\n`);
  exitWith(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);
  const rootAbs = path.resolve(args.root);
  const jobDir = JOB_ID.test(args.jobId)
    ? path.join(rootAbs, '.campaign', 'state', 'maps', args.jobId)
    : null;
  if (jobDir === null || !fs.statSync(jobDir, { throwIfNoEntry: false })?.isDirectory()) {
    return fail('no-job', `job not found: ${args.jobId}`);
  }

  const layout = JSON.parse(fs.readFileSync(path.join(jobDir, 'layout.json'), 'utf8'));
  const artPath = path.join(jobDir, 'fit', 'background.png');
  if (!fs.statSync(artPath, { throwIfNoEntry: false })?.isFile()) {
    return fail('no-art', 'missing fit/background.png');
  }
  let uvtt;
  try {
    uvtt = buildUvtt({ layout, imagePng: fs.readFileSync(artPath) });
  } catch (err) {
    if (err.message !== 'image-size') throw err;
    return fail('image-size', `fit/background.png does not match the layout size ${layout.cols * 64}x${layout.rows * 64}`);
  }

  const target = path.join(jobDir, 'map.uvtt');
  fs.writeFileSync(target, JSON.stringify(uvtt));
  process.stdout.write(`uvtt: ${target}\n`);
  exitWith(0);
}

runCli(main);
