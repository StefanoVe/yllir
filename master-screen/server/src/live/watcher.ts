// Watches <campaign>/.campaign/state/live (chokidar, recursive) and publishes SSE `live`
// with the new revision, debounced. The folder may not exist yet: then the server polls for
// it every 2 s, and starts the watch as soon as it appears. Nothing leaks: the poll stops
// when the watch starts, and the stop function clears both.
// The docs watcher ignores .campaign/ and is not changed.
// Owner: live engineer.
import fs from 'node:fs';
import { watch, type FSWatcher } from 'chokidar';
import type { Ctx } from '../context.js';
import { liveDirOf, liveRevision, publishLive } from './snapshot.js';

export const LIVE_DEBOUNCE_MS = 150;
export const LIVE_POLL_MS = 2000;

export interface LiveWatcherOptions {
  debounceMs?: number;
  pollMs?: number;
}

/** Starts the live watcher. The returned function stops it and resolves when it is closed. */
export function startLiveWatcher(ctx: Ctx, opts: LiveWatcherOptions = {}): () => Promise<void> {
  const debounceMs = opts.debounceMs ?? LIVE_DEBOUNCE_MS;
  const pollMs = opts.pollMs ?? LIVE_POLL_MS;
  const liveDir = liveDirOf(ctx.campaignRoot);
  let closed = false;
  let watcher: FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let pollTimer: NodeJS.Timeout | null = null;

  const fire = (): void => {
    debounceTimer = null;
    if (closed) return;
    liveRevision(ctx.campaignRoot)
      .then((revision) => {
        if (!closed) publishLive(ctx, revision);
      })
      .catch((err: unknown) => ctx.log(`live watcher failed: ${String(err)}`));
  };

  const schedule = (): void => {
    if (closed) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fire, debounceMs);
  };

  const attach = (): void => {
    if (closed) return;
    watcher = watch(liveDir, { ignoreInitial: true, persistent: true });
    watcher.on('all', schedule);
    watcher.on('error', (err: unknown) => ctx.log(`live watcher error: ${String(err)}`));
  };

  if (fs.existsSync(liveDir)) {
    attach();
  } else {
    pollTimer = setInterval(() => {
      if (closed || !fs.existsSync(liveDir)) return;
      if (pollTimer !== null) clearInterval(pollTimer);
      pollTimer = null;
      attach();
      schedule();
    }, pollMs);
    pollTimer.unref();
  }

  return async () => {
    closed = true;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (pollTimer !== null) clearInterval(pollTimer);
    debounceTimer = null;
    pollTimer = null;
    if (watcher !== null) await watcher.close();
    watcher = null;
  };
}
