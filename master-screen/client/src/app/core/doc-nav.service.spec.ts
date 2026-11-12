import { describe, expect, it } from 'vitest';
import {
  RECENTS_LIMIT,
  docPathFromUrl,
  docUrl,
  parseDocHref,
  parseStoredPaths,
  pushRecent,
  toggleEntry,
} from './doc-nav.service';

describe('docPathFromUrl', () => {
  it('takes the rest of the URL after /doc/ and decodes each segment once', () => {
    expect(docPathFromUrl('/doc/characters/alia.md')).toBe('characters/alia.md');
    expect(docPathFromUrl('/doc/places/Porto%20Nuovo.md')).toBe('places/Porto Nuovo.md');
    expect(docPathFromUrl('/doc/notes/100%25%20sure.md')).toBe('notes/100% sure.md');
  });

  it('drops the query, the fragment and empty segments', () => {
    expect(docPathFromUrl('/doc/a//b.md?with=x#top')).toBe('a/b.md');
    expect(docPathFromUrl('/doc/a.md/')).toBe('a.md');
  });

  it('returns an empty path for anything that is not a document URL or is broken', () => {
    expect(docPathFromUrl('/search')).toBe('');
    expect(docPathFromUrl('/doc')).toBe('');
    expect(docPathFromUrl('/doc/%E0%A4%A.md')).toBe('');
  });

  it('round-trips with docUrl', () => {
    const path = 'npc/Lady Ilse & co (2).md';
    expect(docPathFromUrl(docUrl(path))).toBe(path);
    expect(docUrl('a b/c#d.md')).toBe('/doc/a%20b/c%23d.md');
  });
});

describe('parseDocHref', () => {
  it('reads a document link with an optional fragment', () => {
    expect(parseDocHref('/doc/characters/alia.md#history')).toEqual({ path: 'characters/alia.md', fragment: 'history' });
    expect(parseDocHref('/doc/characters/alia.md')).toEqual({ path: 'characters/alia.md', fragment: '' });
  });

  it('ignores links that are not documents', () => {
    expect(parseDocHref('https://example.org/doc/x')).toBeNull();
    expect(parseDocHref('#section')).toBeNull();
    expect(parseDocHref('/api/file?path=a.png')).toBeNull();
    expect(parseDocHref('/doc/')).toBeNull();
  });
});

describe('recents and favourites', () => {
  it('puts the newest first, drops the older entry and caps the list', () => {
    expect(pushRecent(['a', 'b'], 'b')).toEqual(['b', 'a']);
    const full = Array.from({ length: RECENTS_LIMIT }, (_, i) => `d${i}`);
    const next = pushRecent(full, 'new');
    expect(next).toHaveLength(RECENTS_LIMIT);
    expect(next[0]).toBe('new');
    expect(next).not.toContain(`d${RECENTS_LIMIT - 1}`);
  });

  it('toggles an entry in and out of a list', () => {
    expect(toggleEntry([], 'a.md')).toEqual(['a.md']);
    expect(toggleEntry(['a.md', 'b.md'], 'a.md')).toEqual(['b.md']);
  });

  it('reads stored lists defensively', () => {
    expect(parseStoredPaths(null)).toEqual([]);
    expect(parseStoredPaths('not json')).toEqual([]);
    expect(parseStoredPaths('{"a":1}')).toEqual([]);
    expect(parseStoredPaths(JSON.stringify(['a.md', 3, '', 'a.md', 'b.md']))).toEqual(['a.md', 'b.md']);
  });
});
