import { foldWord } from './music-highlight';

/** The atmosphere chips of the library, in the order they show. The label is translated by its key. */
export const VIBES = [
  'tension',
  'mystery',
  'tavern',
  'travel',
  'battle',
  'calm',
  'sorrow',
  'celebration',
  'night',
  'ruins',
  'forest',
  'snow',
] as const;
export type Vibe = (typeof VIBES)[number];

/** The words of a query, split on spaces. */
export function queryWords(query: string): string[] {
  return query.trim().split(/\s+/).filter((word) => word !== '');
}

/** True when `term` is one of the words of the query (accent and case insensitive). */
export function hasTerm(query: string, term: string): boolean {
  const wanted = foldWord(term);
  return queryWords(query).some((word) => foldWord(word) === wanted);
}

/**
 * Adds the term to the query when it is missing, removes it when it is there. The other words keep
 * their order, so several chips can be on at once: they are joined with spaces.
 */
export function toggleTerm(query: string, term: string): string {
  const wanted = foldWord(term);
  const words = queryWords(query);
  if (words.some((word) => foldWord(word) === wanted)) {
    return words.filter((word) => foldWord(word) !== wanted).join(' ');
  }
  return [...words, term].join(' ');
}
