#!/usr/bin/env node
// Checks the visual words of an artwork search against the campaign and prints the search query.
// Usage: node artwork-query.mjs <root> --document <relPath> --kind <kind> --terms "<words>"
// Output: one JSON line, {"ok":true,"query","search","kind"} or {"ok":false,"error","message"}.
// Exit codes: 0 query built, 1 refused, 2 usage error.

import { buildQuery, searchForm } from './lib/query.mjs';

const USAGE = 'usage: node artwork-query.mjs <root> --document <relPath> --kind <kind> --terms "<words>"';
const OPTIONS = new Set(['--document', '--kind', '--terms']);

function print(obj, code) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exitCode = code;
}

function parseArgs(argv) {
  const positional = [];
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (OPTIONS.has(arg)) {
      if (i + 1 >= argv.length) return null;
      values[arg.slice(2)] = argv[++i];
    } else if (arg.startsWith('--')) {
      return null;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) return null;
  if (values.document === undefined || values.kind === undefined || values.terms === undefined) return null;
  return { root: positional[0], ...values };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    print({ ok: false, error: 'usage', message: USAGE }, 2);
    return;
  }
  const result = buildQuery({ root: args.root, document: args.document, kind: args.kind, terms: args.terms });
  if (!result.ok) {
    print(result, 1);
    return;
  }
  print({ ok: true, query: result.query, search: searchForm(result.query), kind: result.kind }, 0);
}

main();
