// Offline tests of the plot case runner: the cases load, --setup-only works on each case, and the
// grader passes a hand-made correct graph and fails the traps. Never calls claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './lib/case-common.mjs';
import { gradePlot, loadPlotCase, setupPlotCopy, snapshotPlot, validatePlotKey } from './run-plot-case.mjs';
import { listVersions } from '../../yllir/scripts/lib/versions.mjs';

const CASES = path.join(REPO_ROOT, 'testbench', 'cases', 'plot');
const RUNNER = path.join(REPO_ROOT, 'testbench', 'runners', 'run-plot-case.mjs');
const NAMES = ['fork-rejoin', 'missions-next', 'seasons-next'];
const SESSION_DIR = 'Trama/Sessione 4';
const SESSION_ID = 'la-cenere-che-canta-04';

/** The six scenes of the fork-rejoin activity: node, file, title, body, dependencies (nodes), characters. */
const SCENES = [
  { node: 'guado', file: 'Il guado.md', title: 'Il guado del Lago Grigio', body: 'Il gruppo arriva al guado.', after: [] },
  { node: 'traghettatore', file: 'Il traghettatore.md', title: 'Il traghettatore', body: 'Il traghettatore chiede una moneta.', after: ['guado'] },
  { node: 'nuoto', file: 'Attraversare a nuoto.md', title: 'Attraversare a nuoto di notte', body: 'Il gruppo entra nell\'acqua fredda.', after: ['guado'] },
  {
    node: 'mulino',
    file: 'Il mulino.md',
    title: 'Il mulino abbandonato',
    body: 'Nel mulino Lino Valdes aspetta il gruppo.',
    after: ['traghettatore', 'nuoto'],
    characters: ['lino-valdes'],
  },
  { node: 'incendio', file: "L'incendio.md", title: "L'incendio al mulino", body: 'Il fuoco scoppia.', after: ['mulino'] },
  { node: 'araldo', file: "L'araldo.md", title: "L'araldo del borgo", body: 'Un araldo porta un messaggio.', after: [] },
];

const sceneId = (node) => `${SESSION_ID}-${node}`;

function openCopy(name) {
  const caseData = loadPlotCase(path.join(CASES, name));
  const setup = setupPlotCopy(caseData.fixtureDir);
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(setup.copy, rel)), { recursive: true });
    fs.writeFileSync(path.join(setup.copy, rel), text);
  };
  return {
    key: caseData.key,
    setup,
    write,
    snap: () => snapshotPlot(setup, null),
    close: () => fs.rmSync(setup.tmp, { recursive: true, force: true }),
  };
}

/**
 * Writes the fork-rejoin session by hand. overrides maps a node to the nodes it depends on
 * (an empty list means first); the default is the correct graph.
 */
function writeForkSession(copy, overrides = {}) {
  const defaults = Object.fromEntries(SCENES.map((s) => [s.node, s.after]));
  const deps = { ...defaults, ...overrides };
  const list = (items) => `[${items.join(', ')}]`;
  copy.write(
    `${SESSION_DIR}/Sessione 4.md`,
    `<!-- yllir\nid: ${SESSION_ID}\ndepends_on: [la-cenere-che-canta-03]\nprovenance: generated\n-->\n`,
  );
  for (const scene of SCENES) {
    const characters = scene.characters ?? [];
    copy.write(
      `${SESSION_DIR}/Eventi/${scene.file}`,
      `<!-- yllir\nid: ${sceneId(scene.node)}\nsession: ${SESSION_ID}\ndepends_on: ${list(deps[scene.node].map(sceneId))}\nlocation: []\ncharacters: ${list(characters)}\nprovenance: generated\n-->\n# ${scene.title}\n\n${scene.body}\n`,
    );
  }
}

test('every plot case loads, and validatePlotKey rejects a bad key', () => {
  for (const name of NAMES) {
    const data = loadPlotCase(path.join(CASES, name));
    assert.equal(data.runs, 3, `${name}: runs`);
    assert.deepEqual(data.limits, { max_minutes: 6, max_tool_calls: 140 });
  }
  assert.throws(() => validatePlotKey({ nodes: {} }), /activity_folder missing/);
  assert.throws(() => validatePlotKey({ activity_folder: 'Trama', expected_edges: [['a', 'b']] }), /not in nodes/);
  assert.throws(() => validatePlotKey({ activity_folder: 'Trama', nodes: { a: '(' } }), /not a valid regex/);
  assert.equal(validatePlotKey({ activity_folder: 'Trama' }).activity_folder, 'Trama');
});

test('--setup-only exits 0 on each case and leaves a copy with one saved version', () => {
  for (const name of NAMES) {
    const out = execFileSync(process.execPath, [RUNNER, path.join(CASES, name), '--setup-only'], { encoding: 'utf8' });
    const info = JSON.parse(out.trim().split('\n').pop());
    try {
      assert.equal(info.case.startsWith('plot-'), true, name);
      assert.equal(listVersions(info.copy, { limit: 500 }).length, 1, `${name}: one version`);
      assert.equal(info.versions, 1, `${name}: reported versions`);
    } finally {
      fs.rmSync(path.dirname(info.copy), { recursive: true, force: true });
    }
  }
});

test('fork-rejoin: the correct graph passes the graph checks, with no decoy edge', () => {
  const copy = openCopy('fork-rejoin');
  try {
    writeForkSession(copy);
    const snap = copy.snap();
    const result = gradePlot({ key: copy.key, baseline: copy.setup.state, snap });
    for (const id of ['K1', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8']) {
      assert.equal(result.checks[id], true, `${id}: ${result.details[id]}`);
    }
    assert.equal(result.new_activity.id, SESSION_ID);
    assert.deepEqual(result.metrics.edges_false, []);
    assert.deepEqual(result.metrics.edges_missing, []);
    assert.deepEqual(result.metrics.characters_drift.named_not_listed, []);
  } finally {
    copy.close();
  }
});

test('fork-rejoin: the adjacency decoy (nuoto after traghettatore) fails K5', () => {
  const copy = openCopy('fork-rejoin');
  try {
    writeForkSession(copy, { nuoto: ['traghettatore'] });
    const result = gradePlot({ key: copy.key, baseline: copy.setup.state, snap: copy.snap() });
    assert.equal(result.checks.K5, false);
    assert.match(result.details.K5, /nuoto must not depend on traghettatore/);
    assert.equal(result.checks.K4, false, 'the expected nuoto -> guado edge is then missing');
    assert.equal(result.metrics.edges_false.some(([a, b]) => a === 'nuoto' && b === 'traghettatore'), true);
  } finally {
    copy.close();
  }
});

test('fork-rejoin: araldo after incendio fails K5 and K6', () => {
  const copy = openCopy('fork-rejoin');
  try {
    writeForkSession(copy, { araldo: ['incendio'] });
    const result = gradePlot({ key: copy.key, baseline: copy.setup.state, snap: copy.snap() });
    assert.equal(result.checks.K5, false);
    assert.equal(result.checks.K6, false);
    assert.match(result.details.K6, /araldo depends on/);
  } finally {
    copy.close();
  }
});

test('fork-rejoin: a scene that names Lino Valdes without listing him is reported as drift', () => {
  const copy = openCopy('fork-rejoin');
  try {
    writeForkSession(copy);
    // Rewrite the mill scene: the body still names Lino, but characters is empty.
    copy.write(
      `${SESSION_DIR}/Eventi/Il mulino.md`,
      `<!-- yllir\nid: ${sceneId('mulino')}\nsession: ${SESSION_ID}\ndepends_on: [${sceneId('traghettatore')}, ${sceneId('nuoto')}]\nlocation: []\ncharacters: []\nprovenance: generated\n-->\n# Il mulino abbandonato\n\nNel mulino Lino Valdes aspetta il gruppo.\n`,
    );
    const result = gradePlot({ key: copy.key, baseline: copy.setup.state, snap: copy.snap() });
    assert.equal(result.checks.K3, true);
    assert.equal(
      result.metrics.characters_drift.named_not_listed.some((x) => x.id === 'lino-valdes' && x.scene === sceneId('mulino')),
      true,
      JSON.stringify(result.metrics.characters_drift),
    );
  } finally {
    copy.close();
  }
});

test('missions-next: the untouched copy has no new activity, no new error and no changed file', () => {
  const copy = openCopy('missions-next');
  try {
    const result = gradePlot({ key: copy.key, baseline: copy.setup.state, snap: copy.snap() });
    assert.equal(result.checks.K1, false);
    assert.match(result.details.K1, /found 0/);
    assert.equal(result.checks.K7, true, result.details.K7);
    assert.equal(result.checks.K8, true, result.details.K8);
    assert.equal(result.new_activity, null);
    assert.equal(result.metrics, null);
  } finally {
    copy.close();
  }
});

test('an agent failure fails every check with the agent reason', () => {
  const result = gradePlot({ key: { activity_folder: 'Trama' }, baseline: null, snap: null, agentError: 'turn 1: timeout' });
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, ['agent: turn 1: timeout']);
});
