import { Injectable, effect, inject, signal } from '@angular/core';
import { PrefsService } from './prefs.service';

export const RECENTS_LIMIT = 12;
const RECENTS_KEY = 'recent-docs';
const FAVOURITES_KEY = 'favourite-docs';
const DOC_PREFIX = '/doc/';

/** Decodes one URL segment; null when it is not valid percent-encoding. */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Campaign-relative document path from a router URL such as `/doc/characters/alia.md?with=x`.
 * The rest of the URL after `/doc/` is taken, query and fragment dropped, each segment decoded once.
 * Returns '' when the URL is not a document URL or a segment is broken.
 */
export function docPathFromUrl(url: string): string {
  const bare = url.split(/[?#]/)[0];
  if (!bare.startsWith(DOC_PREFIX)) return '';
  const segments: string[] = [];
  for (const raw of bare.slice(DOC_PREFIX.length).split('/')) {
    if (raw === '') continue;
    const decoded = decodeSegment(raw);
    if (decoded === null) return '';
    segments.push(decoded);
  }
  return segments.join('/');
}

/** Router URL of a document, every segment encoded. */
export function docUrl(path: string): string {
  return DOC_PREFIX + path.split('/').map(encodeURIComponent).join('/');
}

/** Reads a link written as `/doc/...#fragment` in a rendered document. Null for any other href. */
export function parseDocHref(href: string): { path: string; fragment: string } | null {
  if (!href.startsWith(DOC_PREFIX)) return null;
  const hash = href.indexOf('#');
  const pathPart = hash >= 0 ? href.slice(0, hash) : href;
  const path = docPathFromUrl(pathPart);
  if (path === '') return null;
  const rawFragment = hash >= 0 ? href.slice(hash + 1) : '';
  return { path, fragment: decodeSegment(rawFragment) ?? '' };
}

/** Puts `path` first, drops its older entry, keeps at most `max` entries. */
export function pushRecent(list: readonly string[], path: string, max = RECENTS_LIMIT): string[] {
  return [path, ...list.filter((entry) => entry !== path)].slice(0, max);
}

/** Adds `path` when absent, removes it when present. */
export function toggleEntry(list: readonly string[], path: string): string[] {
  return list.includes(path) ? list.filter((entry) => entry !== path) : [path, ...list];
}

/** Reads a stored JSON list of paths. Anything malformed becomes an empty list. */
export function parseStoredPaths(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      if (typeof item === 'string' && item !== '' && !out.includes(item)) out.push(item);
    }
    return out.slice(0, RECENTS_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Recently opened and favourite documents of the campaign, kept in PrefsService (localStorage).
 * Lists are reloaded whenever the campaign slug becomes known.
 */
@Injectable({ providedIn: 'root' })
export class DocNavService {
  private readonly prefs = inject(PrefsService);
  private readonly recentList = signal<string[]>([]);
  private readonly favouriteList = signal<string[]>([]);

  readonly recents = this.recentList.asReadonly();
  readonly favourites = this.favouriteList.asReadonly();

  constructor() {
    effect(() => {
      // Reading the slug makes this effect run again once the campaign is known.
      this.prefs.slug();
      this.recentList.set(parseStoredPaths(this.prefs.get(RECENTS_KEY)));
      this.favouriteList.set(parseStoredPaths(this.prefs.get(FAVOURITES_KEY)));
    });
  }

  isFavourite(path: string): boolean {
    return this.favouriteList().includes(path);
  }

  recordOpen(path: string): void {
    const next = pushRecent(this.recentList(), path);
    this.recentList.set(next);
    this.prefs.set(RECENTS_KEY, JSON.stringify(next));
  }

  toggleFavourite(path: string): void {
    const next = toggleEntry(this.favouriteList(), path);
    this.favouriteList.set(next);
    this.prefs.set(FAVOURITES_KEY, JSON.stringify(next));
  }
}
