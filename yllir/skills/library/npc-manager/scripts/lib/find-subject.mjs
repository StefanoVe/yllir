// Finds the subjects whose title or alias matches a name, ignoring case, accents
// and punctuation. Deterministic: it returns candidates; choosing among them is
// left to the agent.

import { buildSubjectIndex, compareStrings } from '../../../../../scripts/lib/subjects.mjs';
import { foldForm } from '../../../../../scripts/lib/fold.mjs';

const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u;

/**
 * @param {string} campaignRoot absolute path to the campaign folder
 * @param {string} name the name to look for
 * @returns {{ matches: Array<{id: string, sheet: string, form: string, kind: string, match: 'exact'|'partial'}> }}
 */
export function findSubject(campaignRoot, name) {
  const query = foldForm(typeof name === 'string' ? name : '');
  if (query === '') return { matches: [] };

  const { subjects } = buildSubjectIndex(campaignRoot);
  const bestById = new Map();

  for (const subject of subjects) {
    for (const form of subject.forms) {
      const match = matchKind(form.folded, query);
      if (match === null) continue;

      const candidate = {
        id: subject.id,
        sheet: subject.sheet,
        form: form.text,
        kind: form.kind,
        match,
      };
      const current = bestById.get(subject.id);
      if (current === undefined || rank(candidate) < rank(current)) {
        bestById.set(subject.id, candidate);
      }
    }
  }

  const matches = [...bestById.values()].sort(
    (a, b) => MATCH_ORDER[a.match] - MATCH_ORDER[b.match] || compareStrings(a.id, b.id),
  );
  return { matches };
}

const MATCH_ORDER = { exact: 0, partial: 1 };

/** 'exact', 'partial' or null. */
function matchKind(folded, query) {
  if (folded === query) return 'exact';

  const [shorter, longer] = folded.length <= query.length ? [folded, query] : [query, folded];
  const shorterWords = words(shorter);
  if (shorterWords.length === 0) return null;

  const longerWords = new Set(words(longer));
  return shorterWords.every((word) => longerWords.has(word)) ? 'partial' : null;
}

function words(folded) {
  return folded.split(WORD_SEPARATOR).filter((w) => w !== '');
}

/** Lower is better: exact before partial, title before alias. */
function rank(match) {
  return (match.match === 'exact' ? 0 : 2) + (match.kind === 'title' ? 0 : 1);
}
