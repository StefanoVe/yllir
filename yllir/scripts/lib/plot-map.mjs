// Plot map: reads the plot documents (categories of type `plot`) and the
// chronicle pages (categories of type `chronicle`), and derives for every
// session whether it is played, ready to be played, or waiting. It also
// reports the errors of the plot graph. Deterministic: no clock, no randomness,
// code-unit sorting only.

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { readStructure, listSheets, compareStrings } from './subjects.mjs';

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

  // 1. Plot documents, one per file, arc relative to the category folder.
  const plotFiles = new Map(); // file -> arc (first category listing it wins)
  for (const category of categoriesOf('plot')) {
    const folder = path.posix.normalize(category.folder);
    for (const file of listSheets(root, category.folder)) {
      if (plotFiles.has(file)) continue;
      const rel = path.posix.relative(folder, file);
      const dir = path.posix.dirname(rel);
      plotFiles.set(file, dir === '.' ? '' : dir);
    }
  }

  const docs = []; // accepted plot documents, in file order
  const docById = new Map();
  for (const file of [...plotFiles.keys()].sort(compareStrings)) {
    const arc = plotFiles.get(file);
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

    let dependsOn = [];
    if (data.depends_on === undefined) {
      errors.push({ code: 'missing-depends-on', file, message: 'depends_on is missing' });
    } else if (!Array.isArray(data.depends_on)) {
      errors.push({ code: 'invalid-depends-on', file, message: 'depends_on must be a list' });
    } else {
      dependsOn = data.depends_on.slice();
    }

    if (docById.has(data.id)) {
      errors.push({
        code: 'duplicate-id',
        file,
        message: `duplicate id ${data.id} (also in ${docById.get(data.id).file})`,
      });
      continue;
    }

    const doc = {
      id: data.id,
      file,
      arc,
      name: path.posix.basename(file, '.md'),
      depends_on: dependsOn,
      location: Array.isArray(data.location) ? data.location.slice() : [],
    };
    docs.push(doc);
    docById.set(doc.id, doc);
  }

  // 2. Played set, from the chronicle pages.
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
    if (!docById.has(ref.id)) {
      errors.push({
        code: 'unknown-played-id',
        file: ref.file,
        message: `played id ${ref.id} is not a plot document`,
      });
    }
  }

  // 3. Dependencies: unknown ones, then the graph (cycles and topological order).
  for (const doc of docs) {
    for (const dep of doc.depends_on) {
      if (!docById.has(dep)) {
        errors.push({
          code: 'unknown-dependency',
          file: doc.file,
          message: `depends on ${dep}, which is not a plot document`,
        });
      }
    }
  }

  const edges = new Map(); // id -> unique known dependency ids, in declared order
  for (const doc of docs) {
    edges.set(doc.id, uniqueKnown(doc.depends_on, docById));
  }

  for (const component of stronglyConnected(docs.map((d) => d.id), edges)) {
    const isCycle =
      component.length > 1 || (component.length === 1 && edges.get(component[0]).includes(component[0]));
    if (!isCycle) continue;
    const members = component.slice().sort(compareStrings);
    const first = members.reduce((a, b) => (compareStrings(docById.get(a).file, docById.get(b).file) <= 0 ? a : b));
    errors.push({
      code: 'cycle',
      file: docById.get(first).file,
      message: `dependency cycle among ${members.join(', ')}`,
    });
  }

  const topo = topologicalPositions(docs, edges);

  // 4. Status, and played-before-prerequisite.
  for (const doc of docs) {
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

  const sessions = docs.map((doc) => {
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
    };
  });
  sessions.sort(
    (a, b) =>
      compareStrings(a.arc, b.arc) ||
      topo.get(a.id) - topo.get(b.id) ||
      compareStrings(a.file, b.file),
  );

  // 5. Arcs: sessions in topological order, and the number of the next session.
  const arcNames = [...new Set(sessions.map((s) => s.arc))].sort(compareStrings);
  const arcs = arcNames.map((arc) => {
    const inArc = sessions.filter((s) => s.arc === arc);
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

  return { sessions, arcs, errors: sortErrors(errors) };
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

/** Unique dependency ids that name a plot document, in declared order. */
function uniqueKnown(dependsOn, docById) {
  const out = [];
  for (const dep of dependsOn) {
    if (docById.has(dep) && !out.includes(dep)) out.push(dep);
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
 * @returns {Map<string, number>}
 */
function topologicalPositions(docs, edges) {
  const docsByFile = docs.slice().sort((a, b) => compareStrings(a.file, b.file));
  const pending = new Map(); // id -> number of unordered dependencies
  const dependents = new Map(); // id -> ids that depend on it
  for (const doc of docs) {
    pending.set(doc.id, edges.get(doc.id).length);
    dependents.set(doc.id, []);
  }
  for (const doc of docs) {
    for (const dep of edges.get(doc.id)) {
      dependents.get(dep).push(doc.id);
    }
  }

  const positions = new Map();
  let next = 0;
  for (;;) {
    const ready = docsByFile.find((d) => !positions.has(d.id) && pending.get(d.id) === 0);
    if (!ready) break;
    positions.set(ready.id, next++);
    for (const dependent of dependents.get(ready.id)) {
      pending.set(dependent, pending.get(dependent) - 1);
    }
  }
  for (const doc of docsByFile) {
    if (!positions.has(doc.id)) positions.set(doc.id, next++);
  }
  return positions;
}
