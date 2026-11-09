// Plot map: reads the plot documents (categories of type `plot`) and the
// chronicle pages (categories of type `chronicle`), and derives for every
// session whether it is played, ready to be played, or waiting. A session lives
// in its own folder, `<Session>/<Session>.md`, and its events live in
// `<Session>/Eventi/` (or `<Session>/Events/`), one file per event. It also
// reports the errors of the plot graph. Deterministic: no clock, no randomness,
// code-unit sorting only.

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { readStructure, listSheets, compareStrings } from '../../../../../scripts/lib/subjects.mjs';

const EVENT_FOLDERS = new Set(['Eventi', 'Events']);

/**
 * @param {string} root absolute path to the campaign folder
 * @returns {{ sessions: object[], arcs: object[], errors: Array<{code: string, file: string, message: string}> }}
 */
export function plotMap(root) {
  const errors = [];
  const { structure, errors: configErrors } = readStructure(root);
  if (structure === null) {
    for (const e of configErrors) {
      errors.push({ code: 'campaign-config', file: e.file, message: e.message });
    }
    return { sessions: [], arcs: [], errors: sortErrors(errors) };
  }

  const categoriesOf = (type) =>
    structure.filter((c) => c.type === type && typeof c.folder === 'string');

  // 1. Plot files, classified by their place inside the category folder.
  const plotFiles = new Map(); // file -> 'session' | 'event' | 'legacy' (first category listing it wins)
  for (const category of categoriesOf('plot')) {
    const folder = path.posix.normalize(category.folder);
    for (const file of listSheets(root, category.folder)) {
      if (plotFiles.has(file)) continue;
      plotFiles.set(file, classifyPlotFile(path.posix.relative(folder, file)));
    }
  }
  const plotFilesSorted = [...plotFiles.keys()].sort(compareStrings);

  for (const file of plotFilesSorted) {
    if (plotFiles.get(file) === 'legacy') {
      errors.push({
        code: 'legacy-session-layout',
        file,
        message: 'session file is not in its own folder; run the update',
      });
    }
  }

  // 2. Sessions: main files, one per session folder, in file order.
  const sessions = []; // accepted session documents, in file order
  const sessionById = new Map();
  const sessionByDir = new Map(); // folder of a session -> session document
  for (const file of plotFilesSorted) {
    if (plotFiles.get(file) !== 'session') continue;
    const parsed = readDocument(root, file);
    if (parsed.errors.length > 0) {
      errors.push(invalidFrontmatter(file, parsed.errors[0]));
      continue;
    }
    const { data } = parsed;
    if (!data || typeof data.id !== 'string' || data.id === '') {
      errors.push({ code: 'missing-id', file, message: 'plot document has no id' });
      continue;
    }

    const dependsOn = readDependsOn(data, file, errors, 'missing-depends-on', 'invalid-depends-on');

    let arc = '';
    if (data.arc !== undefined) {
      if (typeof data.arc === 'string') {
        arc = data.arc;
      } else {
        errors.push({ code: 'invalid-arc', file, message: 'arc must be a string' });
      }
    }

    if (sessionById.has(data.id)) {
      errors.push({
        code: 'duplicate-id',
        file,
        message: `duplicate id ${data.id} (also in ${sessionById.get(data.id).file})`,
      });
      continue;
    }

    const doc = {
      id: data.id,
      file,
      arc,
      name: path.posix.basename(file, '.md'),
      depends_on: dependsOn,
      location: readLocation(data),
    };
    sessions.push(doc);
    sessionById.set(doc.id, doc);
    sessionByDir.set(path.posix.dirname(file), doc);
  }

  // 3. Events: one file each, in the Eventi/Events folder of their session.
  const events = []; // event documents with a valid, unique id, in file order
  const eventById = new Map();
  for (const file of plotFilesSorted) {
    if (plotFiles.get(file) !== 'event') continue;
    const parsed = readDocument(root, file);
    if (parsed.errors.length > 0) {
      errors.push(invalidFrontmatter(file, parsed.errors[0]));
      continue;
    }
    const { data } = parsed;
    if (!data || typeof data.id !== 'string' || data.id === '') {
      errors.push({ code: 'event-missing-id', file, message: 'event has no id' });
      continue;
    }
    if (eventById.has(data.id)) {
      errors.push({
        code: 'event-duplicate-id',
        file,
        message: `duplicate event id ${data.id} (also in ${eventById.get(data.id).file})`,
      });
      continue;
    }

    const dependsOn = readDependsOn(data, file, errors, 'event-missing-depends-on', 'event-invalid-depends-on');

    // The owning session is the one whose folder holds <Session>/<Folder>/<Event>.md.
    const owner = sessionByDir.get(path.posix.dirname(path.posix.dirname(file))) ?? null;
    let session = null; // null: the event is not listed under any session
    if (data.session === undefined || data.session === '') {
      errors.push({ code: 'event-missing-session', file, message: 'event has no session' });
    } else if (owner !== null && owner.id === data.session) {
      session = owner.id;
    } else {
      errors.push({
        code: 'event-session-mismatch',
        file,
        message: `session ${data.session} is not the session of this folder (${owner ? owner.id : 'no valid session file'})`,
      });
    }

    const doc = {
      id: data.id,
      file,
      name: path.posix.basename(file, '.md'),
      session,
      depends_on: dependsOn,
      location: readLocation(data),
    };
    events.push(doc);
    eventById.set(doc.id, doc);
  }

  // 4. Dependencies: unknown ones, then the graphs (cycles and topological order).
  for (const doc of sessions) {
    for (const dep of doc.depends_on) {
      if (!sessionById.has(dep)) {
        errors.push({
          code: 'unknown-dependency',
          file: doc.file,
          message: `depends on ${dep}, which is not a plot document`,
        });
      }
    }
  }
  for (const doc of events) {
    for (const dep of doc.depends_on) {
      if (!eventById.has(dep)) {
        errors.push({
          code: 'event-unknown-dependency',
          file: doc.file,
          message: `depends on ${dep}, which is not an event`,
        });
      }
    }
  }

  const edges = new Map(); // session id -> unique known dependency ids, in declared order
  for (const doc of sessions) {
    edges.set(doc.id, uniqueKnown(doc.depends_on, sessionById));
  }
  const eventEdges = new Map(); // event id -> unique known dependency ids, in declared order
  for (const doc of events) {
    eventEdges.set(doc.id, uniqueKnown(doc.depends_on, eventById));
  }

  errors.push(...cycleErrors(sessions, edges, 'cycle'));
  errors.push(...cycleErrors(events, eventEdges, 'event-cycle'));

  const topo = topologicalPositions(sessions, edges);
  const eventTopo = topologicalPositions(events, eventEdges);

  // 5. Played set, from the chronicle pages.
  const playedSet = new Set();
  const playedRefs = []; // { id, file } for every id listed in a chronicle page
  const chronicleFiles = new Map();
  for (const category of categoriesOf('chronicle')) {
    for (const file of listSheets(root, category.folder)) {
      chronicleFiles.set(file, true);
    }
  }
  for (const file of [...chronicleFiles.keys()].sort(compareStrings)) {
    const parsed = readDocument(root, file);
    if (parsed.errors.length > 0) {
      errors.push(invalidFrontmatter(file, parsed.errors[0]));
    }
    const { data } = parsed;
    if (!data || data.played === undefined) {
      errors.push({ code: 'missing-played', file, message: 'chronicle page has no played list' });
      continue;
    }
    if (!Array.isArray(data.played)) {
      errors.push({ code: 'invalid-played', file, message: 'played must be a list' });
      continue;
    }
    for (const id of data.played) {
      playedSet.add(id);
      playedRefs.push({ id, file });
    }
  }
  for (const ref of playedRefs) {
    if (!sessionById.has(ref.id)) {
      errors.push({
        code: 'unknown-played-id',
        file: ref.file,
        message: `played id ${ref.id} is not a plot document`,
      });
    }
  }

  // 6. Status, and played-before-prerequisite.
  for (const doc of sessions) {
    if (!playedSet.has(doc.id)) continue;
    const unplayed = doc.depends_on.filter((dep) => !playedSet.has(dep));
    if (unplayed.length > 0) {
      errors.push({
        code: 'played-before-prerequisite',
        file: doc.file,
        message: `played, but not all prerequisites are played: ${unplayed.join(', ')}`,
      });
    }
  }

  // Events of each session, in topological order (events of unknown sessions are not listed).
  const eventsBySession = new Map();
  const listedEvents = events
    .filter((e) => e.session !== null)
    .sort((a, b) => eventTopo.get(a.id) - eventTopo.get(b.id) || compareStrings(a.file, b.file));
  for (const e of listedEvents) {
    if (!eventsBySession.has(e.session)) eventsBySession.set(e.session, []);
    eventsBySession.get(e.session).push({
      id: e.id,
      file: e.file,
      name: e.name,
      depends_on: e.depends_on.slice(),
      location: e.location.slice(),
    });
  }

  const result = sessions.map((doc) => {
    const played = playedSet.has(doc.id);
    const ready = !played && doc.depends_on.every((dep) => playedSet.has(dep));
    return {
      id: doc.id,
      file: doc.file,
      arc: doc.arc,
      name: doc.name,
      depends_on: doc.depends_on.slice(),
      location: doc.location.slice(),
      played,
      ready,
      events: eventsBySession.get(doc.id) ?? [],
    };
  });
  result.sort(
    (a, b) =>
      compareStrings(a.arc, b.arc) ||
      topo.get(a.id) - topo.get(b.id) ||
      compareStrings(a.file, b.file),
  );

  // 7. Arcs: sessions in topological order, and the number of the next session.
  const arcNames = [...new Set(result.map((s) => s.arc))].sort(compareStrings);
  const arcs = arcNames.map((arc) => {
    const inArc = result.filter((s) => s.arc === arc);
    let largest = 0;
    for (const s of inArc) {
      const match = /(\d+)$/.exec(s.name);
      if (match) largest = Math.max(largest, Number(match[1]));
    }
    return {
      arc,
      sessions: inArc.slice().sort((a, b) => topo.get(a.id) - topo.get(b.id) || compareStrings(a.file, b.file)).map((s) => s.id),
      next_number: largest === 0 ? 1 : largest + 1,
    };
  });

  return { sessions: result, arcs, errors: sortErrors(errors) };
}

/** Kind of a plot file from its path relative to the category folder. */
function classifyPlotFile(rel) {
  const parts = rel.split('/');
  if (parts.length === 2 && parts[1] === `${parts[0]}.md`) return 'session';
  if (parts.length === 3 && EVENT_FOLDERS.has(parts[1])) return 'event';
  return 'legacy';
}

/** Reads depends_on of a document; a missing or non-list value counts as no prerequisites. */
function readDependsOn(data, file, errors, missingCode, invalidCode) {
  if (data.depends_on === undefined) {
    errors.push({ code: missingCode, file, message: 'depends_on is missing' });
    return [];
  }
  if (!Array.isArray(data.depends_on)) {
    errors.push({ code: invalidCode, file, message: 'depends_on must be a list' });
    return [];
  }
  return data.depends_on.slice();
}

function readLocation(data) {
  return Array.isArray(data.location) ? data.location.slice() : [];
}

/** Parses the frontmatter of a file under the campaign root. */
function readDocument(root, file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  return parseFrontmatter(text);
}

function invalidFrontmatter(file, error) {
  return { code: 'invalid-frontmatter', file, message: `line ${error.line}: ${error.message}` };
}

function sortErrors(errors) {
  return errors.sort(
    (a, b) =>
      compareStrings(a.code, b.code) ||
      compareStrings(a.file, b.file) ||
      compareStrings(a.message, b.message),
  );
}

/** Unique dependency ids that name a known item (a key of byId), in declared order. */
function uniqueKnown(dependsOn, byId) {
  const out = [];
  for (const dep of dependsOn) {
    if (byId.has(dep) && !out.includes(dep)) out.push(dep);
  }
  return out;
}

/**
 * One cycle error per cycle of the graph, at the member with the lowest file.
 * @param {Array<{id: string, file: string}>} items the graph nodes
 * @param {Map<string, string[]>} edges id -> dependency ids
 * @param {string} code error code to report with
 */
function cycleErrors(items, edges, code) {
  const fileOf = new Map(items.map((item) => [item.id, item.file]));
  const out = [];
  for (const component of stronglyConnected(items.map((item) => item.id), edges)) {
    const isCycle =
      component.length > 1 || (component.length === 1 && edges.get(component[0]).includes(component[0]));
    if (!isCycle) continue;
    const members = component.slice().sort(compareStrings);
    const first = members.reduce((a, b) => (compareStrings(fileOf.get(a), fileOf.get(b)) <= 0 ? a : b));
    out.push({
      code,
      file: fileOf.get(first),
      message: `dependency cycle among ${members.join(', ')}`,
    });
  }
  return out;
}

/**
 * Strongly connected components (Tarjan), each as a list of ids.
 * Iterative over the order of `ids`, so the result depends only on the input order.
 */
function stronglyConnected(ids, edges) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];

  const visit = (v) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v)) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      components.push(component);
    }
  };

  for (const id of ids) {
    if (!index.has(id)) visit(id);
  }
  return components;
}

/**
 * Position of each id in a topological order of the dependency graph. Among the
 * ids that are ready at the same time, the one with the lower file name comes
 * first. Ids that cannot be ordered (cycles and what depends on them) come last,
 * in file order.
 * @param {Array<{id: string, file: string}>} items the graph nodes
 * @param {Map<string, string[]>} edges id -> dependency ids
 * @returns {Map<string, number>}
 */
function topologicalPositions(items, edges) {
  const itemsByFile = items.slice().sort((a, b) => compareStrings(a.file, b.file));
  const pending = new Map(); // id -> number of unordered dependencies
  const dependents = new Map(); // id -> ids that depend on it
  for (const item of items) {
    pending.set(item.id, edges.get(item.id).length);
    dependents.set(item.id, []);
  }
  for (const item of items) {
    for (const dep of edges.get(item.id)) {
      dependents.get(dep).push(item.id);
    }
  }

  const positions = new Map();
  let next = 0;
  for (;;) {
    const ready = itemsByFile.find((d) => !positions.has(d.id) && pending.get(d.id) === 0);
    if (!ready) break;
    positions.set(ready.id, next++);
    for (const dependent of dependents.get(ready.id)) {
      pending.set(dependent, pending.get(dependent) - 1);
    }
  }
  for (const item of itemsByFile) {
    if (!positions.has(item.id)) positions.set(item.id, next++);
  }
  return positions;
}
