/**
 * Splits a snippet of server text into plain segments, marking the parts that match the query.
 * The result is data only: the template renders each segment as text (never innerHTML), so a
 * snippet such as `<img onerror=...>` stays visible text.
 */
export interface Segment {
  text: string;
  match: boolean;
}

/** Case and accent insensitive form of one code point; may be empty (lone combining marks). */
function foldChar(char: string): string {
  return char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Words of the query in folded form. */
export function queryTerms(query: string): string[] {
  const folded = Array.from(query)
    .map(foldChar)
    .join('');
  return folded
    .split(/[\s\p{P}\p{S}]+/u)
    .filter((term) => term !== '');
}

interface Folded {
  text: string;
  /** For every folded UTF-16 unit: where its original code point starts and ends. */
  starts: number[];
  ends: number[];
}

/** Folds a text while remembering, for each folded unit, the span of the original text it came from. */
function fold(text: string): Folded {
  let out = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const char of text) {
    const start = offset;
    const end = offset + char.length;
    offset = end;
    const folded = foldChar(char);
    for (let i = 0; i < folded.length; i++) {
      starts.push(start);
      ends.push(end);
    }
    out += folded;
  }
  return { text: out, starts, ends };
}

/** Every [start, end) range of the original text that matches one of the query words. */
function matchRanges(text: string, query: string): Array<[number, number]> {
  const terms = queryTerms(query);
  if (terms.length === 0 || text === '') return [];
  const folded = fold(text);
  const found: Array<[number, number]> = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = folded.text.indexOf(term, from);
      if (at < 0) break;
      const last = at + term.length - 1;
      found.push([folded.starts[at], folded.ends[last]]);
      from = at + term.length;
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of found) {
    const previous = merged[merged.length - 1];
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/** Segments of `text` with every query word marked. Concatenated, the segments give `text` back exactly. */
export function highlightSegments(text: string, query: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of matchRanges(text, query)) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}
