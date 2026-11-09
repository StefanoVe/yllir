// Helpers shared by the feedback hooks and the feedback CLI: campaign check,
// hook input from stdin, framework version, agent name and the root of a hook.
// Every function is synchronous, uses only Node built-ins and never throws.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when <root>/campaign.yaml exists. Feedback is only recorded in a campaign. */
export function isCampaign(root) {
  try {
    return fs.existsSync(path.join(path.resolve(root), 'campaign.yaml'));
  } catch {
    return false;
  }
}

/** The JSON object the hook receives on stdin, or {}. Never blocks on a terminal. */
export function readHookInput() {
  try {
    if (process.stdin.isTTY) return {};
    const value = JSON.parse(fs.readFileSync(0, 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** The `version` field of the framework's plugin.json, or 'unknown'. */
export function frameworkVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const file = path.resolve(here, '..', '..', '.claude-plugin', 'plugin.json');
    const version = JSON.parse(fs.readFileSync(file, 'utf8')).version;
    return typeof version === 'string' && version !== '' ? version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 'claude' when the hook runs inside the Claude plugin, else 'unknown'. */
export function hookAgent() {
  return process.env.CLAUDE_PLUGIN_ROOT ? 'claude' : 'unknown';
}

/** Root of a hook: first non-flag argument, else CLAUDE_PROJECT_DIR, else the working directory. */
export function hookRoot(argv) {
  const given = argv.slice(2).find((arg) => !arg.startsWith('--'));
  return path.resolve(given ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
}
