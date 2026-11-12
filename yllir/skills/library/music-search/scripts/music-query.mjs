#!/usr/bin/env node
// Builds the web search query of a place for the music search, from its PUBLIC part only.
// Usage: node music-query.mjs <root> --place <relPath>
// Output: one JSON line, {"ok":true,"query","mood_words","excluded"} or {"ok":false,"error","message"}.
// Exit codes: 0 query built, 1 refused, 2 usage error.

import path from 'node:path';
import { buildMusicQuery } from './lib/query.mjs';

const USAGE = 'usage: node music-query.mjs <root> --place <relPath>';

function print(obj, code) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exitCode = code;
}

function parseArgs(argv) {
  const positional = [];
  let place;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--place') {
      if (i + 1 >= argv.length) return null;
      place = argv[++i];
    } else if (arg.startsWith('--')) {
      return null;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1 || place === undefined) return null;
  return { root: positional[0], place };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    print({ ok: false, error: 'usage', message: USAGE }, 2);
    return;
  }
  const result = buildMusicQuery({ root: path.resolve(args.root), place: args.place });
  if (!result.ok) {
    print(result, 1);
    return;
  }
  print(result, 0);
}

main();
