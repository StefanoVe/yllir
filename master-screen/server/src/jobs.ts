// One build or sheet job at a time per campaign, across the encyclopedia and print modules.
// A second request while one runs gets a busy answer instead of a second process. Owner: master-screen server.
import type { Ctx } from './context.js';
import type { Lang } from './chat/text.js';

export type JobOutcome<T> = { busy: true } | { busy: false; value: T };

const running = new Set<string>();

/**
 * Runs `job` unless another job of this campaign is running. The slot is taken before the
 * first await, so two requests cannot both start. The slot is released even when the job throws.
 */
export async function runExclusiveJob<T>(ctx: Ctx, job: () => Promise<T>): Promise<JobOutcome<T>> {
  const key = ctx.campaignRoot;
  if (running.has(key)) return { busy: true };
  running.add(key);
  try {
    return { busy: false, value: await job() };
  } finally {
    running.delete(key);
  }
}

export const JOB_BUSY_TEXT: Record<Lang, string> = {
  en: 'Another build or sheet job is running. Wait for it to finish and try again.',
  it: 'È in corso un’altra generazione (siti o fogli). Attendi che finisca e riprova.',
};
