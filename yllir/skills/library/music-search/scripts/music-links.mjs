#!/usr/bin/env node
// Reads or formats the music items of a place sheet (its master-only `### Musica` / `### Music` section).
// Usage: node music-links.mjs list <root> --place <relPath>
//        node music-links.mjs format --title "<title>" --url "<https url>" --mood "<mood, scene use>"
// list prints one JSON line {"ok":true,"items":[{title,url,mood}],"skipped"}; format prints the Markdown line.
// Exit codes: 0 ok, 1 refused or not found, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { fail, isFile, safeRelative } from './lib/common.mjs';
import { formatMusicLine, readMusicItems } from './lib/links.mjs';

const USAGE = [
  'usage: node music-links.mjs list <root> --place <relPath>',
  'usage: node music-links.mjs format --title "<title>" --url "<https url>" --mood "<mood, scene use>"',
].join('\n');

function print(obj, code) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exitCode = code;
}

/** Splits argv into positionals and --name value options; null on a malformed option. */
function parseArgs(argv, options) {
  const positional = [];
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (!options.includes(key) || i + 1 >= argv.length) return null;
      values[key] = argv[++i];
    } else {
      positional.push(arg);
    }
  }
  return { positional, values };
}

function list(args) {
  const parsed = parseArgs(args, ['place']);
  if (parsed === null || parsed.positional.length !== 1 || parsed.values.place === undefined) {
    print({ ok: false, error: 'usage', message: USAGE }, 2);
    return;
  }
  const root = path.resolve(parsed.positional[0]);
  const rel = safeRelative(parsed.values.place);
  if (rel === null || !isFile(path.join(root, rel))) {
    print(fail('not-found', 'place sheet not found'), 1);
    return;
  }
  const { items, skipped } = readMusicItems(fs.readFileSync(path.join(root, rel), 'utf8'));
  print({ ok: true, path: rel, items, skipped }, 0);
}

function format(args) {
  const parsed = parseArgs(args, ['title', 'url', 'mood']);
  if (parsed === null || parsed.positional.length !== 0) {
    print({ ok: false, error: 'usage', message: USAGE }, 2);
    return;
  }
  const { title, url, mood } = parsed.values;
  if (title === undefined || url === undefined || mood === undefined) {
    print({ ok: false, error: 'usage', message: USAGE }, 2);
    return;
  }
  const result = formatMusicLine({ title, url, mood });
  if (!result.ok) {
    print(result, 1);
    return;
  }
  process.stdout.write(`${result.line}\n`);
  process.exitCode = 0;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'list') return list(rest);
  if (command === 'format') return format(rest);
  print({ ok: false, error: 'usage', message: USAGE }, 2);
  return undefined;
}

main();
