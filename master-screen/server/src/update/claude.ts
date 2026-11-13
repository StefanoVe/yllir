// Runs Claude Code for the plugin update and reads the installed plugin's folder. Owner: update engineer.
import { execFile } from 'node:child_process';

export const PLUGIN_ID = 'yllir@yllir';
export const UPDATE_TIMEOUT_MS = 3 * 60 * 1000;
export const LIST_TIMEOUT_MS = 60 * 1000;

/** Runs a program with arguments (never a shell) and resolves to its stdout; rejects on any failure. */
export type ExecText = (file: string, args: string[], opts: { timeout: number }) => Promise<string>;

export function execText(file: string, args: string[], opts: { timeout: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: opts.timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

/** The install folder of the yllir plugin from `claude plugin list --json`, or null when it is not listed. */
export function installPathOf(listing: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(listing);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, installPath } = entry as { id?: unknown; installPath?: unknown };
    if (id === PLUGIN_ID && typeof installPath === 'string' && installPath !== '') return installPath;
  }
  return null;
}
