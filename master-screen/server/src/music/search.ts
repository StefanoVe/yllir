// Search over the music tracks, by vibe rather than by literal words. Each query word matches
// a track through its own folded form, its Italian stem, its synonyms (direct) and its vibe
// neighbours (loose). Any query word may match (OR), and tracks covering more query words rank
// higher. Matches in the track's own fields weigh more than matches in the sheet's passages.
// Pure function, no I/O. Owner: music engineer.
import type { MusicTrack } from '../../../shared/src/types.js';
import { STOPWORDS, SYNONYM_GROUPS, VIBE_GROUPS } from './lexicon.js';

export interface FoldModule {
  foldText(s: string): { folded: string };
}

/**
 * A track with the private search context of its sheet. Server side only: the passages may
 * hold master-only text, and they never go to the model.
 */
export interface MusicEntry {
  track: MusicTrack;
  /** Name of the sheet's parent folder, e.g. "Porto" for Places/Porto/Porto.md. */
  area: string;
  /** Sentences and headings of the sheet, in order, music section excluded. */
  passages: string[];
}

export interface SearchOptions {
  query?: string;
  /** Campaign-relative path of one sheet: only its tracks. */
  doc?: string;
  fold: FoldModule;
  limit?: number;
}

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;
const MAX_QUERY_CHARS = 200;
const MIN_TERM_LENGTH = 3;
/** Lexicon words shorter than this match only whole or by stem, never as a prefix. */
const MIN_PREFIX_LENGTH = 4;
const FIELD_WEIGHT = 3;
const PASSAGE_WEIGHT = 2;
const SYNONYM_WEIGHT = 0.85;
const VIBE_WEIGHT = 0.6;
/** A match at or above this weight counts as direct. Loose results only show when none is. */
const DIRECT_WEIGHT = SYNONYM_WEIGHT;
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** One word a query term may match, with the weight of the match and whether prefixes count. */
interface Variant {
  word: string;
  weight: number;
  prefix: boolean;
}

type Item = MusicTrack | MusicEntry;

function isEntry(item: Item): item is MusicEntry {
  return 'track' in item;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Folded words of a text, in order. */
function wordsOf(fold: FoldModule, text: string): string[] {
  return fold.foldText(text).folded.split(WORD_SPLIT).filter((word) => word !== '');
}

/**
 * Italian stem: drops the final vowels (keeping three letters at least) and the h of «-chi»
 * and «-ghi», so «boschi» and «bosco» both become «bosc».
 */
function stemOf(word: string): string {
  let stem = word;
  while (stem.length > 3 && VOWELS.has(stem[stem.length - 1])) stem = stem.slice(0, -1);
  if (stem.endsWith('ch') || stem.endsWith('gh')) stem = stem.slice(0, -1);
  return stem;
}

/**
 * Whether a word of a track (token) matches a variant: the same word, a prefix (when allowed),
 * or the same stem. Long variants also match derived forms of their stem, and only a little
 * longer than themselves.
 */
function matchesVariant(token: string, variant: Variant): boolean {
  if (token === variant.word) return true;
  if (variant.prefix && token.startsWith(variant.word)) return true;
  const wordStem = stemOf(variant.word);
  if (wordStem.length < 3) return false;
  if (variant.word.length > 6) return token.startsWith(wordStem) && token.length <= variant.word.length + 4;
  return stemOf(token) === wordStem;
}

/** The words a query term may match, each with its weight. The term itself is always first. */
function variantsOf(term: string): Variant[] {
  const byWord = new Map<string, Variant>();
  const add = (word: string, weight: number): void => {
    const current = byWord.get(word);
    if (current === undefined || current.weight < weight) {
      byWord.set(word, { word, weight, prefix: word === term || word.length >= MIN_PREFIX_LENGTH });
    }
  };
  add(term, 1);
  const expand = (groups: ReadonlyArray<readonly string[]>, weight: number): void => {
    for (const group of groups) {
      const hit = group.some((member) =>
        matchesVariant(term, { word: member, weight: 1, prefix: member.length >= MIN_PREFIX_LENGTH }),
      );
      if (!hit) continue;
      for (const member of group) if (member !== term) add(member, weight);
    }
  };
  expand(SYNONYM_GROUPS, SYNONYM_WEIGHT);
  expand(VIBE_GROUPS, VIBE_WEIGHT);
  return [...byWord.values()];
}

/** The distinct, folded, meaningful words of a query. */
function termsOf(fold: FoldModule, query: string): string[] {
  const words = wordsOf(fold, query).filter((word) => word.length >= MIN_TERM_LENGTH && !STOPWORDS.has(word));
  return [...new Set(words)];
}

/** Best-first order: most query words covered, then total score, then preferred, then the alphabet. */
interface Scored {
  track: MusicTrack;
  snippet?: string;
  matches?: string[];
  direct: boolean;
  covered: number;
  total: number;
}

function scoreEntry(
  entry: MusicEntry,
  variants: Variant[][],
  fold: FoldModule,
  passageWordsOf: (passage: string) => string[],
): Scored | null {
  const { track } = entry;
  const fieldWords = wordsOf(fold, [track.title, track.mood, track.docTitle, track.docPath, entry.area].join(' '));
  const passageWords = entry.passages.map(passageWordsOf);
  // Per passage: the best weight each query term reached in it, and the words that matched.
  const passageTermWeight = entry.passages.map(() => variants.map(() => 0));
  const passageMatched = entry.passages.map(() => new Set<string>());

  let covered = 0;
  let total = 0;
  let direct = false;
  variants.forEach((termVariants, termIndex) => {
    let best = 0;
    for (const variant of termVariants) {
      if (fieldWords.some((word) => matchesVariant(word, variant))) {
        best = Math.max(best, FIELD_WEIGHT * variant.weight);
        direct = direct || variant.weight >= DIRECT_WEIGHT;
      }
      passageWords.forEach((words, index) => {
        let hit = false;
        for (const word of words) {
          if (!matchesVariant(word, variant)) continue;
          hit = true;
          passageMatched[index].add(word);
        }
        if (!hit) return;
        best = Math.max(best, PASSAGE_WEIGHT * variant.weight);
        direct = direct || variant.weight >= DIRECT_WEIGHT;
        passageTermWeight[index][termIndex] = Math.max(passageTermWeight[index][termIndex], variant.weight);
      });
    }
    if (best > 0) {
      covered += 1;
      total += best;
    }
  });
  if (covered === 0) return null;

  // The snippet is the passage covering the most query words, then the most weight.
  let bestPassage = -1;
  let bestCovered = 0;
  let bestWeight = 0;
  passageTermWeight.forEach((weights, index) => {
    const count = weights.filter((weight) => weight > 0).length;
    const weight = weights.reduce((sum, value) => sum + value, 0);
    if (count > bestCovered || (count === bestCovered && count > 0 && weight > bestWeight)) {
      bestPassage = index;
      bestCovered = count;
      bestWeight = weight;
    }
  });
  const base = { track, direct, covered, total };
  if (bestPassage < 0) return base;
  return {
    ...base,
    snippet: entry.passages[bestPassage],
    matches: [...passageMatched[bestPassage]],
  };
}

/**
 * The tracks that match the query, best first. Any word of the query may match (OR), through
 * the word itself, its stem, a synonym or a vibe neighbour. A query with no meaningful word
 * (only stopwords or punctuation) matches nothing; an empty query lists every track.
 */
export function searchTracks(items: Item[], opts: SearchOptions): MusicTrack[] {
  const limit = opts.limit ?? 200;
  const docFilter = opts.doc === undefined ? '' : opts.doc.replace(/\\/g, '/').replace(/^\.\//, '');
  const rawQuery = (opts.query ?? '').slice(0, MAX_QUERY_CHARS);
  const hasQuery = rawQuery.trim() !== '';
  const terms = hasQuery ? termsOf(opts.fold, rawQuery) : [];
  if (hasQuery && terms.length === 0) return [];

  const entries: MusicEntry[] = items.map((item) =>
    isEntry(item) ? item : { track: item, area: '', passages: [] },
  );
  const variants = terms.map(variantsOf);
  const wordCache = new Map<string, string[]>();
  const passageWordsOf = (passage: string): string[] => {
    let words = wordCache.get(passage);
    if (words === undefined) {
      words = wordsOf(opts.fold, passage);
      wordCache.set(passage, words);
    }
    return words;
  };

  const scored: Scored[] = [];
  for (const entry of entries) {
    if (docFilter !== '' && entry.track.docPath !== docFilter) continue;
    if (!hasQuery) {
      scored.push({ track: entry.track, direct: false, covered: 0, total: 0 });
      continue;
    }
    const hit = scoreEntry(entry, variants, opts.fold, passageWordsOf);
    if (hit !== null) scored.push(hit);
  }

  // Loose results (vibe neighbours only) count only when no track matches directly.
  const anyDirect = scored.some((entry) => entry.direct);
  scored.sort(
    (a, b) =>
      b.covered - a.covered ||
      b.total - a.total ||
      Number(b.track.preferred === true) - Number(a.track.preferred === true) ||
      compare(a.track.docTitle, b.track.docTitle) ||
      compare(a.track.title, b.track.title) ||
      compare(a.track.id, b.track.id),
  );
  return scored
    .filter((entry) => entry.direct || !anyDirect)
    .slice(0, limit)
    .map((entry) => {
      if (entry.snippet === undefined) return entry.track;
      return { ...entry.track, snippet: entry.snippet, matches: entry.matches ?? [] };
    });
}
