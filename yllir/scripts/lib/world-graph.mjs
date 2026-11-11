// World graph of a campaign: the metadata of every document that describes the
// world (places, subjects, objects, free notes, plot and chronicle), read into
// one derived index, plus deterministic graph checks over it. No model is used.
// The index is written to .campaign/index/world.json and can always be rebuilt.

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { readStructure, listCanonicalSheets, compareStrings } from './subjects.mjs';
import { analyzeMarkdown } from './zones.mjs';

export const KINDS = ['place', 'character', 'creature', 'item', 'faction', 'event'];
export const PROVENANCES = ['master', 'played', 'generated'];
export const STATUSES = ['alive', 'dead', 'missing', 'active', 'destroyed', 'unknown'];
export const RELATION_TYPES = ['member-of', 'kin-of', 'ally-of', 'rival-of', 'depends-on'];

const INDEXED_TYPES = new Set(['places', 'subjects', 'objects', 'free', 'plot', 'chronicle']);
const KIND_REQUIRED_TYPES = new Set(['places', 'subjects', 'objects', 'free']);
const PROVENANCE_REQUIRED_TYPES = new Set(['places', 'subjects', 'objects', 'free', 'plot', 'chronicle']);
const END_STATUSES = new Set(['dead', 'destroyed']);
const RELATION_KEYS = new Set(['to', 'type']);
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

/**
 * Reads the metadata of every world document and derives the index.
 * @param {string} root campaign folder
 * @param {{ overlayFiles?: Array<{ path: string, content: string|null }> }} [options]
 *   overlay content replaces the file on disk (or adds a file not on disk);
 *   null content means the file is deleted.
 * @returns {{ subjects: object[], relations: object[], timeline: object[], errors: object[] }}
 */
export function buildWorldIndex(root, { overlayFiles = [] } = {}) {
  const { structure, errors: structureErrors } = readStructure(root);
  if (structure === null) {
    return {
      subjects: [],
      relations: [],
      timeline: [],
      errors: structureErrors.map((err) => ({ file: err.file, code: 'campaign-yaml', message: err.message })),
    };
  }

  const categories = categoriesOf(structure);
  const overlay = new Map(overlayFiles.map((item) => [normalizePath(item.path), item.content ?? null]));

  const files = new Set();
  for (const category of categories) {
    if (!INDEXED_TYPES.has(category.type)) continue;
    // Canonical paths: an internal symlink alias yields its original, once.
    for (const file of listCanonicalSheets(root, category.folder)) files.add(file);
  }
  for (const [file, content] of overlay) {
    if (content === null) files.delete(file);
    else files.add(file);
  }

  const subjects = [];
  const relations = [];
  const errors = [];
  const seenIds = new Map(); // id -> file of the first document with that id

  for (const file of [...files].sort(compareStrings)) {
    const category = findCategory(file, categories);
    if (category === null || !INDEXED_TYPES.has(category.type)) continue;

    let text;
    if (overlay.has(file)) {
      text = overlay.get(file);
    } else {
      try {
        text = fs.readFileSync(path.join(root, file), 'utf8');
      } catch {
        continue; // unreadable file: skipped silently
      }
    }

    const result = readDocument(file, text, category, seenIds, errors);
    if (result !== null) {
      subjects.push(result.subject);
      relations.push(...result.relations);
    }
  }

  subjects.sort((a, b) => compareStrings(a.id, b.id));
  relations.sort(compareRelations);

  const timeline = subjects
    .filter((subject) => subject.kind === 'event' && subject.when !== null)
    .map((subject) => ({ id: subject.id, when: subject.when, location: subject.location, participants: subject.participants }))
    .sort((a, b) => a.when - b.when || compareStrings(a.id, b.id));

  const index = { subjects, relations, timeline, errors: sortErrors(errors) };
  index.errors = sortErrors([...index.errors, ...checkWorldGraph(index)]);
  return index;
}

/**
 * Graph checks over a world index. Pure data, no file access.
 * @returns {Array<{ file: string, code: string, message: string, ids: string[] }>}
 */
export function checkWorldGraph(index) {
  const errors = [];
  const report = (file, code, message, ids) => errors.push({ file, code, message, ids });
  const byId = new Map(index.subjects.map((subject) => [subject.id, subject]));

  for (const subject of index.subjects) {
    for (const placeId of subject.location) {
      const target = byId.get(placeId);
      if (target === undefined) {
        report(subject.file, 'unknown-reference', `${subject.id} is located at unknown ${placeId}`, [subject.id, placeId]);
      } else if (target.kind !== null && target.kind !== 'place') {
        report(subject.file, 'location-not-place', `${subject.id} is located at ${placeId}, which is a ${target.kind}`, [subject.id, placeId]);
      }
    }
    for (const participantId of subject.participants) {
      if (!byId.has(participantId)) {
        report(subject.file, 'unknown-reference', `${subject.id} lists unknown participant ${participantId}`, [subject.id, participantId]);
      }
    }
  }

  for (const relation of index.relations) {
    if (!byId.has(relation.to)) {
      const from = byId.get(relation.from);
      report(from?.file ?? '', 'unknown-reference', `${relation.from} has a ${relation.type} relation to unknown ${relation.to}`, [relation.from, relation.to]);
    }
  }

  const events = index.subjects.filter((subject) => subject.kind === 'event' && subject.when !== null);

  for (const event of events) {
    for (const participantId of event.participants) {
      const participant = byId.get(participantId);
      if (participant && participant.ended !== null && event.when > participant.ended) {
        report(event.file, 'acts-after-end', `${event.id} at ${event.when} involves ${participantId}, who ended at ${participant.ended}`, [event.id, participantId]);
      }
    }
    for (const placeId of event.location) {
      const place = byId.get(placeId);
      if (place && place.ended !== null && place.ended < event.when) {
        report(event.file, 'acts-after-end', `${event.id} at ${event.when} takes place in ${placeId}, which ended at ${place.ended}`, [event.id, placeId]);
      }
    }
  }

  // Sorted by id, so for i < j the event located[i] has the smaller id.
  const located = events
    .filter((event) => event.location.length > 0)
    .sort((a, b) => compareStrings(a.id, b.id));
  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      const a = located[i];
      const b = located[j];
      if (a.when !== b.when) continue;
      if (a.location.some((placeId) => b.location.includes(placeId))) continue;
      const shared = a.participants.filter((participantId) => b.participants.includes(participantId));
      if (shared.length === 0) continue;
      report(a.file, 'two-places-at-once', `${a.id} and ${b.id} both happen at ${a.when} with ${shared.join(', ')} in different places`, [a.id, b.id, ...shared]);
    }
  }

  return sortErrors(errors);
}

/**
 * Writes the index to <root>/.campaign/index/world.json.
 * @returns {string} the absolute path of the written file
 */
export function writeWorldIndex(root, index) {
  const dir = path.join(root, '.campaign', 'index');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'world.json');
  const data = {
    subjects: index.subjects,
    relations: index.relations,
    timeline: index.timeline,
    errors: index.errors,
  };
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

/**
 * Reads one document. Returns null when the document is not a subject (no id,
 * or a duplicate id); field errors are added to `errors` and the subject is
 * still returned with null for each invalid value.
 */
function readDocument(file, text, category, seenIds, errors) {
  const report = (code, message) => errors.push({ file, code, message });
  const { data, body, bodyStartLine, errors: parseErrors } = parseFrontmatter(text);
  for (const err of parseErrors) {
    report('frontmatter', `line ${err.line}: ${err.message}`);
  }
  const fields = data ?? {};

  if (typeof fields.id !== 'string' || fields.id === '') {
    report('missing-id', 'document has no id');
    return null;
  }
  const id = fields.id;
  if (seenIds.has(id)) {
    report('duplicate-id', `duplicate id ${id} (also in ${seenIds.get(id)})`);
    return null;
  }
  seenIds.set(id, file);

  let kind = null;
  if (fields.kind === undefined) {
    if (KIND_REQUIRED_TYPES.has(category.type)) report('missing-kind', `kind is required in a ${category.type} category`);
  } else {
    kind = choice(fields.kind, KINDS);
    if (kind === null) report('bad-kind', `kind must be one of ${KINDS.join(', ')}`);
  }

  let provenance = null;
  if (fields.provenance === undefined) {
    if (PROVENANCE_REQUIRED_TYPES.has(category.type)) report('missing-provenance', `provenance is required in a ${category.type} category`);
  } else {
    provenance = choice(fields.provenance, PROVENANCES);
    if (provenance === null) report('bad-provenance', `provenance must be one of ${PROVENANCES.join(', ')}`);
  }

  let sketch = false;
  if (fields.sketch !== undefined) {
    if (fields.sketch === 'true') sketch = true;
    else report('bad-sketch', 'sketch must be true when present');
  }

  let status = null;
  if (fields.status !== undefined) {
    status = choice(fields.status, STATUSES);
    if (status === null) report('bad-status', `status must be one of ${STATUSES.join(', ')}`);
  }

  let ended = null;
  if (fields.ended !== undefined) {
    const value = parseNumber(fields.ended);
    if (value === null) {
      report('bad-ended', 'ended must be a number');
    } else if (status === null || !END_STATUSES.has(status)) {
      report('ended-without-end-status', 'ended is allowed only when status is dead or destroyed');
    } else {
      ended = value;
    }
  }

  let when = null;
  if (fields.when !== undefined) {
    const value = parseNumber(fields.when);
    if (value === null) {
      report('bad-when', 'when must be a number');
    } else if (kind !== 'event') {
      report('when-not-event', 'when is allowed only for kind event');
    } else {
      when = value;
    }
  } else if (kind === 'event') {
    report('missing-when', 'an event needs when');
  }

  const readList = (name) => {
    const value = fields[name];
    if (value === undefined) return [];
    if (Array.isArray(value)) return value.map(String);
    report('frontmatter', `${name} must be a flow list`);
    return [];
  };

  const location = readList('location');
  let participants = [];
  if (fields.participants !== undefined) {
    if (kind === 'event') participants = readList('participants');
    else report('participants-not-event', 'participants is allowed only for kind event');
  }
  const aliases = readList('aliases');

  if (kind === 'place' && category.type !== 'places') {
    report('place-outside-places', 'kind place is allowed only in a places category');
  }
  if (category.type === 'places' && kind !== null && kind !== 'place') {
    report('place-outside-places', `a document in a places category must be kind place, not ${kind}`);
  }

  const relations = [];
  if (fields.relations !== undefined) {
    if (!Array.isArray(fields.relations)) {
      report('bad-relation', 'relations must be a block list of to and type');
    } else {
      for (const item of fields.relations) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          report('bad-relation', 'each relation must be a mapping with to and type');
          continue;
        }
        const unknown = Object.keys(item).filter((key) => !RELATION_KEYS.has(key));
        if (unknown.length > 0) {
          report('bad-relation', `unknown relation key ${unknown.join(', ')}`);
          continue;
        }
        const to = scalarText(item.to);
        if (to === null || to === '') {
          report('bad-relation', 'each relation needs a to id');
          continue;
        }
        const type = choice(scalarText(item.type), RELATION_TYPES);
        if (type === null) {
          report('bad-relation-type', `relation type must be one of ${RELATION_TYPES.join(', ')}`);
          continue;
        }
        if (to === id) report('self-relation', `${id} has a relation to itself`);
        relations.push({ from: id, to, type });
      }
    }
  }

  const title = firstTitle(analyzeMarkdown(body, bodyStartLine).lines);

  return {
    subject: {
      id,
      kind,
      title,
      file,
      category: category.id,
      categoryType: category.type,
      provenance,
      sketch,
      status,
      ended,
      when,
      location,
      participants,
      aliases,
    },
    relations,
  };
}

/** Category list with the campaign-relative folder prefix of each one. */
function categoriesOf(structure) {
  return structure
    .filter((entry) => typeof entry.folder === 'string')
    .map((entry) => {
      const folder = path.posix.normalize(entry.folder).replace(/\/+$/, '');
      return {
        id: entry.id ?? null,
        type: entry.type ?? null,
        folder: entry.folder,
        prefix: folder === '.' || folder === '' ? '' : `${folder}/`,
      };
    });
}

/** The category whose folder is the longest prefix of the file, or null. */
function findCategory(file, categories) {
  let best = null;
  for (const category of categories) {
    if (file.startsWith(category.prefix) && (best === null || category.prefix.length > best.prefix.length)) {
      best = category;
    }
  }
  return best;
}

function normalizePath(file) {
  return path.posix.normalize(String(file).split(path.sep).join('/'));
}

/** The value when it is one of the allowed strings, else null. */
function choice(value, allowed) {
  return typeof value === 'string' && allowed.includes(value) ? value : null;
}

/** Number from a frontmatter value (strings matching the number form, or numbers). */
function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !NUMBER_RE.test(value)) return null;
  return Number(value);
}

/** Text of a scalar value (strings, and numbers written as ids), else null. */
function scalarText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Text of the first level-1 heading, or null when there is none (or it is empty). */
function firstTitle(lines) {
  for (const line of lines) {
    if (line.block === 'heading' && line.level === 1) {
      return line.headingText === '' ? null : (line.headingText ?? null);
    }
  }
  return null;
}

function compareRelations(a, b) {
  return compareStrings(a.from, b.from) || compareStrings(a.to, b.to) || compareStrings(a.type, b.type);
}

function sortErrors(errors) {
  return [...errors].sort(
    (a, b) => compareStrings(a.file, b.file) || compareStrings(a.code, b.code) || compareStrings(a.message, b.message),
  );
}
