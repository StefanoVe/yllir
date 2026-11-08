#!/usr/bin/env node
// Command line for a runner result file. Checks the message for the master and
// applies the topic bookkeeping. Prints plain text on stdout.
// Usage: node runner-result.mjs <root> --file <path> [--topic <id|none>]
// Exit codes: 0 ok, 1 problems found (nothing was changed), 2 usage error.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRunnerResult } from './lib/runner-result.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node runner-result.mjs <root> --file <path> [--topic <id|none>]';
const LEXICON = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lexicon.md');
const OPTIONS = ['file', 'topic'];

function parseArgs(argv) {
  const [root, ...rest] = argv;
  if (root === undefined || root.startsWith('--')) return null;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (flag === undefined || !flag.startsWith('--') || i + 1 >= rest.length) return null;
    const name = flag.slice(2);
    if (!OPTIONS.includes(name) || Object.hasOwn(opts, name)) return null;
    opts[name] = rest[i + 1];
  }
  if (opts.file === undefined) return null;
  return {
    root: path.resolve(root),
    file: path.resolve(opts.file),
    topic: opts.topic ?? 'none',
  };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === null) throw new Error(USAGE);

  const result = applyRunnerResult(parsed.root, {
    file: parsed.file,
    topic: parsed.topic,
    lexiconPath: LEXICON,
  });

  if (result.ok) {
    process.stdout.write(
      [`status: ${result.status}`, 'message for the master:', result.message, ''].join('\n'),
    );
    exitWith(0);
  } else {
    process.stdout.write(['problems:', ...result.problems.map((p) => `- ${p}`), ''].join('\n'));
    exitWith(1);
  }
}

runCli(main);
