// Name normalization helpers. Pure functions, no dependencies.

/**
 * Normalizes a name so that comparisons ignore accents, case, apostrophe and
 * dash variants, and whitespace differences.
 * @param {string} s
 * @returns {string}
 */
export function normalizeForm(s) {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’‘ʼ´`]/g, "'")
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Produces an id such as `torre-dell-ascia` from a name.
 * @param {string} s
 * @returns {string}
 */
export function slugify(s) {
  return normalizeForm(s)
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Heading text as plain text for anchors: each Markdown link `[label](target)`
 * becomes its label, so the anchor of `## Visit to [Name](x.md)` is that of `Visit to Name`.
 * @param {string} s
 * @returns {string}
 */
export function plainHeadingText(s) {
  return s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/**
 * GitHub-style anchor for a Markdown heading text.
 * Accents are kept; each space becomes `-` (no collapsing).
 * @param {string} s
 * @returns {string}
 */
export function headingAnchor(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}
