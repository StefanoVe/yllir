// Context pack: what the main agent reads before writing about a set of
// subjects, a place or a session. It is derived from the world index and from
// a few documents read on demand. Deterministic: the same campaign and the
// same arguments always give the same JSON.

import fs from 'node:fs';
import path from 'node:path';
import { buildWorldIndex } from '../world-graph.mjs';
import { parseFrontmatter } from '../frontmatter.mjs';
import { parseYamlLite } from '../yaml-lite.mjs';
import { analyzeMarkdown } from '../zones.mjs';
import { compareStrings } from '../subjects.mjs';
import { findEconomyDocument } from '../economy/economy.mjs';

const SUMMARY_LIMIT = 300;
const MASTER_MARK = '<!-- master -->';
const OPEN_THREADS_HEADINGS = new Set(['Fili aperti', 'Open threads']);

/**
 * @param {string} root campaign folder (absolute)
 * @param {{ subjects?: string[], place?: string|null, session?: string|null, maxNeighbours?: number }} [options]
 * @returns {object} the context pack (JSON-safe)
 */
export function buildContext(root, { subjects = [], place = null, session = null, maxNeighbours = 30 } = {}) {
  const index = buildWorldIndex(root);
  const byId = new Map(index.subjects.map((subject) => [subject.id, subject]));
  const unknown = new Set();
  const focus = new Set();
  const textCache = new Map();

  // Requested or derived id: a subject goes to focus, anything else to unknown.
  const addFocus = (id) => {
    if (typeof id !== 'string' || id === '' || id === session) return;
    if (byId.has(id)) focus.add(id);
    else unknown.add(id);
  };

  for (const id of subjects) addFocus(id);

  if (place !== null) {
    addFocus(place);
    for (const subject of index.subjects) {
      if (subject.location.includes(place)) focus.add(subject.id);
    }
  }

  let sessionOut = null;
  if (session !== null) {
    const sessionDoc = byId.get(session);
    if (sessionDoc === undefined || sessionDoc.categoryType !== 'plot') {
      unknown.add(session);
    } else {
      const folder = path.posix.dirname(sessionDoc.file);
      const prefix = folder === '.' ? '' : `${folder}/`;
      const tree = index.subjects
        .filter((subject) => subject.categoryType === 'plot' && (subject.file === sessionDoc.file || subject.file.startsWith(prefix)))
        .sort((a, b) => compareStrings(a.file, b.file));
      for (const doc of tree) {
        for (const id of plotIds(readText(root, doc.file, textCache))) addFocus(id);
      }
      sessionOut = {
        id: session,
        file: sessionDoc.file,
        events: tree.filter((doc) => doc.file !== sessionDoc.file).map((doc) => doc.file),
      };
    }
  }

  const focusIds = [...focus];
  const focusSet = new Set(focusIds);
  const touchSet = new Set(focusIds);
  if (place !== null) touchSet.add(place);

  // Focus places: the requested place and the focus subjects that are places.
  const placeSet = new Set();
  if (place !== null) placeSet.add(place);
  for (const id of focusIds) {
    if (byId.get(id).kind === 'place') placeSet.add(id);
  }

  const timeline = index.timeline
    .filter((entry) => touchSet.has(entry.id) || entry.participants.some((id) => touchSet.has(id)) || entry.location.some((id) => touchSet.has(id)))
    .map((entry) => ({
      id: entry.id,
      title: titleOf(byId, entry.id),
      when: entry.when,
      location: [...entry.location],
      participants: [...entry.participants],
    }))
    .sort((a, b) => a.when - b.when || compareStrings(a.id, b.id));

  // Neighbours: relation partners, places of the focus, subjects at a focus place,
  // and the participants and places of the timeline events that touch the focus.
  const candidates = new Set();
  for (const relation of index.relations) {
    if (focusSet.has(relation.from)) candidates.add(relation.to);
    if (focusSet.has(relation.to)) candidates.add(relation.from);
  }
  for (const id of focusIds) {
    for (const placeId of byId.get(id).location) candidates.add(placeId);
  }
  for (const subject of index.subjects) {
    if (subject.location.some((placeId) => placeSet.has(placeId))) candidates.add(subject.id);
  }
  for (const entry of timeline) {
    for (const id of entry.participants) candidates.add(id);
    for (const id of entry.location) candidates.add(id);
  }

  const neighbourIds = [...candidates]
    .filter((id) => byId.has(id) && !focusSet.has(id) && id !== session)
    .sort(compareStrings);
  const limit = Math.max(0, maxNeighbours);
  const truncated = neighbourIds.length > limit;
  const keptNeighbours = neighbourIds.slice(0, limit);

  const focusCards = [...focusIds].sort(compareStrings).map((id) => cardOf(root, byId.get(id), index.relations, textCache));
  const neighbourCards = keptNeighbours.map((id) => cardOf(root, byId.get(id), index.relations, textCache));

  const sketches = [...focusCards, ...neighbourCards]
    .filter((card) => byId.get(card.id).sketch)
    .map((card) => ({ id: card.id, title: card.title, kind: card.kind, file: card.file }))
    .sort((a, b) => compareStrings(a.id, b.id));

  const errors = index.errors.filter((err) => Array.isArray(err.ids) && err.ids.some((id) => focusSet.has(id)));

  return {
    seed: readSeed(root),
    workNote: readOptional(path.join(root, '.campaign', 'state', 'work-note.md')),
    focus: focusCards,
    neighbours: neighbourCards,
    timeline,
    openThreads: openThreadsOf(root, index.subjects, textCache),
    sketches,
    unknown: [...unknown].sort(compareStrings),
    truncated,
    errors,
    session: sessionOut,
    economy: findEconomyDocument(root),
  };
}

/** Public summary of a document: first paragraph before the master block. */
export function summaryOf(text) {
  const { body } = parseFrontmatter(text);
  const paragraph = [];
  for (const raw of body.split(/\r?\n/)) {
    if (raw.trim() === MASTER_MARK) break;
    const line = raw.trim();
    const skip = line === '' || /^#{1,6}(\s|$)/.test(line) || line.startsWith('![');
    if (skip) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (line.startsWith('```')) break;
    paragraph.push(line);
  }
  const collapsed = paragraph.join(' ').replace(/\s+/g, ' ').trim();
  const chars = [...collapsed];
  if (chars.length <= SUMMARY_LIMIT) return collapsed;
  return `${chars.slice(0, SUMMARY_LIMIT - 1).join('')}…`;
}

function cardOf(root, subject, relations, textCache) {
  const outgoing = relations
    .filter((relation) => relation.from === subject.id)
    .sort((a, b) => compareStrings(a.to, b.to) || compareStrings(a.type, b.type))
    .map((relation) => ({ to: relation.to, type: relation.type }));
  const incoming = relations
    .filter((relation) => relation.to === subject.id)
    .sort((a, b) => compareStrings(a.from, b.from) || compareStrings(a.type, b.type))
    .map((relation) => ({ from: relation.from, type: relation.type }));
  return {
    id: subject.id,
    kind: subject.kind,
    title: subject.title,
    file: subject.file,
    provenance: subject.provenance,
    sketch: subject.sketch,
    status: subject.status,
    location: [...subject.location],
    relations: [...outgoing, ...incoming],
    summary: summaryOf(readText(root, subject.file, textCache) ?? ''),
  };
}

function openThreadsOf(root, subjects, textCache) {
  const chronicles = subjects
    .filter((subject) => subject.categoryType === 'chronicle')
    .sort((a, b) => compareStrings(a.file, b.file));
  const latest = chronicles.at(-1);
  if (latest === undefined) return [];

  const text = readText(root, latest.file, textCache);
  if (text === null) return [];
  const { body, bodyStartLine } = parseFrontmatter(text);
  const lines = analyzeMarkdown(body, bodyStartLine).lines;

  const items = [];
  let found = false;
  let level = null;
  for (const line of lines) {
    if (line.block === 'heading') {
      if (found && line.level <= level) break;
      if (!found && !line.inMaster && OPEN_THREADS_HEADINGS.has(line.headingText)) {
        found = true;
        level = line.level;
      }
      continue;
    }
    if (found && !line.inMaster && line.block === 'list' && /^[-*+]\s/.test(line.text.trim())) {
      items.push(line.text.trim().replace(/^[-*+]\s+/, '').trim());
    }
  }
  if (!found) return [];
  return [{ file: latest.file, items }];
}

/** Ids named by a plot document (its own frontmatter), in any order. */
function plotIds(text) {
  if (text === null) return [];
  const { data } = parseFrontmatter(text);
  if (data === null) return [];
  const ids = [];
  for (const key of ['characters', 'items', 'location']) ids.push(...listOf(data[key]));
  if (Array.isArray(data.appearances)) {
    for (const item of data.appearances) {
      if (item === null || typeof item !== 'object') continue;
      ids.push(...listOf(item.subject), ...listOf(item.location));
    }
  }
  return ids;
}

function listOf(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item !== '');
  if (typeof value === 'string' && value !== '') return [value];
  return [];
}

function readSeed(root) {
  const text = readOptional(path.join(root, 'campaign.yaml'));
  if (text === null) return null;
  const { data } = parseYamlLite(text);
  const seed = data?.campaign?.seed;
  if (typeof seed !== 'string' || seed.trim() === '') return null;

  const base = path.resolve(root);
  const absolute = path.resolve(base, seed);
  const relative = path.relative(base, absolute);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  const content = readOptional(absolute);
  if (content === null) return null;
  return { file: path.posix.normalize(seed.split(path.sep).join('/')), text: content };
}

function readText(root, file, textCache) {
  if (!textCache.has(file)) textCache.set(file, readOptional(path.join(root, file)));
  return textCache.get(file);
}

function readOptional(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function titleOf(byId, id) {
  return byId.get(id)?.title ?? null;
}
