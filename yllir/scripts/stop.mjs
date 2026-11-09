#!/usr/bin/env node
// Stop hook: records the end of the latest feedback turn (duration, and status,
// model and files from the runner's result when present). Writes only the
// feedback log. Prints nothing.
// Usage: node stop.mjs [root]
// Root defaults to CLAUDE_PROJECT_DIR, then the working directory. Always exits 0.

import { recordEnd } from './lib/feedback.mjs';
import { frameworkVersion, hookAgent, hookRoot, isCampaign, readHookInput } from './lib/feedback-hook.mjs';

const root = hookRoot(process.argv);

try {
  const input = readHookInput();
  if (isCampaign(root)) {
    recordEnd(root, { session: input.session_id, agent: hookAgent(), version: frameworkVersion() });
  }
} catch {
  // Feedback never blocks the session: any failure is ignored.
}
process.exitCode = 0;
