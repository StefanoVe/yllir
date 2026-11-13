// Asks the framework whether a campaign still needs alignment after an update. It runs the framework's
// update-campaign.mjs with --dry-run, which writes nothing, and reads its JSON result. Owner: update engineer.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { parseEngineOutput } from '../engine.js';

export const ALIGN_CHECK_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export function alignScriptPath(frameworkRoot: string): string {
  return path.join(frameworkRoot, 'skills', 'library', 'update', 'scripts', 'update-campaign.mjs');
}

/**
 * True when the dry-run result says there is work to do: the campaign would be updated, an earlier
 * update was interrupted, or a post-update migration is pending. Throws when the result is not one.
 */
export function alignNeeded(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) throw new Error('the alignment check printed no object');
  const data = result as Record<string, unknown>;
  if (data.status === 'would-update') return true;
  const errors = Array.isArray(data.errors) ? data.errors : [];
  const first = errors[0] as { code?: unknown } | undefined;
  if (data.status === 'failed' && first?.code === 'interrupted-update') return true;
  return Array.isArray(data.pending_migrations) && data.pending_migrations.length > 0;
}

/** Runs the dry run of the campaign alignment (no shell) and says whether the campaign needs it. */
export function runAlignCheck(
  campaignRoot: string,
  frameworkRoot: string,
  timeoutMs: number = ALIGN_CHECK_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [alignScriptPath(frameworkRoot), campaignRoot, '--dry-run'],
      { cwd: campaignRoot, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8', windowsHide: true },
      (err, stdout) => {
        const parsed = parseEngineOutput(String(stdout));
        if (parsed.json === null) {
          reject(new Error(`the alignment check printed no result${err ? `: ${err.message}` : ''}`));
          return;
        }
        try {
          resolve(alignNeeded(parsed.json));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}
