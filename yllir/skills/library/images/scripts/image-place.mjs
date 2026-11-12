#!/usr/bin/env node
// Places a finished image next to its campaign document and writes its sidecar;
// for generate and upload also prepares the draft of the document that links it.
// With --kind map, places the files of a finished map job instead.
// With --file (an upload), --source-url and --source-page (both https, given together) record where the image came from,
// with optional --author, --license and --ai-screen, in the sidecar.
// Usage: node image-place.mjs <root> --document <relPath> --alt "<text>" --provider <id> (--job <jobId> | --file <absPath>) [--review "<text>"]
//          [--source-url <https url> --source-page <https url> [--author "<text>"] [--license "<text>"] [--ai-screen "<text>"]] (source only with --file)
//        node image-place.mjs <root> --kind map --document <relPath> --alt "<text>" --provider <id> --job <imageJobId> --map-job <mapJobId> [--review "<text>"]
// Exit codes: 0 placed, 1 refused (error: and message: lines), 2 usage error.

import path from 'node:path';
import { placeImage } from './lib/image-job.mjs';
import { placeMap } from './lib/map-place.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node image-place.mjs <root> --document <relPath> --alt "<text>" --provider <id> (--job <jobId> | --file <absPath>) [--review "<text>"] ' +
  '[--source-url <https url> --source-page <https url> [--author "<text>"] [--license "<text>"] [--ai-screen "<text>"] (source only with --file)] ' +
  '[--kind image|map --map-job <mapJobId> (map only, with --job and no --file)]';

const VALUE_OPTIONS = new Set([
  '--document',
  '--alt',
  '--provider',
  '--job',
  '--file',
  '--review',
  '--kind',
  '--map-job',
  '--source-url',
  '--source-page',
  '--author',
  '--license',
  '--ai-screen',
]);
const OPTION_NAMES = {
  '--map-job': 'mapJob',
  '--source-url': 'sourceUrl',
  '--source-page': 'sourcePage',
  '--ai-screen': 'aiScreen',
};
const SOURCE_OPTIONS = ['sourceUrl', 'sourcePage', 'author', 'license', 'aiScreen'];

function parseArgs(argv) {
  const opts = {
    root: null,
    document: null,
    alt: null,
    provider: null,
    job: null,
    file: null,
    review: null,
    kind: 'image',
    mapJob: null,
    sourceUrl: null,
    sourcePage: null,
    author: null,
    license: null,
    aiScreen: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      opts[OPTION_NAMES[arg] ?? arg.slice(2)] = value;
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (opts.root === null) {
      opts.root = arg;
    } else {
      return null;
    }
  }
  if (opts.root === null || opts.document === null || opts.alt === null || opts.provider === null) return null;
  if (opts.kind !== 'image' && opts.kind !== 'map') return null;
  if (opts.kind === 'map') {
    // A map is placed from a generate job (--job) and a map job (--map-job); it has no upload.
    if (opts.job === null || opts.file !== null || opts.mapJob === null) return null;
  } else {
    if (opts.mapJob !== null) return null;
    if ((opts.job === null) === (opts.file === null)) return null;
  }
  // Source options belong to an upload only, and the url and page come as a pair.
  const hasSource = SOURCE_OPTIONS.some((name) => opts[name] !== null);
  if (hasSource) {
    if (opts.kind !== 'image' || opts.file === null) return null;
    if (opts.sourceUrl === null || opts.sourcePage === null) return null;
  }
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);
  const root = path.resolve(args.root);

  if (args.kind === 'map') {
    const result = placeMap({
      root,
      document: args.document,
      mapJob: args.mapJob,
      imageJob: args.job,
      provider: args.provider,
      alt: args.alt,
      review: args.review ?? '',
    });
    if (!result.ok) {
      process.stdout.write(`error: ${result.error}\n`);
      process.stdout.write(`message: ${result.message}\n`);
      exitWith(1);
      return;
    }
    process.stdout.write(`files: ${result.files.join(', ')}\n`);
    process.stdout.write(`draft: ${result.draft}\n`);
    exitWith(0);
    return;
  }

  const hasSource = args.sourceUrl !== null;
  const source = hasSource
    ? Object.fromEntries(
        [
          ['url', args.sourceUrl],
          ['page', args.sourcePage],
          ['author', args.author],
          ['license', args.license],
          ['ai_screen', args.aiScreen],
        ].filter(([, value]) => value !== null),
      )
    : null;
  const result = placeImage({
    root,
    document: args.document,
    alt: args.alt,
    jobId: args.job,
    file: args.file === null ? null : path.resolve(args.file),
    provider: args.provider,
    review: args.review ?? '',
    source,
  });

  if (!result.ok) {
    process.stdout.write(`error: ${result.error}\n`);
    process.stdout.write(`message: ${result.message}\n`);
    exitWith(1);
    return;
  }
  process.stdout.write(`image: ${result.image}\n`);
  process.stdout.write(`sidecar: ${result.sidecar}\n`);
  process.stdout.write(`draft: ${result.draft ?? 'none'}\n`);
  exitWith(0);
}

runCli(main);
