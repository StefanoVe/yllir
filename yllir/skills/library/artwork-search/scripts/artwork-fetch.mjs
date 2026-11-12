#!/usr/bin/env node
// Downloads one candidate image of an artwork search into its job folder and writes its sidecar.
// Usage: node artwork-fetch.mjs <root> --document <rel> --url <imageUrl> --page <pageUrl> --title "<t>" --author "<a>" --license "<l>"
//          [--job <jobId>] [--published <YYYY-MM-DD>] [--tags "a,b,c"] [--page-text "<up to 2000 chars>"] [--declared-no-ai]
// Prints one JSON line. Exit codes: 0 saved, 1 refused (JSON with ok:false), 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { downloadImage } from './lib/fetch.mjs';
import { runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node artwork-fetch.mjs <root> --document <rel> --url <imageUrl> --page <pageUrl> --title "<t>" --author "<a>" --license "<l>" ' +
  '[--job <jobId>] [--published <YYYY-MM-DD>] [--tags "a,b,c"] [--page-text "<text>"] [--declared-no-ai]';

const VALUE_OPTIONS = {
  '--document': 'document',
  '--url': 'url',
  '--page': 'page',
  '--title': 'title',
  '--author': 'author',
  '--license': 'license',
  '--job': 'job',
  '--published': 'published',
  '--tags': 'tags',
  '--page-text': 'pageText',
};
const REQUIRED = ['document', 'url', 'page', 'title', 'author', 'license'];
const JOB_ID = /^artwork-[a-z0-9-]+-\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_TEXT_MAX = 2000;

function parseArgs(argv) {
  const opts = { root: null, declaredNoAi: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--declared-no-ai') {
      opts.declaredNoAi = true;
    } else if (Object.hasOwn(VALUE_OPTIONS, arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      opts[VALUE_OPTIONS[arg]] = value;
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (opts.root === null) {
      opts.root = arg;
    } else {
      return null;
    }
  }
  if (opts.root === null) return null;
  for (const key of REQUIRED) {
    if (opts[key] === undefined) return null;
  }
  return opts;
}

/** Lowercase ASCII slug: diacritics removed, other runs become `-`. */
function slugify(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Normalized campaign-relative path with `/` separators, or null when unsafe. */
function safeRelative(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function fail(error, message) {
  return { ok: false, error, message };
}

/** First free job id `artwork-<slug>-<n>` for a document, so the job folder does not exist yet. */
function freshJobId(artworkDir, rel) {
  const slug = slugify(path.posix.basename(rel).replace(/\.md$/i, '')) || 'document';
  for (let n = 1; ; n++) {
    const id = `artwork-${slug}-${n}`;
    if (!fs.existsSync(path.join(artworkDir, id))) return id;
  }
}

/** 1 + the highest existing cand-<n>.json in the job folder. */
function nextCandidate(jobDir) {
  let highest = 0;
  for (const name of fs.readdirSync(jobDir)) {
    const match = /^cand-(\d+)\.json$/.exec(name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

function isRealDate(value) {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Downloads the candidate and writes its sidecar. Returns { ok, job, n, file } or a refusal. */
async function saveCandidate(rootAbs, args) {
  const rel = safeRelative(args.document);
  if (rel === null) return fail('bad-document', 'the document must be a campaign-relative path');
  if (!isFile(path.join(rootAbs, rel))) return fail('no-document', `document not found: ${rel}`);

  let pageUrl;
  try {
    pageUrl = new URL(args.page);
  } catch {
    return fail('bad-page-url', 'the page URL does not parse');
  }
  if (pageUrl.protocol !== 'https:') return fail('bad-page-url', 'the page URL must use https');

  const publishedAt = args.published ?? null;
  if (publishedAt !== null && !isRealDate(publishedAt)) {
    return fail('bad-date', 'the publication date must be YYYY-MM-DD');
  }

  const artworkDir = path.join(rootAbs, '.campaign', 'state', 'artwork');
  let jobId;
  if (args.job !== undefined) {
    if (!JOB_ID.test(args.job)) return fail('bad-job', 'the job id must look like artwork-<slug>-<n>');
    jobId = args.job;
  } else {
    jobId = freshJobId(artworkDir, rel);
  }
  const jobDir = path.join(artworkDir, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const n = nextCandidate(jobDir);
  const download = await downloadImage({ url: args.url, destDir: jobDir, stem: `cand-${n}` });
  if (!download.ok) return fail(download.error, download.message);

  const record = {
    n,
    file: path.basename(download.file),
    document: rel,
    pageUrl: args.page,
    imageUrl: args.url,
    title: args.title,
    author: args.author,
    license: args.license,
    publishedAt,
    tags: (args.tags ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ''),
    pageText: (args.pageText ?? '').slice(0, PAGE_TEXT_MAX),
    declaredNoAi: args.declaredNoAi,
    ai_screen: null,
    ai_reasons: [],
  };
  try {
    fs.writeFileSync(path.join(jobDir, `cand-${n}.json`), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  } catch (err) {
    fs.rmSync(download.file, { force: true });
    return fail('failed', `could not write the sidecar: ${err.message}`);
  }
  return { ok: true, job: jobId, n, file: download.file };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);
  const result = await saveCandidate(path.resolve(args.root), args);
  if (!result.ok) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: result.error, message: result.message })}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, job: result.job, n: result.n, file: result.file })}\n`);
  process.exitCode = 0;
}

runCli(main);
