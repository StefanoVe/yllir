// Typed access to the framework libraries of the live session: the session log and the
// combat tracker (skills/library/*/scripts/lib). Loaded by dynamic import at call time,
// so a framework that predates them yields a plain "not supported" answer instead of a
// crash. Node caches ES modules by URL, so no extra cache is kept here.
// Owner: live engineer.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CombatOp, CombatState, LiveSession, LogEntry, LogKind } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import type { Lang } from '../chat/text.js';
import { liveTexts } from './text.js';

export const LOG_LIB = 'skills/library/session-log/scripts/lib/log-store.mjs';
export const COMBAT_LIB = 'skills/library/combat-tracker/scripts/lib/combat-store.mjs';

/** Codes this server adds on top of the framework's own codes. */
export const LIB_MISSING = 'lib-missing';
export const INTERNAL = 'internal';

export interface LibError {
  code: string;
  message: string;
}

/** The framework shape: `{ ok: true, ...data }` or `{ ok: false, error }`. */
export type LibResult<T> = ({ ok: true } & T) | { ok: false; error: LibError };

export interface OpenOptions {
  title?: string;
  sessionRef?: string;
}

export interface NewEntry {
  kind: LogKind;
  text: string;
  scene?: string;
  subjects?: string[];
  by?: 'master' | 'agent';
}

export interface EntryPatch {
  text?: string;
  kind?: LogKind;
  scene?: string;
  subjects?: string[];
  resolved?: boolean;
}

export interface LogStoreLib {
  openSession(root: string, opts?: OpenOptions): LibResult<{ session: LiveSession }>;
  getActive(root: string): LibResult<{ session: LiveSession | null }>;
  addEntry(root: string, input: NewEntry): LibResult<{ entry: LogEntry }>;
  updateEntry(root: string, id: string, patch: EntryPatch): LibResult<{ entry: LogEntry }>;
  removeEntry(root: string, id: string): LibResult<object>;
  listEntries(root: string): LibResult<{ entries: LogEntry[] }>;
  endSession(root: string): LibResult<{ session: LiveSession }>;
}

export interface CombatStoreLib {
  getCombat(root: string): LibResult<{ combat: CombatState | null }>;
  applyOp(root: string, op: CombatOp): LibResult<{ combat: CombatState }>;
}

/** The plain-language "not supported" message, in the campaign language. */
export function libMissing(lang: Lang): string {
  return liveTexts(lang).libMissing;
}

/** Loads a module of the framework folder, or null when the file is not there. */
export async function importFramework<T>(ctx: Ctx, relative: string): Promise<T | null> {
  const file = path.join(ctx.frameworkRoot, relative);
  if (!fs.existsSync(file)) return null;
  return (await import(pathToFileURL(file).href)) as T;
}

function missing(): LibResult<never> {
  return { ok: false, error: { code: LIB_MISSING, message: 'The live session library is not installed.' } };
}

function internal(ctx: Ctx, where: string, err: unknown): LibResult<never> {
  ctx.log(`${where} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  return { ok: false, error: { code: INTERNAL, message: 'Internal error.' } };
}

/** Runs one call of the session log library. Never throws. */
export async function callLog<T>(
  ctx: Ctx,
  run: (lib: LogStoreLib) => LibResult<T>,
): Promise<LibResult<T>> {
  try {
    const lib = await importFramework<LogStoreLib>(ctx, LOG_LIB);
    if (lib === null) return missing();
    return run(lib);
  } catch (err) {
    return internal(ctx, 'session log', err);
  }
}

/** Runs one call of the combat tracker library. Never throws. */
export async function callCombat<T>(
  ctx: Ctx,
  run: (lib: CombatStoreLib) => LibResult<T>,
): Promise<LibResult<T>> {
  try {
    const lib = await importFramework<CombatStoreLib>(ctx, COMBAT_LIB);
    if (lib === null) return missing();
    return run(lib);
  } catch (err) {
    return internal(ctx, 'combat tracker', err);
  }
}
