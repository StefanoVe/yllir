// Watches the canon files of the campaign (chokidar) and publishes `files` events.
// Owner: docs engineer. Also watches .git/HEAD and .git/refs/heads and publishes `changes`
// when the branch moves (a git commit or undo by the engine).
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { Ctx } from '../context.js';

const FILE_DEBOUNCE_MS = 150;
const GIT_DEBOUNCE_MS = 300;
const TRACKED_EXTENSIONS = new Set(['.md', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

function toRelative(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}

/** Dotfolders and dotfiles (.git, .campaign, ...) and node_modules are never watched. */
function isExcludedPath(root: string, abs: string, stats?: { isDirectory(): boolean }): boolean {
  const rel = path.relative(root, abs);
  if (rel === '') return false;
  const parts = rel.split(path.sep);
  if (parts.some((part) => part.startsWith('.') || part === 'node_modules')) return true;
  if (stats?.isDirectory()) return false;
  const ext = path.extname(rel).toLowerCase();
  return ext !== '' && !TRACKED_EXTENSIONS.has(ext);
}

function isTrackedFile(rel: string): boolean {
  return TRACKED_EXTENSIONS.has(path.extname(rel).toLowerCase());
}

/** Starts the watcher. The returned function stops it. */
export function startWatcher(ctx: Ctx): () => Promise<void> {
  const root = ctx.campaignRoot;
  let closed = false;

  // Canon files: one `files` event per quiet period of 150 ms.
  const changed = new Set<string>();
  const removed = new Set<string>();
  let fileTimer: NodeJS.Timeout | null = null;

  const flushFiles = (): void => {
    fileTimer = null;
    if (closed) return;
    const changedList = [...changed].sort();
    const removedList = [...removed].sort();
    changed.clear();
    removed.clear();
    if (changedList.length === 0 && removedList.length === 0) return;
    ctx.bus.publish('files', { changed: changedList, removed: removedList });
  };

  const scheduleFiles = (): void => {
    if (fileTimer !== null) clearTimeout(fileTimer);
    fileTimer = setTimeout(flushFiles, FILE_DEBOUNCE_MS);
  };

  const canonWatcher: FSWatcher = watch(root, {
    ignored: (abs: string, stats?: { isDirectory(): boolean }) => isExcludedPath(root, abs, stats),
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
  });

  const onWrite = (abs: string): void => {
    const rel = toRelative(root, abs);
    if (!isTrackedFile(rel)) return;
    removed.delete(rel);
    changed.add(rel);
    scheduleFiles();
  };
  const onUnlink = (abs: string): void => {
    const rel = toRelative(root, abs);
    if (!isTrackedFile(rel)) return;
    changed.delete(rel);
    removed.add(rel);
    scheduleFiles();
  };
  canonWatcher.on('add', onWrite);
  canonWatcher.on('change', onWrite);
  canonWatcher.on('unlink', onUnlink);
  canonWatcher.on('error', (err: unknown) => ctx.log(`file watcher error: ${String(err)}`));

  // Git branch movement: a second watcher, debounced 300 ms into one `changes` event.
  let gitTimer: NodeJS.Timeout | null = null;
  const gitWatcher: FSWatcher = watch([path.join(root, '.git', 'HEAD'), path.join(root, '.git', 'refs', 'heads')], {
    ignoreInitial: true,
    persistent: true,
  });
  gitWatcher.on('all', () => {
    if (gitTimer !== null) clearTimeout(gitTimer);
    gitTimer = setTimeout(() => {
      gitTimer = null;
      if (!closed) ctx.bus.publish('changes', {});
    }, GIT_DEBOUNCE_MS);
  });
  gitWatcher.on('error', (err: unknown) => ctx.log(`git watcher error: ${String(err)}`));

  return async () => {
    closed = true;
    if (fileTimer !== null) clearTimeout(fileTimer);
    if (gitTimer !== null) clearTimeout(gitTimer);
    fileTimer = null;
    gitTimer = null;
    await Promise.all([canonWatcher.close(), gitWatcher.close()]);
  };
}
