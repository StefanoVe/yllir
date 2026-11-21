#!/usr/bin/env node
// Runs one plot case end to end: copies the case's fixture into a temporary git repository, saves a
// baseline version, runs ONE turn of the agent with `claude -p` (a "prepare the next session or
// mission" request) and grades the plot graph the agent left against the case's key. Every check is
// deterministic: no model grades. The key is read from cases/plot/<name>/key.yaml and is never copied
// into the copy the agent works on. One JSON line per run is appended to testbench/results/<case>.jsonl.
//
// Usage: node testbench/runners/run-plot-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep] [--setup-only]
//        node testbench/runners/run-plot-case.mjs <caseDir> --grade-only <dir> --run-json <file>
// --setup-only copies the fixture, saves the baseline, prints one JSON line with the copy's path and
// keeps the copy. It calls no model. --keep keeps the copy and saves the state of the run as
// <tmp>/run.json. --grade-only grades a saved run.json again without running the agent and does not
// append to the results file.
// Checks: K1 one new activity under activity_folder with a depends_on field; K2 one saved version more
// and a clean git status; K3 every key node matches exactly one scene of the new activity; K4 expected
// edges present; K5 forbidden edges absent; K6 first nodes have depends_on []; K7 no plot error that is
// not in the baseline; K8 unchanged files are byte-identical; L-time and L-calls from the limits.
// Metrics (recorded, not pass/fail): edges_missing, edges_false, characters_drift.
// Exit codes: 0 every run passes (or the setup is done); 1 some run fails; 2 the case or key cannot be used.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT,
  appendResult,
  applyLimits,
  instructionsHash,
  listFiles,
  loadYamlMapping,
  parseCommonArgs,
  parseLimits,
  printSummary,
  recordHeader,
  runAgent,
} from './lib/case-common.mjs';
import { generateInstructions } from '../../yllir/scripts/lib/instructions.mjs';
import { ensureRepo, listVersions, saveVersion } from '../../yllir/scripts/lib/versions.mjs';
import { parseFrontmatter } from '../../yllir/scripts/lib/frontmatter.mjs';
import { plotMap } from '../../yllir/scripts/lib/plot/plot-map.mjs';
import { compareStrings, listCanonicalSheets, readStructure } from '../../yllir/scripts/lib/subjects.mjs';

const USAGE =
  'usage: node testbench/runners/run-plot-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep] [--setup-only] [--grade-only <dir> --run-json <file>]';
const AGENT_TIMEOUT_MS = 1800000;
const FIXTURES = path.join(REPO_ROOT, 'testbench', 'fixtures');
const BASE_MESSAGE = 'Campagna di partenza del caso piano';
const EDGE_FIELDS = ['expected_edges', 'forbidden_edges'];
const CHECK_IDS = ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8'];

// ---------------------------------------------------------------- case and key

/** Checks a key.yaml. Throws on a missing or wrongly typed field, a bad regex or an edge naming an unknown node. */
export function validatePlotKey(key) {
  if (typeof key.activity_folder !== 'string' || key.activity_folder === '') {
    throw new Error('key.yaml: activity_folder missing');
  }
  if (key.nodes !== undefined) {
    if (key.nodes === null || typeof key.nodes !== 'object' || Array.isArray(key.nodes)) {
      throw new Error('key.yaml: nodes must be a mapping');
    }
    for (const [name, pattern] of Object.entries(key.nodes)) {
      if (typeof pattern !== 'string') throw new Error(`key.yaml: nodes.${name} must be a string`);
      try {
        new RegExp(pattern, 'i');
      } catch (err) {
        throw new Error(`key.yaml: nodes.${name} is not a valid regex: ${err.message}`);
      }
    }
  }
  const names = new Set(Object.keys(key.nodes ?? {}));
  for (const field of EDGE_FIELDS) {
    if (key[field] === undefined) continue;
    if (!Array.isArray(key[field])) throw new Error(`key.yaml: ${field} must be a list`);
    for (const edge of key[field]) {
      if (!Array.isArray(edge) || edge.length !== 2 || edge.some((n) => typeof n !== 'string')) {
        throw new Error(`key.yaml: ${field} entries must be [node, prerequisite]`);
      }
      for (const n of edge) {
        if (!names.has(n)) throw new Error(`key.yaml: ${field} names ${n}, which is not in nodes`);
      }
    }
  }
  if (key.first_nodes !== undefined) {
    if (!Array.isArray(key.first_nodes)) throw new Error('key.yaml: first_nodes must be a list');
    for (const n of key.first_nodes) {
      if (!names.has(n)) throw new Error(`key.yaml: first_nodes names ${n}, which is not in nodes`);
    }
  }
  if (key.unchanged_files !== undefined) {
    if (!Array.isArray(key.unchanged_files) || key.unchanged_files.some((f) => typeof f !== 'string')) {
      throw new Error('key.yaml: unchanged_files must be a list of paths');
    }
  }
  return key;
}

/** Reads a case: case.yaml (prompt, runs, limits) and its key.yaml beside it. A plot case has one turn. */
export function loadPlotCase(caseDir) {
  const data = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  for (const field of ['case', 'fixture', 'prompt']) {
    if (typeof data[field] !== 'string') throw new Error(`case.yaml: ${field} missing`);
  }
  if (data.reply !== undefined) throw new Error('case.yaml: a plot case has one turn, so no reply');
  if (!Number.isInteger(data.runs) || data.runs < 1) throw new Error('case.yaml: runs must be a positive integer');
  const fixtureDir = path.join(FIXTURES, data.fixture, 'campaign');
  if (!fs.existsSync(fixtureDir)) throw new Error(`case.yaml: fixture ${data.fixture} not found`);
  const key = validatePlotKey(loadYamlMapping(path.join(caseDir, 'key.yaml')));
  return { ...data, limits: parseLimits(data), key, fixtureDir };
}

// ---------------------------------------------------------------- state of a campaign folder

/** The title of a file: the text of its first H1 line, or null. */
export function h1Title(body) {
  const match = /^# (.+?)\s*$/m.exec(body);
  return match ? match[1] : null;
}

/** Every file under root, as sorted relative paths with `/`, without .git and .campaign. */
function walkFiles(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.campaign') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  visit(root);
  return out.sort(compareStrings);
}

/**
 * The subject sheets of the campaign: every file of a category of type `subjects`, with its id and the
 * title (the H1 of its body, or null). Sorted by file.
 */
export function subjectSheets(root) {
  const { structure } = readStructure(root);
  if (structure === null) return [];
  const seen = new Set();
  const out = [];
  for (const category of structure) {
    if (category.type !== 'subjects' || typeof category.folder !== 'string') continue;
    for (const file of listCanonicalSheets(root, category.folder)) {
      if (seen.has(file)) continue;
      seen.add(file);
      const { data, body } = parseFrontmatter(fs.readFileSync(path.join(root, file), 'utf8'));
      if (!data || typeof data.id !== 'string') continue;
      out.push({ file, id: data.id, title: h1Title(body) });
    }
  }
  return out.sort((a, b) => compareStrings(a.file, b.file));
}

/**
 * What the grader needs from a campaign folder: the text of every Markdown file and of campaign.yaml,
 * a sha256 of every file (byte comparison), the plot map and the subject sheets. Plain data, so a
 * saved run can be graded again without the copy.
 */
export function captureState(root) {
  const files = {};
  const hashes = {};
  for (const rel of walkFiles(root)) {
    const bytes = fs.readFileSync(path.join(root, rel));
    hashes[rel] = crypto.createHash('sha256').update(bytes).digest('hex');
    if (rel.endsWith('.md') || rel === 'campaign.yaml') files[rel] = bytes.toString('utf8');
  }
  return { files, hashes, plot: plotMap(root), subjects: subjectSheets(root) };
}

// ---------------------------------------------------------------- the run

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Runs a function with git's global and system configuration switched off, then restores the environment. */
function withIsolatedGit(fn) {
  const names = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];
  const saved = names.map((name) => [name, process.env[name]]);
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  try {
    return fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/**
 * Copies a fixture campaign into a fresh temporary git repository and saves the baseline version.
 * Returns { tmp, copy, baseline (commit), versionsBefore, state (captureState of the baseline) }.
 * The copy is kept; remove it with fs.rmSync(tmp, { recursive: true, force: true }).
 */
export function setupPlotCopy(fixtureDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-plot-'));
  try {
    const copy = path.join(tmp, 'campaign');
    fs.cpSync(fixtureDir, copy, { recursive: true });
    const generated = generateInstructions(copy);
    if (generated.errors.length > 0) throw new Error(`generateInstructions: ${JSON.stringify(generated.errors)}`);
    const saved = withIsolatedGit(() => {
      ensureRepo(copy);
      return saveVersion(copy, { message: BASE_MESSAGE, kind: 'framework' });
    });
    if (!saved.saved) throw new Error('setup: the baseline version was not saved');
    const baseline = git(copy, ['rev-parse', 'HEAD']).trim();
    const versionsBefore = listVersions(copy, { limit: 500 }).length;
    return { tmp, copy, baseline, versionsBefore, state: captureState(copy) };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

/** What the copy holds after one turn: versions added, git status, and the captured state. */
export function snapshotPlot(setup, report) {
  return {
    report: report ?? null,
    versions_added: listVersions(setup.copy, { limit: 500 }).length - setup.versionsBefore,
    status: git(setup.copy, ['status', '--porcelain']).trim(),
    ...captureState(setup.copy),
  };
}

// ---------------------------------------------------------------- grading

/** Title of a scene: its H1, else its file name (without .md). */
function sceneTitle(file, snap) {
  const text = snap.files[file];
  const title = text === undefined ? null : h1Title(parseFrontmatter(text).body);
  return title ?? path.posix.basename(file, '.md');
}

/**
 * Grades a plot case. baseline and snap are captureState results (snap also carries report,
 * versions_added and status, see snapshotPlot). Pure: no file is read or written here.
 * Returns { checks: { K1..K8: boolean }, details: { K1..K8: reason }, failures, pass, metrics, new_activity }.
 * metrics and new_activity are null when the new activity is not exactly one session.
 */
export function gradePlot({ key, baseline, snap, agentError = null }) {
  if (agentError !== null) {
    return { checks: {}, details: {}, failures: [`agent: ${agentError}`], pass: false, metrics: null, new_activity: null };
  }
  const checks = {};
  const details = {};
  const failures = [];
  const put = (id, ok, reason) => {
    checks[id] = ok === true;
    details[id] = reason;
    if (ok !== true) failures.push(`${id} ${reason}`);
  };

  // K1: exactly one new activity, under the activity folder, with a depends_on field.
  const known = new Set(baseline.plot.sessions.map((s) => s.id));
  const added = snap.plot.sessions.filter((s) => !known.has(s.id));
  const activity = added.length === 1 ? added[0] : null;
  if (activity === null) {
    const names = added.map((s) => s.id).join(', ');
    put('K1', false, `expected one new activity, found ${added.length}${names ? ` (${names})` : ''}`);
  } else {
    const underFolder = activity.file.startsWith(`${key.activity_folder}/`);
    const meta = parseFrontmatter(snap.files[activity.file] ?? '').data;
    const hasDependsOn = !!meta && meta.depends_on !== undefined;
    put(
      'K1',
      underFolder && hasDependsOn,
      `new activity ${activity.id} at ${activity.file}` +
        (underFolder ? '' : `, not under ${key.activity_folder}/`) +
        (hasDependsOn ? '' : ', no depends_on field'),
    );
  }

  // K2: exactly one saved version more, and nothing left uncommitted.
  const clean = snap.status === '';
  put(
    'K2',
    snap.versions_added === 1 && clean,
    `saved versions added ${snap.versions_added} (expected 1), git status ${clean ? 'clean' : `not clean: ${snap.status.split('\n').join('; ')}`}`,
  );

  // K3: every node matches exactly one scene of the new activity (by its H1, else its file name).
  const events = activity === null ? [] : activity.events;
  const matched = {}; // node name -> scene of the new activity
  const nodes = key.nodes ?? null;
  if (nodes !== null) {
    const problems = [];
    for (const [name, pattern] of Object.entries(nodes)) {
      if (activity === null) {
        problems.push(`node ${name}: no new activity`);
        continue;
      }
      const re = new RegExp(pattern, 'i');
      const hits = events.filter((e) => re.test(sceneTitle(e.file, snap)));
      if (hits.length === 1) {
        matched[name] = hits[0];
      } else if (hits.length === 0) {
        problems.push(`node ${name}: no scene matches ${pattern}`);
      } else {
        problems.push(`node ${name}: several scenes match (${hits.map((h) => sceneTitle(h.file, snap)).join(', ')})`);
      }
    }
    put('K3', problems.length === 0, problems.length === 0 ? `${Object.keys(nodes).length} nodes matched one scene each` : problems.join('; '));
  } else {
    put('K3', true, 'skipped: no nodes in the key');
  }

  const notMatched = (edge) => `${edge[0]} -> ${edge[1]}: node not matched`;

  // K4: every expected edge is present (node's depends_on contains the prerequisite's id).
  if (key.expected_edges !== undefined) {
    const bad = [];
    for (const edge of key.expected_edges) {
      const [a, b] = edge;
      if (!matched[a] || !matched[b]) bad.push(notMatched(edge));
      else if (!matched[a].depends_on.includes(matched[b].id)) bad.push(`${a} should depend on ${b}`);
    }
    put('K4', bad.length === 0, bad.length === 0 ? `${key.expected_edges.length} expected edges present` : bad.join('; '));
  } else {
    put('K4', true, 'skipped: no expected_edges in the key');
  }

  // K5: no forbidden edge is present.
  if (key.forbidden_edges !== undefined) {
    const bad = [];
    for (const edge of key.forbidden_edges) {
      const [a, b] = edge;
      if (!matched[a] || !matched[b]) bad.push(notMatched(edge));
      else if (matched[a].depends_on.includes(matched[b].id)) bad.push(`${a} must not depend on ${b}`);
    }
    put('K5', bad.length === 0, bad.length === 0 ? `${key.forbidden_edges.length} forbidden edges absent` : bad.join('; '));
  } else {
    put('K5', true, 'skipped: no forbidden_edges in the key');
  }

  // K6: every first node has depends_on exactly [].
  if (key.first_nodes !== undefined) {
    const bad = [];
    for (const name of key.first_nodes) {
      if (!matched[name]) bad.push(`${name}: node not matched`);
      else if (matched[name].depends_on.length !== 0) bad.push(`${name} depends on ${matched[name].depends_on.join(', ')}`);
    }
    put('K6', bad.length === 0, bad.length === 0 ? `${key.first_nodes.length} first nodes have no prerequisite` : bad.join('; '));
  } else {
    put('K6', true, 'skipped: no first_nodes in the key');
  }

  // K7: no plot error whose code and file are not in the baseline.
  const seen = new Set(baseline.plot.errors.map((e) => `${e.code}\n${e.file}`));
  const fresh = snap.plot.errors.filter((e) => !seen.has(`${e.code}\n${e.file}`));
  put(
    'K7',
    fresh.length === 0,
    fresh.length === 0 ? 'no new plot error' : `new errors: ${fresh.map((e) => `${e.code} at ${e.file}`).join('; ')}`,
  );

  // K8: the listed files are byte-identical to the baseline.
  const unchanged = key.unchanged_files ?? [];
  const changed = unchanged.filter((f) => baseline.hashes[f] === undefined || snap.hashes[f] !== baseline.hashes[f]);
  put(
    'K8',
    changed.length === 0,
    changed.length === 0 ? `${unchanged.length} files unchanged` : `changed or missing: ${changed.join(', ')}`,
  );

  // Metrics, recorded and not graded.
  let metrics = null;
  let newActivity = null;
  if (activity !== null) {
    newActivity = { id: activity.id, file: activity.file, scenes: events.map((e) => e.file) };
    const expected = key.expected_edges ?? [];
    const isExpected = (a, b) => expected.some((edge) => edge[0] === a && edge[1] === b);
    const edgesMissing = expected
      .filter(([a, b]) => !matched[a] || !matched[b] || !matched[a].depends_on.includes(matched[b].id))
      .map(([a, b]) => [a, b]);
    const edgesFalse = [];
    const names = Object.keys(matched);
    for (const a of names) {
      for (const b of names) {
        if (a === b) continue;
        if (matched[a].depends_on.includes(matched[b].id) && !isExpected(a, b)) edgesFalse.push([a, b]);
      }
    }
    const namedNotListed = [];
    const listedNotNamed = [];
    for (const e of events) {
      const { data, body } = parseFrontmatter(snap.files[e.file] ?? '');
      const listed = Array.isArray(data?.characters) ? data.characters : [];
      const text = body.toLowerCase();
      for (const sub of snap.subjects) {
        if (sub.title && text.includes(sub.title.toLowerCase()) && !listed.includes(sub.id)) {
          namedNotListed.push({ scene: e.id, id: sub.id });
        }
      }
      for (const id of listed) {
        const sub = snap.subjects.find((s) => s.id === id);
        if (!sub || !sub.title || !text.includes(sub.title.toLowerCase())) listedNotNamed.push({ scene: e.id, id });
      }
    }
    metrics = {
      edges_missing: edgesMissing,
      edges_false: edgesFalse,
      characters_drift: {
        named_not_listed: namedNotListed,
        listed_not_named: listedNotNamed,
        counts: { named_not_listed: namedNotListed.length, listed_not_named: listedNotNamed.length },
      },
    };
  }

  const pass = CHECK_IDS.every((id) => checks[id] === true);
  return { checks, details, failures, pass, metrics, new_activity: newActivity };
}

// ---------------------------------------------------------------- main

/** The files that define what is under test: the prepare-session skill, the core entry and the engine scripts. */
function instructionFiles() {
  return [
    ...listFiles(path.join(REPO_ROOT, 'yllir', 'skills', 'core', 'prepare-session')),
    ...listFiles(path.join(REPO_ROOT, 'yllir', 'skills', 'core', 'yllir')),
    ...listFiles(path.join(REPO_ROOT, 'yllir', 'scripts'), { scriptsOnly: true }),
  ];
}

/** Runs one case once: setup, one agent turn, snapshot, grade. */
function runOnce(caseData, opts) {
  const setup = setupPlotCopy(caseData.fixtureDir);
  const result = runAgent({
    agent: opts.agent,
    cwd: setup.copy,
    prompt: caseData.prompt,
    model: opts.model,
    timeoutMs: AGENT_TIMEOUT_MS,
  });
  const snap = snapshotPlot(setup, result.report);
  const agentError = result.ok ? null : `turn 1: ${result.error}`;
  const totals = { duration_ms: result.duration_ms, tool_calls: result.tool_calls, cost_usd: result.cost_usd };
  const graded = applyLimits(
    gradePlot({ key: caseData.key, baseline: setup.state, snap, agentError }),
    caseData.limits,
    totals,
  );
  return { setup, snap, agents: [result], totals, agentError, graded };
}

function makeRecord({ caseData, run, hash, opts, graded, agents, totals, agentError, copy }) {
  return {
    case: caseData.case,
    run,
    date: new Date().toISOString(),
    ...recordHeader({ agent: opts.agent, modelLabel: opts.modelLabel }),
    instructions: hash,
    permission_mode: agents[0]?.permission_mode ?? null,
    kind: 'plot',
    checks: graded.checks,
    details: graded.details,
    failures: graded.failures,
    pass: graded.pass,
    limits: caseData.limits,
    metrics: graded.metrics,
    new_activity: graded.new_activity,
    cost_usd: totals.cost_usd,
    duration_ms: totals.duration_ms,
    tool_calls: totals.tool_calls,
    error: agentError,
    report: agents[agents.length - 1]?.report ?? null,
    copy: copy ?? null,
  };
}

function consoleView(record) {
  const { report, ...rest } = record;
  return rest;
}

function main() {
  const argv = process.argv.slice(2);
  const setupOnly = argv.includes('--setup-only');
  const opts = parseCommonArgs(
    argv.filter((arg) => arg !== '--setup-only'),
    USAGE,
    { valueOptions: ['--grade-only', '--run-json'] },
  );
  const caseData = loadPlotCase(opts.caseDir);
  const hash = instructionsHash(instructionFiles());

  if (setupOnly) {
    const setup = setupPlotCopy(caseData.fixtureDir);
    const versions = listVersions(setup.copy, { limit: 500 }).length;
    console.log(
      JSON.stringify({
        case: caseData.case,
        copy: setup.copy,
        versions,
        baseline_sessions: setup.state.plot.sessions.length,
        baseline_errors: setup.state.plot.errors.length,
      }),
    );
    if (versions !== 1) throw new Error(`setup: expected one saved version, found ${versions}`);
    return;
  }

  const gradeOnly = opts.values['--grade-only'];
  if (gradeOnly !== undefined) {
    const runJson = opts.values['--run-json'];
    if (runJson === undefined) throw new Error(`--grade-only needs --run-json <file>\n${USAGE}`);
    const dir = path.resolve(gradeOnly);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--grade-only: ${dir} is not a folder`);
    const saved = JSON.parse(fs.readFileSync(path.resolve(runJson), 'utf8'));
    const agentError = saved.agent_error ?? null;
    const graded = applyLimits(
      gradePlot({ key: caseData.key, baseline: saved.baseline, snap: saved.snaps[0], agentError }),
      caseData.limits,
      saved.totals,
    );
    const record = makeRecord({
      caseData,
      run: 1,
      hash,
      opts,
      graded,
      agents: saved.agents,
      totals: saved.totals,
      agentError,
      copy: dir,
    });
    console.log(JSON.stringify(consoleView(record)));
    process.exitCode = printSummary([record], opts.modelLabel, hash, opts.agent) === 1 ? 0 : 1;
    return;
  }

  const records = [];
  for (let run = 1; run <= opts.runs; run++) {
    const one = runOnce(caseData, opts);
    const record = makeRecord({
      caseData,
      run,
      hash,
      opts,
      graded: one.graded,
      agents: one.agents,
      totals: one.totals,
      agentError: one.agentError,
      copy: opts.keep ? one.setup.copy : null,
    });
    if (opts.keep) {
      fs.writeFileSync(
        path.join(one.setup.tmp, 'run.json'),
        `${JSON.stringify({ baseline: one.setup.state, snaps: [one.snap], agents: one.agents, totals: one.totals, agent_error: one.agentError }, null, 2)}\n`,
      );
      console.error(`kept: ${one.setup.copy} (run.json beside it)`);
    } else {
      fs.rmSync(one.setup.tmp, { recursive: true, force: true });
    }
    appendResult(caseData.case, record);
    console.log(JSON.stringify(consoleView(record)));
    records.push(record);
  }
  process.exitCode = printSummary(records, opts.modelLabel, hash, opts.agent) === records.length ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
