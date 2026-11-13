/** One piece of a snippet: plain text, or a word the server reported as a match. */
export interface SnippetPart {
  text: string;
  hit: boolean;
}

/** Lower case, accents removed. Compared on both sides, so `Pioggia` matches `pioggia` and `pioggía`. */
export function foldWord(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Splits a snippet into words and plain text, marking the words whose folded form is one of the
 * matches. The original text is kept exactly, so the caller renders it as text nodes, never HTML.
 */
export function snippetParts(snippet: string, matches: readonly string[]): SnippetPart[] {
  const wanted = new Set(matches.map(foldWord).filter((word) => word !== ''));
  const parts: SnippetPart[] = [];
  // Plain text between matches is merged into one part, so the output is short and stable.
  const push = (text: string, hit: boolean): void => {
    const last = parts[parts.length - 1];
    if (!hit && last && !last.hit) last.text += text;
    else parts.push({ text, hit });
  };
  let last = 0;
  for (const found of snippet.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    const start = found.index ?? 0;
    if (start > last) push(snippet.slice(last, start), false);
    push(found[0], wanted.has(foldWord(found[0])));
    last = start + found[0].length;
  }
  if (last < snippet.length) push(snippet.slice(last), false);
  return parts;
}

/** Clock text: mm:ss, or h:mm:ss from one hour on. Unknown or negative values read as zero. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}
