// Search over the music tracks: folded whole-word and prefix matching over the title, the
// mood, the sheet title and the sheet path. Title and mood matches weigh more than sheet
// matches; on ties the preferred track comes first. Owner: music engineer.
import type { MusicTrack } from '../../../shared/src/types.js';

export interface FoldModule {
  foldText(s: string): { folded: string };
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
const STRONG = 3;
const WEAK = 1;

function wordsOf(fold: FoldModule, text: string): string[] {
  return fold.foldText(text).folded.split(WORD_SPLIT).filter((word) => word !== '');
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The tracks that match, best first. Every term of the query must match a word (whole word
 * or prefix) of the title or mood (strong) or of the sheet title or path (weak). A query
 * with no word in it matches nothing.
 */
export function searchTracks(tracks: MusicTrack[], opts: SearchOptions): MusicTrack[] {
  const limit = opts.limit ?? 200;
  const docFilter = opts.doc === undefined ? '' : opts.doc.replace(/\\/g, '/').replace(/^\.\//, '');
  const rawQuery = (opts.query ?? '').slice(0, MAX_QUERY_CHARS);
  const hasQuery = rawQuery.trim() !== '';
  const terms = hasQuery ? wordsOf(opts.fold, rawQuery) : [];
  if (hasQuery && terms.length === 0) return [];

  const scored: Array<{ track: MusicTrack; score: number }> = [];
  for (const track of tracks) {
    if (docFilter !== '' && track.docPath !== docFilter) continue;
    let score = 0;
    let matches = true;
    if (terms.length > 0) {
      const strong = wordsOf(opts.fold, `${track.title} ${track.mood}`);
      const weak = wordsOf(opts.fold, `${track.docTitle} ${track.docPath}`);
      for (const term of terms) {
        if (strong.some((word) => word.startsWith(term))) score += STRONG;
        else if (weak.some((word) => word.startsWith(term))) score += WEAK;
        else {
          matches = false;
          break;
        }
      }
    }
    if (matches) scored.push({ track, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.track.preferred === true) - Number(a.track.preferred === true) ||
      compare(a.track.docTitle, b.track.docTitle) ||
      compare(a.track.title, b.track.title) ||
      compare(a.track.id, b.track.id),
  );
  return scored.slice(0, limit).map((entry) => entry.track);
}
