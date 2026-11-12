// Search query of the music search. Built ONLY from the public part of a place
// sheet (the title and the atmosphere words of the public body). Every word that
// is the name of another subject of the campaign is dropped, whether that subject
// is public or master-only (fail closed). The master-only block is never read
// into the query: publicBody() cuts it off before any word is taken.

import fs from 'node:fs';
import path from 'node:path';
import { buildSubjectIndex } from '../../../../../scripts/lib/subjects.mjs';
import { isPublicDocument, publicBody } from '../../../../../scripts/lib/public-text.mjs';
import { MAX_MOOD_TERMS, MOOD_TERMS } from './mood.mjs';
import { fail, isFile, musicEnabled, readCampaign, safeRelative, words } from './common.mjs';

const MIN_WORD = 4;
const MAX_TITLE_WORDS = 4;
/** Generic words appended to every query: they say what kind of music is wanted. */
export const QUERY_SUFFIX = 'ambience soundtrack';

const STOP = new Set([
  'the', 'and', 'with', 'from', 'that', 'this', 'these', 'those', 'into', 'over', 'under', 'their',
  'there', 'where', 'when', 'what', 'which', 'your', 'have', 'been', 'were', 'also', 'della', 'delle',
  'dello', 'degli', 'nella', 'nelle', 'sono', 'come', 'anche', 'dove', 'quando', 'questo', 'questa',
  'questi', 'queste', 'sulla', 'sulle', 'sopra', 'sotto', 'dalla', 'dalle', 'dagli', 'dei', 'gli',
  'con', 'per', 'tra', 'fra', 'una', 'uno', 'piu', 'molto', 'nel', 'nei', 'alla', 'alle', 'dal',
]);

/** Words of a heading or line that are the document title (the first level-1 heading). */
function titleOf(publicText) {
  const line = publicText.split(/\r?\n/).find((l) => /^#\s+\S/.test(l));
  if (line === undefined) return null;
  return line.replace(/^#\s+/, '').replace(/\s+#+\s*$/, '').trim();
}

/**
 * Maps every word of every subject form to the set of subjects that own it.
 * @returns {Map<string, Set<string>>}
 */
function wordOwners(index) {
  const owners = new Map();
  for (const subject of index.subjects) {
    for (const form of subject.forms ?? []) {
      for (const word of words(form.text)) {
        if (!owners.has(word)) owners.set(word, new Set());
        owners.get(word).add(subject.id);
      }
    }
  }
  return owners;
}

function buildMusicQueryUnsafe({ root, place }) {
  const rootAbs = path.resolve(String(root ?? ''));
  const rel = safeRelative(place);
  if (rel === null) return fail('not-found', `place sheet not found: ${place}`);

  const campaign = readCampaign(rootAbs);
  if (!campaign.ok) return campaign;
  if (!musicEnabled(campaign.config)) {
    return fail('module-off', 'the music module is off in campaign.yaml');
  }
  if (!isPublicDocument(rel, campaign.config)) {
    return fail('not-public', `${rel} is not public: a search cannot use it`);
  }
  const file = path.join(rootAbs, rel);
  if (!isFile(file)) return fail('not-found', `place sheet not found: ${rel}`);
  const text = fs.readFileSync(file, 'utf8');
  const publicText = publicBody(text).trim();

  // Without a readable index, names of other subjects cannot be dropped: refuse.
  const index = buildSubjectIndex(rootAbs);
  if (index.errors.length > 0) {
    return fail('index-errors', 'some sheets of the campaign have problems: the framework must fix them first');
  }
  const ownSheet = rel;
  const ownIds = new Set(index.subjects.filter((s) => s.sheet === ownSheet || (s.paths ?? []).includes(ownSheet)).map((s) => s.id));
  const owners = wordOwners(index);
  // A word is a name of another subject when some subject other than this place owns it.
  const isOtherName = (word) => {
    const set = owners.get(word);
    if (set === undefined) return false;
    for (const id of set) if (!ownIds.has(id)) return true;
    return false;
  };

  const excluded = [];
  const title = titleOf(publicText);
  if (title === null || title === '') return fail('no-title', 'the place sheet has no public title');

  // (1) Title words: the name of the place, when it is not the name of another subject.
  const titleTerms = [];
  for (const word of words(title)) {
    if (word.length < MIN_WORD || STOP.has(word)) continue;
    if (isOtherName(word)) {
      excluded.push({ term: word, reason: 'name of another subject of the campaign' });
      continue;
    }
    if (!titleTerms.includes(word) && titleTerms.length < MAX_TITLE_WORDS) titleTerms.push(word);
  }

  // (2) Atmosphere words: public words that are in the lexicon, mapped to English.
  const moodTerms = [];
  for (const word of new Set(words(publicText))) {
    const term = MOOD_TERMS.get(word);
    if (term === undefined) continue;
    if (isOtherName(word) || isOtherName(term)) {
      excluded.push({ term: word, reason: 'name of another subject of the campaign' });
      continue;
    }
    if (!moodTerms.includes(term) && moodTerms.length < MAX_MOOD_TERMS) moodTerms.push(term);
  }

  if (titleTerms.length === 0 && moodTerms.length === 0) {
    return fail('no-terms', 'the public part of the place has no usable words for a search');
  }
  const query = [...titleTerms, ...moodTerms, QUERY_SUFFIX].join(' ');
  return { ok: true, query, mood_words: moodTerms, excluded };
}

/**
 * Builds the music search query of one place sheet. Never throws.
 * @param {{ root: string, place: string }} args
 * @returns {{ ok: true, query: string, mood_words: string[], excluded: { term: string, reason: string }[] } | { ok: false, error: string, message: string }}
 */
export function buildMusicQuery({ root, place } = {}) {
  try {
    return buildMusicQueryUnsafe({ root, place });
  } catch (err) {
    return fail('internal', `query could not be built: ${err?.message ?? String(err)}`);
  }
}
