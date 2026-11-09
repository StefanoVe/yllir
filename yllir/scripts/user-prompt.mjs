#!/usr/bin/env node
// UserPromptSubmit hook: prints the turn check for the assistant. Never writes
// the master's text. In a campaign it also records a feedback `turn` event in
// .campaign/state/feedback/events.jsonl (session, agent, version, topic only).
// Usage: node user-prompt.mjs [root]
// Root defaults to CLAUDE_PROJECT_DIR, then the working directory. Always exits 0.

import path from 'node:path';
import { turnCheck } from './lib/turn-check.mjs';
import { recordEvent } from './lib/feedback.mjs';
import { frameworkVersion, hookAgent, isCampaign, readHookInput } from './lib/feedback-hook.mjs';
import { activeTopic } from './lib/topics.mjs';

// Stops git from refreshing the index on disk, in case a later check runs git.
process.env.GIT_OPTIONAL_LOCKS = '0';

const given = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const root = path.resolve(given ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

try {
  const input = readHookInput();
  if (isCampaign(root)) {
    recordEvent(root, {
      type: 'turn',
      session: input.session_id,
      agent: hookAgent(),
      version: frameworkVersion(),
      topic: activeTopic(root)?.id ?? 'none',
    });
  }
} catch {
  // Feedback never changes the turn check: any failure is ignored.
}

try {
  process.stdout.write(`${turnCheck(root)}\n`);
} catch {
  // turnCheck does not throw; this guards the write itself.
}
process.exitCode = 0;
