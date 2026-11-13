// Structured questions about the world index of a campaign. Each query returns
// sorted plain objects; a bad name, a bad argument count or an unknown id
// returns an `error` string instead of results.

import { buildWorldIndex } from '../world-graph.mjs';
import { foldForm } from '../fold.mjs';
import { compareStrings } from '../subjects.mjs';
import { priceReport } from '../economy/economy.mjs';
import { unreachableNodes, forgottenCharacters } from '../plot/doctor.mjs';

// `encounters [sessionId]` is asynchronous (adapter loaders): it is run by
// runEncounters in encounters.mjs, which the engine calls for that name.
const USAGE =
  'usage: find <text> | at <placeId> | where <id> | related <id> | timeline [from] [to] | sketches | errors | prices | unreachable | forgotten | encounters [sessionId]';

// name -> allowed argument counts
const QUERIES = {
  find: { min: 1, max: 1 },
  at: { min: 1, max: 1 },
  where: { min: 1, max: 1 },
  related: { min: 1, max: 1 },
  timeline: { min: 0, max: 2 },
  sketches: { min: 0, max: 0 },
  errors: { min: 0, max: 0 },
  prices: { min: 0, max: 0 },
  unreachable: { min: 0, max: 0 },
  forgotten: { min: 0, max: 0 },
};

// Queries that read the campaign files directly, without the world index.
// Each returns an object with `results` and any extra fields to show next to it.
const ROOT_HANDLERS = {
  prices(root) {
    const report = priceReport(root);
    return { results: report.results, economy: report.economy };
  },
  unreachable(root) {
    return { results: unreachableNodes(root) };
  },
  forgotten(root) {
    return { results: forgottenCharacters(root) };
  },
};

const NUMBER_RE = /^-?\d+(\.\d+)?$/;

class QueryError extends Error {}

/**
 * @param {string} root campaign folder
 * @param {string} name query name
 * @param {string[]} [args]
 * @returns {{ query: string, args: string[], results: object[] } | { query: string, args: string[], error: string }}
 */
export function runQuery(root, name, args = []) {
  const argList = [...args];
  if (name === 'encounters') {
    return { query: name, args: argList, error: 'encounters is run by runEncounters (encounters.mjs), not runQuery' };
  }
  if (!Object.hasOwn(QUERIES, name)) {
    return { query: name, args: argList, error: `unknown query "${name}". ${USAGE}` };
  }
  const { min, max } = QUERIES[name];
  if (argList.length < min || argList.length > max) {
    return { query: name, args: argList, error: `${name} takes ${countText(min, max)}. ${USAGE}` };
  }

  try {
    if (Object.hasOwn(ROOT_HANDLERS, name)) {
      return { query: name, args: argList, ...ROOT_HANDLERS[name](root) };
    }
    const index = buildWorldIndex(root);
    const results = HANDLERS[name](index, ...argList);
    return { query: name, args: argList, results };
  } catch (err) {
    if (err instanceof QueryError) return { query: name, args: argList, error: err.message };
    throw err;
  }
}

function countText(min, max) {
  if (min === max) return min === 0 ? 'no arguments' : `${min} argument${min === 1 ? '' : 's'}`;
  return `${min} to ${max} arguments`;
}

const HANDLERS = {
  find(index, text) {
    const needle = foldForm(String(text));
    if (needle === '') throw new QueryError('find needs a non-empty text');
    const results = [];
    for (const subject of index.subjects) {
      const forms = [subject.title, ...subject.aliases].filter((form) => typeof form === 'string').map(foldForm);
      let match = null;
      if (forms.includes(needle)) match = 'exact';
      else if (forms.some((form) => form.includes(needle))) match = 'partial';
      if (match !== null) {
        results.push({ id: subject.id, title: subject.title, kind: subject.kind, file: subject.file, match });
      }
    }
    const rank = { exact: 0, partial: 1 };
    return results.sort((a, b) => rank[a.match] - rank[b.match] || compareStrings(a.id, b.id));
  },

  at(index, placeId) {
    requireSubject(index, placeId);
    return index.subjects
      .filter((subject) => subject.location.includes(placeId))
      .map((subject) => ({ id: subject.id, title: subject.title, kind: subject.kind, file: subject.file }));
  },

  where(index, id) {
    const subject = requireSubject(index, id);
    const byId = subjectMap(index);
    const places = [...new Set(subject.location)].filter((placeId) => byId.has(placeId));
    return places
      .sort(compareStrings)
      .map((placeId) => {
        const place = byId.get(placeId);
        return { id: place.id, title: place.title, file: place.file };
      });
  },

  related(index, id) {
    requireSubject(index, id);
    const byId = subjectMap(index);
    const describe = (other) => {
      const subject = byId.get(other);
      return subject
        ? { id: subject.id, title: subject.title, kind: subject.kind }
        : { id: other, title: null, kind: null };
    };
    return index.relations
      .filter((relation) => relation.from === id || relation.to === id)
      .sort((a, b) => compareStrings(a.from, b.from) || compareStrings(a.to, b.to) || compareStrings(a.type, b.type))
      .map((relation) => ({
        from: relation.from,
        to: relation.to,
        type: relation.type,
        other: describe(relation.from === id ? relation.to : relation.from),
      }));
  },

  timeline(index, ...bounds) {
    const from = bounds[0] === undefined ? -Infinity : parseBound(bounds[0], 'from');
    const to = bounds[1] === undefined ? Infinity : parseBound(bounds[1], 'to');
    const byId = subjectMap(index);
    return index.timeline
      .filter((entry) => entry.when >= from && entry.when <= to)
      .map((entry) => ({
        id: entry.id,
        title: byId.get(entry.id)?.title ?? null,
        when: entry.when,
        location: [...entry.location],
        participants: [...entry.participants],
      }))
      .sort((a, b) => a.when - b.when || compareStrings(a.id, b.id));
  },

  sketches(index) {
    return index.subjects
      .filter((subject) => subject.sketch)
      .map((subject) => ({ id: subject.id, title: subject.title, kind: subject.kind, file: subject.file }))
      .sort((a, b) => compareStrings(a.id, b.id));
  },

  errors(index) {
    return index.errors.map((err) => structuredClone(err));
  },
};

function subjectMap(index) {
  return new Map(index.subjects.map((subject) => [subject.id, subject]));
}

function requireSubject(index, id) {
  const subject = index.subjects.find((candidate) => candidate.id === id);
  if (subject === undefined) throw new QueryError(`unknown subject id "${id}"`);
  return subject;
}

function parseBound(text, label) {
  if (typeof text !== 'string' || !NUMBER_RE.test(text)) {
    throw new QueryError(`timeline ${label} must be a number, got "${text}"`);
  }
  return Number(text);
}
