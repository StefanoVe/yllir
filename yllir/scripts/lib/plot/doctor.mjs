// Campaign doctor, the two read-only checks of the plot and the cast:
// - unreachableNodes: plot sessions and events that can never become ready
//   (a missing dependency, a dependency cycle, or a dependency on such a node);
// - forgottenCharacters: character subjects that no plot or chronicle document
//   mentions (metadata characters/participants/enemies, or a link to the sheet).
// Both are read-only and never throw on a malformed campaign: they return what
// they can. Deterministic: code-unit sorting only.

import fs from 'node:fs';
import path from 'node:path';
import { plotMap } from './plot-map.mjs';
import { buildWorldIndex } from '../world-graph.mjs';
import { readStructure, listCanonicalSheets, canonicalInternalPath, compareStrings } from '../subjects.mjs';
import { parseFrontmatter } from '../frontmatter.mjs';
import { analyzeMarkdown } from '../zones.mjs';

// Templates of character sheets (in addition to kind: character).
const CHARACTER_TEMPLATES = new Set(['npc', 'vendor', 'enemy', 'creature']);
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Plot nodes that can never become ready. A played node is never listed.
 * An event is played when its session is played.
 * @param {string} root absolute path to the campaign folder
 * @returns {Array<{ id: string, file: string, kind: 'session'|'event', reason: 'missing-dependency'|'cycle'|'depends-on-unreachable', via: string[] }>}
 */
export function unreachableNodes(root) {
  let map;
  try {
    map = plotMap(root);
  } catch {
    return [];
  }
  const sessions = Array.isArray(map?.sessions) ? map.sessions : [];

  const sessionNodes = [];
  const eventNodes = [];
  for (const s of sessions) {
    sessionNodes.push({ id: String(s.id), file: s.file, deps: s.depends_on, played: s.played === true });
    for (const e of Array.isArray(s.events) ? s.events : []) {
      eventNodes.push({ id: String(e.id), file: e.file, deps: e.depends_on, played: s.played === true });
    }
  }

  const out = [
    ...unreachableIn(sessionNodes).map((r) => ({ ...r, kind: 'session' })),
    ...unreachableIn(eventNodes).map((r) => ({ ...r, kind: 'event' })),
  ];
  return out.sort((a, b) => compareStrings(a.id, b.id) || compareStrings(a.kind, b.kind));
}

/**
 * Unreachable nodes of one kind of graph (sessions or events).
 * @param {Array<{id: string, file: string, deps: unknown, played: boolean}>} nodes
 * @returns {Array<{ id: string, file: string, reason: string, via: string[] }>}
 */
function unreachableIn(nodes) {
  const byId = new Map();
  for (const n of nodes) {
    if (!byId.has(n.id)) byId.set(n.id, { ...n, deps: uniqueDeps(n.deps) });
  }

  // Edges to known nodes only; missing ids are reported on their own.
  const knownDeps = (id) => byId.get(id).deps.filter((d) => byId.has(d));
  const missingDeps = (id) => byId.get(id).deps.filter((d) => !byId.has(d)).sort(compareStrings);

  // Reachability over one or more edges, for every node.
  const reach = new Map();
  for (const id of byId.keys()) {
    const seen = new Set();
    const stack = [...knownDeps(id)];
    while (stack.length > 0) {
      const x = stack.pop();
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...knownDeps(x));
    }
    reach.set(id, seen);
  }

  // A node is on a cycle when it reaches itself; its cycle is the mutual reach.
  const cycleOf = new Map();
  for (const id of byId.keys()) {
    if (!reach.get(id).has(id)) continue;
    const members = new Set([id]);
    for (const m of reach.get(id)) {
      if (reach.get(m).has(id)) members.add(m);
    }
    cycleOf.set(id, [...members].sort(compareStrings));
  }

  const unreachable = new Map(); // id -> { reason, via }
  for (const node of byId.values()) {
    if (node.played) continue;
    const missing = missingDeps(node.id);
    if (missing.length > 0) {
      unreachable.set(node.id, { reason: 'missing-dependency', via: missing });
    } else if (cycleOf.has(node.id)) {
      unreachable.set(node.id, { reason: 'cycle', via: cycleOf.get(node.id) });
    }
  }

  // Fixed point: whatever depends directly on an unreachable node is unreachable too.
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of byId.values()) {
      if (node.played || unreachable.has(node.id)) continue;
      const via = node.deps.filter((d) => unreachable.has(d)).sort(compareStrings);
      if (via.length > 0) {
        unreachable.set(node.id, { reason: 'depends-on-unreachable', via });
        changed = true;
      }
    }
  }

  return [...unreachable.keys()].sort(compareStrings).map((id) => ({
    id,
    file: byId.get(id).file,
    ...unreachable.get(id),
  }));
}

/**
 * Character subjects that no plot or chronicle document refers to.
 * A character is a subject with kind character, or with a character template
 * (npc, vendor, enemy, creature) in its metadata. A reference is an id in
 * `characters`, `participants` or `enemies` of a plot or chronicle file, or a
 * Markdown link in such a file whose target is the character's sheet.
 * @param {string} root absolute path to the campaign folder
 * @returns {Array<{ id: string, title: string|null, file: string, sketch: boolean }>}
 */
export function forgottenCharacters(root) {
  let index;
  try {
    index = buildWorldIndex(root);
  } catch {
    return [];
  }
  const subjects = Array.isArray(index?.subjects) ? index.subjects : [];

  const referencedIds = new Set();
  const linkedFiles = new Set();
  const { structure } = readStructure(root);
  for (const category of Array.isArray(structure) ? structure : []) {
    if (category.type !== 'plot' && category.type !== 'chronicle') continue;
    if (typeof category.folder !== 'string') continue;
    for (const file of safeSheets(root, category.folder)) {
      collectReferences(root, file, referencedIds, linkedFiles);
    }
  }

  const out = [];
  for (const subject of subjects) {
    if (!isCharacter(root, subject)) continue;
    const sheet = canonicalInternalPath(root, subject.file);
    if (referencedIds.has(subject.id) || linkedFiles.has(sheet)) continue;
    out.push({
      id: subject.id,
      title: subject.title ?? null,
      file: subject.file,
      sketch: subject.sketch === true,
    });
  }
  return out.sort((a, b) => compareStrings(a.id, b.id));
}

/** True for kind character, or for a character template in the metadata of the sheet. */
function isCharacter(root, subject) {
  if (subject.kind === 'character') return true;
  const text = readText(root, subject.file);
  if (text === null) return false;
  const { data } = parseFrontmatter(text);
  return data !== null && typeof data === 'object' && CHARACTER_TEMPLATES.has(data.template);
}

/** Adds the ids and the linked sheets of one plot or chronicle file. */
function collectReferences(root, file, ids, linked) {
  const text = readText(root, file);
  if (text === null) return;
  const parsed = parseFrontmatter(text);
  const data = parsed.data !== null && typeof parsed.data === 'object' ? parsed.data : {};

  for (const key of ['characters', 'participants']) {
    if (Array.isArray(data[key])) {
      for (const value of data[key]) if (value !== null && value !== undefined) ids.add(String(value));
    }
  }
  for (const id of Array.isArray(data.enemies) ? data.enemies.map((e) => e?.id) : []) {
    if (id !== null && id !== undefined) ids.add(String(id));
  }

  const zones = analyzeMarkdown(parsed.body ?? '', parsed.bodyStartLine ?? 1);
  for (const line of zones.lines) {
    for (const span of Array.isArray(line.spans) ? line.spans : []) {
      if (span.kind !== 'link' || typeof span.target !== 'string') continue;
      const target = linkedSheet(root, file, span.target);
      if (target !== null) linked.add(target);
    }
  }
}

/** Campaign-relative path a link target points to, or null when it is not a campaign file. */
function linkedSheet(root, file, target) {
  if (SCHEME.test(target) || target.startsWith('/')) return null;
  const hash = target.indexOf('#');
  const rawPath = hash < 0 ? target : target.slice(0, hash);
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded === '') return null;
  const rel = path.posix.normalize(path.posix.join(path.posix.dirname(file), decoded));
  if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return null;
  return canonicalInternalPath(root, rel);
}

/** Canonical sheets of a folder; an unreadable folder gives []. */
function safeSheets(root, folder) {
  try {
    return listCanonicalSheets(root, folder);
  } catch {
    return [];
  }
}

/** Text of a campaign file, or null when it cannot be read. */
function readText(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

/** Unique dependency ids as strings, in declared order. */
function uniqueDeps(deps) {
  if (!Array.isArray(deps)) return [];
  return [...new Set(deps.filter((d) => d !== null && d !== undefined).map(String))];
}
