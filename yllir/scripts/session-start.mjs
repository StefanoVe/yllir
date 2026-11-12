#!/usr/bin/env node
// SessionStart hook: prints a read-only check of the session folder for the
// assistant. Usage: node session-start.mjs [root] [--json]
// Root defaults to CLAUDE_PROJECT_DIR, then the working directory. Always exits 0.
// Also keeps ~/.yllir/framework-path up to date, which the campaign shortcuts read.
// YLLIR_HOME_DIR replaces the home folder (tests only).

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatCheck, sessionCheck } from './lib/session-check.mjs';
import { writeFrameworkPath } from './launcher/framework-path.mjs';

const HEADER = 'YLLIR SESSION CHECK (for the assistant, not for the master)';
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Stops git status from refreshing the index on disk: the check must not write.
process.env.GIT_OPTIONAL_LOCKS = '0';

/** Keeps the framework path for the shortcuts. Silent and never throws. */
function keepFrameworkPath() {
  try {
    writeFrameworkPath(FRAMEWORK_ROOT, process.env.YLLIR_HOME_DIR || os.homedir());
  } catch {
    // The shortcuts fall back to the path written at campaign creation.
  }
}

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

keepFrameworkPath();
process.stdout.write(`${render(process.argv.slice(2))}\n`);
process.exitCode = 0;
