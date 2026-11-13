// Reads and saves the master screen settings in <campaign>/.campaign/master-screen.yaml.
// Saves are committed to the campaign's git history, one commit per save, path-limited.
// Owner: settings engineer.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ScreenSettings, ScreenSettingsPatch } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import { loadFrameworkModule } from '../engine.js';
import { runGit } from '../history/git.js';
import {
  combinePatches,
  DEFAULT_SETTINGS,
  explicitPaths,
  fileTree,
  mergeSettings,
  storedPatch,
} from './schema.js';

export const SETTINGS_FILE = '.campaign/master-screen.yaml';

const HEADER = '# Master screen settings. Written by the master screen; safe to edit by hand.';
const COMMIT_IDENTITY = [
  ['user.name', 'Yllir'],
  ['user.email', 'yllir@localhost.invalid'],
] as const;

interface YamlLiteModule {
  parseYamlLite(text: string): { data: unknown; errors: unknown[] };
}

export type SaveResult =
  | { ok: true; settings: ScreenSettings; explicit: string[] }
  | { ok: false; reason: 'no-git' | 'failed' };

/** True when the campaign folder is inside a git repository. Never throws. */
export async function gitAvailable(campaignRoot: string): Promise<boolean> {
  try {
    return (await runGit(campaignRoot, ['rev-parse', '--git-dir'], [0, 128])).code === 0;
  } catch {
    return false;
  }
}

/** The explicit patch the file holds. A missing or unreadable file gives an empty patch. */
async function loadStored(ctx: Ctx): Promise<{ patch: ScreenSettingsPatch; explicit: string[] }> {
  const empty = { patch: {} as ScreenSettingsPatch, explicit: [] as string[] };
  let raw: string;
  try {
    raw = await fs.readFile(path.join(ctx.campaignRoot, SETTINGS_FILE), 'utf8');
  } catch {
    return empty;
  }
  try {
    const yaml = await loadFrameworkModule<YamlLiteModule>(ctx, 'yaml-lite');
    const parsed = yaml.parseYamlLite(raw);
    if (parsed.errors.length > 0) return empty;
    return storedPatch(parsed.data);
  } catch {
    return empty;
  }
}

/** Settings as the file sets them, defaults for the rest. Never throws. */
export async function readSettings(ctx: Ctx): Promise<{ settings: ScreenSettings; explicit: string[] }> {
  const { patch, explicit } = await loadStored(ctx);
  return { settings: mergeSettings(DEFAULT_SETTINGS, patch), explicit };
}

/** YAML text of the explicit settings only, in the file's key order. */
export function serializeSettings(stored: ScreenSettingsPatch): string {
  const lines: string[] = [HEADER];
  const emit = (tree: Record<string, unknown>, indent: string): void => {
    for (const [key, value] of Object.entries(tree)) {
      if (typeof value === 'object' && value !== null) {
        lines.push(`${indent}${key}:`);
        emit(value as Record<string, unknown>, `${indent}  `);
      } else {
        lines.push(`${indent}${key}: ${String(value)}`);
      }
    }
  };
  emit(fileTree(stored), '');
  return `${lines.join('\n')}\n`;
}

// Saves run one after another, so two PUTs never interleave.
let chain: Promise<unknown> = Promise.resolve();

export function saveSettings(ctx: Ctx, patch: ScreenSettingsPatch): Promise<SaveResult> {
  const run = chain.then(() => writeAndCommit(ctx, patch));
  chain = run.catch(() => undefined);
  return run;
}

async function writeAndCommit(ctx: Ctx, patch: ScreenSettingsPatch): Promise<SaveResult> {
  if (!(await gitAvailable(ctx.campaignRoot))) return { ok: false, reason: 'no-git' };
  try {
    const current = await loadStored(ctx);
    const next = combinePatches(current.patch, patch);
    const file = path.join(ctx.campaignRoot, SETTINGS_FILE);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, serializeSettings(next), 'utf8');
    await fs.rename(tmp, file);
    await commitSettings(ctx.campaignRoot);
    return {
      ok: true,
      settings: mergeSettings(DEFAULT_SETTINGS, next),
      explicit: explicitPaths(next),
    };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Commits only the settings file. "Nothing to commit" (exit 1) is fine. */
async function commitSettings(root: string): Promise<void> {
  await runGit(root, ['add', '--', SETTINGS_FILE]);
  const identity: string[] = [];
  for (const [key, value] of COMMIT_IDENTITY) {
    const current = await runGit(root, ['config', '--get', key], [0, 1]);
    if (current.code !== 0 || current.stdout.trim() === '') identity.push('-c', `${key}=${value}`);
  }
  await runGit(root, [...identity, 'commit', '-q', '-m', 'Master screen settings', '--', SETTINGS_FILE], [0, 1]);
}
