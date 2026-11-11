// Public part of a campaign document: what the players may see.
// The master-only block starts at the first MASTER_MARKER and runs to the end of the body.

import { parseFrontmatter } from './frontmatter.mjs';

export const MASTER_MARKER = '<!-- master -->';

/**
 * Returns the body of a Markdown text without its metadata block and without
 * everything from the first master marker to the end.
 * @param {string} markdown full file content
 * @returns {string} the public body (not trimmed)
 */
export function publicBody(markdown) {
  const { body } = parseFrontmatter(String(markdown));
  const marker = body.indexOf(MASTER_MARKER);
  return marker >= 0 ? body.slice(0, marker) : body;
}

function normalizePath(path) {
  return String(path ?? '').replace(/\\/g, '/');
}

/**
 * Tells whether a campaign document may ever be shown to the players.
 * The world seed is entirely master-only, the `.campaign/` folder is internal,
 * and every folder of a `master-only` structure category is master-only.
 * Missing config fields are ignored.
 * @param {string} relPath path relative to the campaign root, with `/` or `\` separators
 * @param {object} config parsed campaign.yaml
 * @returns {boolean} true when the document is public
 */
export function isPublicDocument(relPath, config) {
  const path = normalizePath(relPath);
  const seed = config?.campaign?.seed;
  if (typeof seed === 'string' && seed !== '' && path === normalizePath(seed)) return false;
  if (path.startsWith('.campaign/')) return false;
  const structure = Array.isArray(config?.structure) ? config.structure : [];
  for (const entry of structure) {
    if (entry?.type !== 'master-only' || typeof entry.folder !== 'string') continue;
    const folder = normalizePath(entry.folder).replace(/\/+$/, '');
    if (folder !== '' && path.startsWith(`${folder}/`)) return false;
  }
  return true;
}

/**
 * Returns the public text of a document, or null when the document is not public.
 * @param {string} markdown full file content
 * @param {string} relPath path relative to the campaign root
 * @param {object} config parsed campaign.yaml
 * @returns {string|null} the trimmed public body, or null
 */
export function publicText(markdown, relPath, config) {
  if (!isPublicDocument(relPath, config)) return null;
  return publicBody(markdown).trim();
}
