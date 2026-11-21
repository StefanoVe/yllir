// Plot structures beyond the session-based campaign: a mission campaign (plot-missions)
// and a seasons campaign with chapters inside season folders (plot-seasons). The engine's
// plotMap runs on a temporary copy of each campaign; the fixtures are never written.
// Expected values come from key.yaml, which sits outside campaign/.
//
// Where the engine behaves differently from what the fixture intends, the assertion
// records what the engine does today and a `// FINDING:` comment says why. Those tests
// pass on purpose: they document the gap, they do not hide it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plotMap } from '../../yllir/scripts/lib/plot/plot-map.mjs';
import { parseYamlLite } from '../../yllir/scripts/lib/yaml-lite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '..', 'fixtures');

function loadKey(name) {
  const { data, errors } = parseYamlLite(fs.readFileSync(path.join(FIXTURES, name, 'key.yaml'), 'utf8'));
  assert.deepEqual(errors, []);
  return data;
}

/** A temporary copy of the campaign of a fixture; the fixture itself is never written. */
function copyCampaign(t, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `yllir-${name}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(FIXTURES, name, 'campaign'), root, { recursive: true });
  return root;
}

/** Moves Stagioni/Stagione N/Capitolo N to Stagioni/Capitolo N: the flat shape the engine reads. */
function flattenSeasons(root) {
  const stagioni = path.join(root, 'Stagioni');
  for (const season of fs.readdirSync(stagioni)) {
    const seasonDir = path.join(stagioni, season);
    for (const chapter of fs.readdirSync(seasonDir)) {
      fs.renameSync(path.join(seasonDir, chapter), path.join(stagioni, chapter));
    }
    fs.rmdirSync(seasonDir);
  }
  return root;
}

/** The key lists statuses as a list of { id, status }; the engine view is an object. */
function statusMap(list) {
  return Object.fromEntries(list.map((s) => [s.id, s.status]));
}

function statuses(result) {
  return Object.fromEntries(
    result.sessions.map((s) => [s.id, s.played ? 'played' : s.ready ? 'ready' : 'waiting']),
  );
}

/** Engine errors as `code file` strings, sorted, so the order of the report does not matter. */
function signatures(errors) {
  return errors.map((e) => `${e.code} ${e.file}`).sort();
}

function keySignatures(list) {
  return list.map((e) => `${e.code} ${e.file}`).sort();
}

/**
 * Each expected error with ids must be reported at its file, and its message must name those ids.
 * Several errors can share code and file (two unknown played ids in one chronicle page), so the
 * match is by the ids named in the message.
 */
function assertIdsNamed(errors, expected) {
  for (const exp of expected) {
    if (!exp.ids) continue;
    const candidates = errors.filter((e) => e.code === exp.code && e.file === exp.file);
    assert.ok(candidates.length > 0, `no ${exp.code} at ${exp.file}`);
    assert.ok(
      candidates.some((e) => exp.ids.every((id) => e.message.includes(id))),
      `no ${exp.code} at ${exp.file} names ${exp.ids.join(', ')}`,
    );
  }
}

// ---------------------------------------------------------------- plot-missions

test('plot-missions: the key lives outside the campaign folder', () => {
  assert.equal(fs.existsSync(path.join(FIXTURES, 'plot-missions', 'campaign', 'key.yaml')), false);
});

test('plot-missions: engine errors are the cycle, the missing field and the unknown prerequisite', (t) => {
  const key = loadKey('plot-missions');
  const result = plotMap(copyCampaign(t, 'plot-missions'));
  assert.deepEqual(signatures(result.errors), keySignatures(key.errors));
  assertIdsNamed(result.errors, key.errors);
});

test('plot-missions: statuses after the chronicle, and the unlinked missions', (t) => {
  const key = loadKey('plot-missions');
  const result = plotMap(copyCampaign(t, 'plot-missions'));
  assert.deepEqual(statuses(result), statusMap(key.statuses));
  assert.deepEqual(result.unlinked, key.unlinked);
  // FINDING: a mission with no depends_on field is reported as missing-depends-on (an error,
  // not a silent default). In the graph it counts as [] and is ready, like an explicit empty list.
  const noField = result.sessions.find((s) => s.id === key.no_depends_on_field[0]);
  assert.deepEqual(noField.depends_on, []);
  assert.equal(noField.ready, true);
  const explicitEmpty = result.sessions.find((s) => s.id === key.explicit_empty_depends_on[0]);
  assert.deepEqual(explicitEmpty.depends_on, []);
  assert.equal(explicitEmpty.played, true);
});

test('plot-missions: the fork and the rejoin of Missione 1 are kept as declared', (t) => {
  const key = loadKey('plot-missions');
  const result = plotMap(copyCampaign(t, 'plot-missions'));
  const m1 = result.sessions.find((s) => s.id === 'missione-1');
  const edges = Object.fromEntries(m1.events.map((e) => [e.id, e.depends_on]));
  assert.deepEqual(edges, Object.fromEntries(key.fork_rejoin.map((e) => [e.event, e.depends_on])));
  assert.deepEqual(
    m1.events.map((e) => e.id),
    key.event_order_missione_1,
  );
});

test('plot-missions: unknown prerequisite is dropped from the arc order, so Missione 3 sorts as free', (t) => {
  const result = plotMap(copyCampaign(t, 'plot-missions'));
  // FINDING: the graph uses only known dependencies (uniqueKnown), so missione-3, which is
  // waiting on missione-9, is placed in the arc order as if it had no prerequisite. Its status
  // is still waiting. The unknown-dependency error is the only sign of the gap.
  assert.deepEqual(result.arcs[0].sessions, ['missione-1', 'missione-2', 'missione-3', 'missione-4', 'missione-5']);
  assert.equal(result.sessions.find((s) => s.id === 'missione-3').ready, false);
});

// ---------------------------------------------------------------- plot-seasons

test('plot-seasons: the hierarchical shape is not read; the engine reports only legacy files and played ids', (t) => {
  const key = loadKey('plot-seasons');
  const result = plotMap(copyCampaign(t, 'plot-seasons'));
  // FINDING: the engine accepts a session only at <Folder>/<Folder>.md and an event only at
  // <Folder>/<Events folder>/<file>.md. Chapters at Stagioni/Stagione N/Capitolo N/... are
  // classified as legacy, so no session exists, no arc exists and the chronicle ids are unknown.
  assert.equal(result.sessions.length, key.engine_hierarchical.sessions);
  assert.equal(result.arcs.length, key.engine_hierarchical.arcs);
  assert.deepEqual(result.unlinked, []);
  assert.deepEqual(signatures(result.errors), keySignatures(key.engine_hierarchical.errors));
  assertIdsNamed(result.errors, key.engine_hierarchical.errors);
});

test('plot-seasons: flattened to the shape the engine reads, the seeded traps are reported', (t) => {
  const key = loadKey('plot-seasons');
  const flat = flattenSeasons(copyCampaign(t, 'plot-seasons'));
  const result = plotMap(flat);
  const intended = key.intended_flat;

  assert.deepEqual(signatures(result.errors), keySignatures(intended.errors));
  assertIdsNamed(result.errors, intended.errors);
  assert.deepEqual(statuses(result), statusMap(intended.statuses));

  // Chapter 3 is the rejoin across the seasons: it depends on chapters 1 and 2.
  const c3 = result.sessions.find((s) => s.id === 'brenna-capitolo-3');
  assert.deepEqual(c3.depends_on, intended.rejoin);

  assert.deepEqual(result.arcs[0].sessions, intended.arc_order);
  assert.equal(result.arcs[0].next_number, intended.next_number);

  // FINDING: a cycle between two scenes counts as a link for the unlinked check (any event that
  // depends on another event of the same session), so a chapter whose scenes only depend on each
  // other in a loop is not reported as unlinked. The event-cycle error is the only report.
  assert.deepEqual(result.unlinked, intended.unlinked);
});
