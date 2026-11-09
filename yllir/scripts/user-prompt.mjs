#!/usr/bin/env node
// UserPromptSubmit hook: prints the turn check for the assistant. Never writes.
// Usage: node user-prompt.mjs [root]
// Root defaults to CLAUDE_PROJECT_DIR, then the working directory. Always exits 0.

import path from 'node:path';
import { turnCheck } from './lib/turn-check.mjs';

// Stops git from refreshing the index on disk, in case a later check runs git.
process.env.GIT_OPTIONAL_LOCKS = '0';

const given = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const root = path.resolve(given ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

try {
  process.stdout.write(`${turnCheck(root)}\n`);
} catch {
  // turnCheck does not throw; this guards the write itself.
}
process.exitCode = 0;
