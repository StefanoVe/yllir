import type { DocBlock } from '@shared/types';

/** Text only: the textContent of the markup, collapsed to one line and cut to `max` characters. Never returns markup. */
export function plainText(html: string): string {
  // Block boundaries become spaces, so "<h2>Alia</h2><p>text" reads "Alia text", not "Aliatext".
  const spaced = html.replace(/<\/?(p|h[1-6]|li|div|br|tr|td|th|blockquote|section|article|ul|ol|table)\b[^>]*>/gi, ' ');
  if (typeof DOMParser === 'undefined') return spaced.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const parsed = new DOMParser().parseFromString(spaced, 'text/html');
  return (parsed.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Excerpt of the first public block of a document. A master-only document has no public block, so it gives ''. */
export function firstPublicExcerpt(blocks: readonly DocBlock[], max = 240): string {
  const block = blocks.find((b) => b.kind === 'public');
  if (!block) return '';
  const text = plainText(block.html);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** A readable title from a path when the document cannot be read: the file name without `.md`. */
export function fallbackTitle(path: string): string {
  const name = path.split('/').filter((part) => part.length > 0).pop() ?? path;
  return name.replace(/\.md$/i, '');
}
