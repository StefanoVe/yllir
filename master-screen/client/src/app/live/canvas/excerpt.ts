import type { DocBlock } from '@shared/types';

/** Separator for block boundaries, replaced by a line break at the end. Private-use character, never in real text. */
const SEP = '';
const EXCERPT_MAX = 220;

/** Text only: the textContent of the markup, collapsed to one line and cut to `max` characters. Never returns markup. */
export function plainText(html: string): string {
  const spaced = html.replace(/<\/?(p|h[1-6]|li|div|br|tr|td|th|blockquote|section|article|ul|ol|table)\b[^>]*>/gi, ' ');
  return decodeText(spaced.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Decodes entities of tag-free text. The result is text, never markup. */
function decodeText(text: string): string {
  if (typeof DOMParser === 'undefined') {
    return text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }
  return new DOMParser().parseFromString(text, 'text/html').body.textContent ?? '';
}

/**
 * Card excerpt of the first public block: the body text only, without a leading heading (the title is
 * shown in the card header), one line per paragraph, cut after about 220 characters with an ellipsis.
 * A master-only document has no public block, so it gives ''.
 */
export function firstPublicExcerpt(blocks: readonly DocBlock[], max = EXCERPT_MAX): string {
  const block = blocks.find((b) => b.kind === 'public');
  if (!block) return '';
  const body = block.html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/^\s*<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]\s*>/i, '');
  const marked = body
    .replace(/<br\s*\/?>/gi, SEP)
    .replace(/<\/?(p|h[1-6]|li|div|blockquote|section|article|ul|ol|table|tr|pre)\b[^>]*>/gi, SEP);
  const paragraphs = decodeText(marked.replace(/<[^>]*>/g, ''))
    .split(SEP)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0);
  const text = paragraphs.join('\n');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** A readable title from a path when the document cannot be read: the file name without `.md`. */
export function fallbackTitle(path: string): string {
  const name = path.split('/').filter((part) => part.length > 0).pop() ?? path;
  return name.replace(/\.md$/i, '');
}
