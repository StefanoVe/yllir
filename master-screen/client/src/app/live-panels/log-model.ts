import type { LogEntry, LogKind } from '@shared/types';

export const LOG_KINDS: readonly LogKind[] = ['fact', 'decision', 'intention', 'thread'];

/** An open thread is pinned at the top; a resolved one stays in the timeline with a reopen button. */
export function isOpenThread(entry: LogEntry): boolean {
  return entry.kind === 'thread' && entry.resolved !== true;
}

export function openThreads(entries: readonly LogEntry[]): LogEntry[] {
  return entries.filter(isOpenThread);
}

/** The timeline in the order the server gives (oldest first), without the open threads that are pinned above it. */
export function timelineEntries(entries: readonly LogEntry[]): LogEntry[] {
  return entries.filter((entry) => !isOpenThread(entry));
}

export interface KindRun {
  kind: LogKind;
  entries: LogEntry[];
}

/** Consecutive entries of the same kind, in order. A run is drawn as one band, so the kind reads at a glance. */
export function groupByKind(entries: readonly LogEntry[]): KindRun[] {
  const runs: KindRun[] = [];
  for (const entry of entries) {
    const last = runs[runs.length - 1];
    if (last && last.kind === entry.kind) last.entries.push(entry);
    else runs.push({ kind: entry.kind, entries: [entry] });
  }
  return runs;
}

/** A scene is shown by its file name without folder and extension. */
export function sceneLabel(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.md$/i, '');
}
