/** A recently opened document, kept in PrefsService for the look-up panel. */
export interface RecentDoc {
  path: string;
  title: string;
}

export const RECENTS_KEY = 'live-recent-docs';
export const RECENTS_MAX = 8;

/** Reads the stored list. Anything malformed becomes an empty list, never an error. */
export function parseRecents(raw: string | null): RecentDoc[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const out: RecentDoc[] = [];
    for (const item of value as unknown[]) {
      const { path, title } = (item ?? {}) as { path?: unknown; title?: unknown };
      if (typeof path !== 'string' || path === '' || out.some((entry) => entry.path === path)) continue;
      out.push({ path, title: typeof title === 'string' && title !== '' ? title : path });
    }
    return out.slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

/** The opened document goes first; an older entry of the same path is dropped. */
export function pushRecent(list: readonly RecentDoc[], entry: RecentDoc): RecentDoc[] {
  return [entry, ...list.filter((item) => item.path !== entry.path)].slice(0, RECENTS_MAX);
}
