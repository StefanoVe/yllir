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
 * True when the saved state (update.yaml) has a migration still pending: a guided part that an earlier
 * real update left unfinished. The dry run's own statuses (pending_migrations, migrations) are not used
 * here, because a content-driven migration (a file edited from the cloud) reports needed without any
 * framework change, which is drift and not an alignment.
 */
function hasSavedPending(data: Record<string, unknown>): boolean {
  return Array.isArray(data.saved_pending) && data.saved_pending.length > 0;
}

/**
 * A 'would-update' result is real work when the framework version changed (or is unknown), or when a
 * migration left pending by an earlier real update is saved as pending. With equal versions, the dry
 * run's migration statuses alone do not count, and neither does a dry run that only finds hand-edited
 * generated files.
 */
function wouldUpdateNeeded(data: Record<string, unknown>): boolean {
  if (typeof data.from !== 'string' || typeof data.to !== 'string' || data.from !== data.to) return true;
  return hasSavedPending(data);
}

/**
 * True when the dry-run result says there is work to do: the framework would really be updated (the
 * versions differ or are unknown), an earlier update was interrupted, or a migration saved as pending
 * by an earlier real update is still to be finished. Migration statuses of the dry run alone (content
 * drift) never count. Throws when the result is not an object.
 */
export function alignNeeded(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) throw new Error('the alignment check printed no object');
  const data = result as Record<string, unknown>;
  if (data.status === 'would-update' && wouldUpdateNeeded(data)) return true;
  const errors = Array.isArray(data.errors) ? data.errors : [];
  const first = errors[0] as { code?: unknown } | undefined;
  if (data.status === 'failed' && first?.code === 'interrupted-update') return true;
  return hasSavedPending(data);
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
