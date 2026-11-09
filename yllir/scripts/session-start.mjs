#!/usr/bin/env node
// SessionStart hook: prints a read-only check of the session folder for the
// assistant. Usage: node session-start.mjs [root] [--json]
// Root defaults to CLAUDE_PROJECT_DIR, then the working directory. Always exits 0.

import path from 'node:path';
import { formatCheck, sessionCheck } from './lib/session-check.mjs';

const HEADER = 'YLLIR SESSION CHECK (for the assistant, not for the master)';

// Stops git status from refreshing the index on disk: the check must not write.
process.env.GIT_OPTIONAL_LOCKS = '0';

function render(argv) {
  const json = argv.includes('--json');
  const given = argv.find((arg) => !arg.startsWith('--'));
  const root = path.resolve(given ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  try {
    const result = sessionCheck(root);
    return json ? JSON.stringify(result, null, 2) : formatCheck(result);
  } catch {
    return json ? JSON.stringify({ error: 'check-failed' }) : `${HEADER}\ncheck: failed`;
  }
}

process.stdout.write(`${render(process.argv.slice(2))}\n`);
process.exitCode = 0;
