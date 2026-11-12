// Search-query guard of the artwork search. The agent proposes generic visual
// words in English; this module refuses any word that comes from the campaign
// and builds the final web-search query. Nothing from the master-only block of a
// document, from the world seed, from a master-only folder or from a subject
// name may reach a web search.

import fs from 'node:fs';
import path from 'node:path';
import { foldText } from '../../../../../scripts/lib/fold.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { MASTER_MARKER, isPublicDocument, publicBody } from '../../../../../scripts/lib/public-text.mjs';
import { buildSubjectIndex } from '../../../../../scripts/lib/subjects.mjs';
import { fail, isFile, readCampaign, safeRelative } from '../../../images/scripts/lib/image-job.mjs';

/** Visual prefix appended to the agent's words, per kind of image. */
export const KIND_PREFIX = Object.freeze({
  character: 'character portrait artwork',
  creature: 'creature concept art',
  place: 'location environment concept art',
  item: 'item prop illustration',
  map: 'top down battlemap grid',
});

/** Terms that must never be sent to a search engine as exclusions for AI images. */
export const NEGATIVE = Object.freeze(['ai', 'ai generated', 'midjourney', 'stable diffusion']);

/** Words that may appear in a title without being a leak (checked against the title only). */
const COMMON_TITLE_WORDS = new Set([
  'dwarf', 'elf', 'elven', 'human', 'orc', 'tiefling', 'knight', 'tower', 'castle', 'forest',
  'mountain', 'river', 'village', 'city', 'tavern', 'dungeon', 'cave', 'temple', 'warrior',
  'wizard', 'mage', 'rogue', 'cleric', 'priest', 'king', 'queen', 'lord', 'lady', 'old', 'young',
  'tall', 'short',
]);

const MAX_TERMS_CHARS = 140;
const MAX_TERMS_WORDS = 14;
const MIN_LEAK_WORD = 4;
const TERMS_CHARS = /^[\p{L}\p{N} ,-]+$/u;
const MASTER_MARKERS = /<!--\s*\/?\s*master\s*-->/g;

/**
 * Lowercase, accent-free words of a text (letters and digits only).
 * @param {string} text
 * @returns {string[]}
 */
export function words(text) {
  return foldText(String(text ?? '')).folded.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');
}

/** True when the phrase (a list of words) occurs as whole words in the list of words. */
function containsPhrase(haystack, phrase) {
  if (phrase.length === 0) return false;
  return ` ${haystack.join(' ')} `.includes(` ${phrase.join(' ')} `);
}

/** The search form of a query: the query, then the exclusions of AI images. */
export function searchForm(query) {
  return `${query} -ai -midjourney -"stable diffusion"`;
}

/** Forbidden phrases of a campaign document, each with the reason it is forbidden. */
function collectRules(rootAbs, rel, config, text) {
  const rules = new Map(); // key: phrase -> source; first source wins
  const add = (phrase, source) => {
    if (phrase.length === 0) return;
    const key = phrase.join(' ');
    if (!rules.has(key)) rules.set(key, { phrase, source });
  };

  // (a) title words of 4+ letters that are not common words.
  const titleLine = publicBody(text).split(/\r?\n/).find((line) => line.startsWith('# '));
  if (titleLine !== undefined) {
    for (const word of words(titleLine.slice(2))) {
      if (word.length >= MIN_LEAK_WORD && !COMMON_TITLE_WORDS.has(word)) add([word], 'the document title');
    }
  }

  // (b) names and aliases of every subject of the campaign.
  let index = null;
  try {
    index = buildSubjectIndex(rootAbs);
  } catch {
    index = null; // without the index, titles and the document text still guard the query
  }
  for (const subject of index?.subjects ?? []) {
    for (const form of subject.forms ?? []) {
      add(words(form.text), 'a subject name or alias of the campaign');
    }
  }

  // (c) words of 4+ letters of the master-only block that the public body does not contain.
  const body = parseFrontmatter(text).body;
  const marker = body.indexOf(MASTER_MARKER);
  const masterText = marker >= 0 ? body.slice(marker).replace(MASTER_MARKERS, ' ') : '';
  const publicWords = new Set(words(publicBody(text)));
  for (const word of words(masterText)) {
    if (word.length >= MIN_LEAK_WORD && !publicWords.has(word)) add([word], 'the master-only part of the document');
  }

  // (d) words of 4+ letters of the world seed, which is master-only.
  const seed = config?.campaign?.seed;
  const seedRel = typeof seed === 'string' ? safeRelative(seed) : null;
  if (seedRel !== null && !isPublicDocument(seedRel, config) && isFile(path.join(rootAbs, seedRel))) {
    const seedText = fs.readFileSync(path.join(rootAbs, seedRel), 'utf8');
    for (const word of words(seedText)) {
      if (word.length >= MIN_LEAK_WORD) add([word], 'the world seed');
    }
  }
  return [...rules.values()];
}

function validTerms(terms) {
  if (typeof terms !== 'string') return 'terms must be a string';
  const clean = terms.trim().replace(/\s+/g, ' ');
  if (clean === '') return 'terms must not be empty';
  if (clean.length > MAX_TERMS_CHARS) return `terms must be at most ${MAX_TERMS_CHARS} characters`;
  if (clean.split(' ').length > MAX_TERMS_WORDS) return `terms must be at most ${MAX_TERMS_WORDS} words`;
  if (!TERMS_CHARS.test(clean)) return 'terms may contain only letters, digits, spaces, hyphens and commas';
  if (!/[\p{L}\p{N}]/u.test(clean)) return 'terms must contain at least one letter or digit';
  return null;
}

function buildQueryUnsafe({ root, document, kind, terms }) {
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(KIND_PREFIX, kind)) {
    return fail('bad-kind', `kind must be one of: ${Object.keys(KIND_PREFIX).join(', ')}`);
  }
  const termsProblem = validTerms(terms);
  if (termsProblem !== null) return fail('bad-terms', termsProblem);
  const clean = terms.trim().replace(/\s+/g, ' ');

  const rootAbs = path.resolve(String(root ?? ''));
  const rel = safeRelative(document);
  if (rel === null) return fail('not-found', `document not found: ${document}`);

  const campaign = readCampaign(rootAbs);
  if (!campaign.ok) return campaign;
  const { config } = campaign;

  if (!isPublicDocument(rel, config)) {
    return fail('not-public', `${rel} is not public: a search cannot use it`);
  }
  const docAbs = path.join(rootAbs, rel);
  if (!isFile(docAbs)) return fail('not-found', `document not found: ${rel}`);
  const text = fs.readFileSync(docAbs, 'utf8');

  const termWords = words(clean);
  for (const rule of collectRules(rootAbs, rel, config, text)) {
    if (containsPhrase(termWords, rule.phrase)) {
      const word = rule.phrase.join(' ');
      return fail(
        'forbidden-term',
        `"${word}" is not allowed in a search: it comes from ${rule.source}. Use generic visual words instead.`,
      );
    }
  }

  const query = `${clean} ${KIND_PREFIX[kind]}`;
  return { ok: true, query, negative: [...NEGATIVE], kind };
}

/**
 * Checks the agent's visual words against the campaign and builds the search query.
 * Never throws.
 * @param {{ root: string, document: string, kind: string, terms: string }} args
 * @returns {{ ok: true, query: string, negative: string[], kind: string } | { ok: false, error: string, message: string }}
 */
export function buildQuery({ root, document, kind, terms } = {}) {
  try {
    return buildQueryUnsafe({ root, document, kind, terms });
  } catch (err) {
    return fail('internal', `query could not be built: ${err?.message ?? String(err)}`);
  }
}
