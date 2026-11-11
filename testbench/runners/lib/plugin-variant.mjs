// Delegation calibration (decision 16). The framework decides when the author writes full
// documents itself and when it launches one yllir:sheet-expander per document. The threshold
// is written as a number in two instruction files; `always` and `never` build a temporary copy
// of the plugin with that number replaced (0 delegates every document, 999 delegates none), so
// a case can run the same request with and without the expanders. `auto` runs the plugin as it
// is. Built-ins only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from './case-common.mjs';

export const DELEGATION_MODES = ['auto', 'always', 'never'];
export const DEFAULT_DELEGATION = 'auto';
// The value of the threshold in each forced mode: "up to N documents by the author, more than N delegated".
const THRESHOLD = { always: 0, never: 999 };

// Each pattern captures the number of the threshold sentence in group 1. Each must match exactly once.
export const THRESHOLD_TARGETS = [
  {
    file: 'skills/core/yllir/authoring.md',
    patterns: [
      /Up to (\d+) full documents: write them yourself/,
      /More than (\d+): launch one `yllir:sheet-expander`/,
    ],
  },
  {
    file: 'skills/core/build-world/SKILL.md',
    patterns: [
      /\*\*Full documents, up to (\d+)\.\*\*/,
      /\*\*Full documents, more than (\d+)\.\*\*/,
    ],
  },
];

/** The mode when it is one of DELEGATION_MODES; throws with the accepted values otherwise. */
export function parseDelegation(value) {
  if (!DELEGATION_MODES.includes(value)) {
    throw new Error(`--delegation must be one of ${DELEGATION_MODES.join(', ')}`);
  }
  return value;
}

/**
 * Replaces the number of every threshold sentence of one file with value. Throws when a
 * sentence is not found exactly once, so a change of wording fails the calibration loudly.
 */
export function rewriteThresholdText(text, patterns, value, label = 'file') {
  let out = text;
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const hits = [...out.matchAll(new RegExp(pattern.source, flags))];
    if (hits.length !== 1) {
      throw new Error(`${label}: threshold sentence ${pattern.source} found ${hits.length} times (want 1)`);
    }
    out = out.replace(new RegExp(pattern.source, pattern.flags.replace('g', '')), (whole, number) =>
      whole.replace(number, String(value)),
    );
  }
  return out;
}

/** Rewrites the threshold sentences of every target file under pluginDir, in place. */
export function rewritePluginThresholds(pluginDir, value) {
  for (const target of THRESHOLD_TARGETS) {
    const file = path.join(pluginDir, target.file);
    if (!fs.existsSync(file)) throw new Error(`plugin copy has no ${target.file}`);
    const before = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, rewriteThresholdText(before, target.patterns, value, target.file));
  }
}

/**
 * The plugin folder a run uses for a delegation mode. auto returns sourceDir itself and a no-op
 * cleanup. always and never copy sourceDir into a temporary folder, rewrite the thresholds there
 * and return that copy; cleanup removes the temporary folder. Throws on an unknown mode, or when
 * a threshold sentence is missing (the temporary folder is removed first).
 */
export function buildPluginVariant({ mode = DEFAULT_DELEGATION, sourceDir = path.join(REPO_ROOT, 'yllir') } = {}) {
  parseDelegation(mode);
  if (mode === 'auto') return { mode, pluginDir: sourceDir, cleanup: () => {} };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-plugin-'));
  const pluginDir = path.join(tmp, 'yllir');
  try {
    fs.cpSync(sourceDir, pluginDir, { recursive: true });
    rewritePluginThresholds(pluginDir, THRESHOLD[mode]);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  return {
    mode,
    pluginDir,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}
