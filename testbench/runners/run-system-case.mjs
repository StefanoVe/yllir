#!/usr/bin/env node
// Runs one system case end to end: copies the case's fixture (a game-system adapter campaign) into a
// temporary git repository, saves a baseline version, opens a live session when the case asks for it
// (case.yaml live_session: true), runs one turn with `claude -p` and grades the final message, the
// files the agent left and the fight state against the case's answer key. The key is read from
// cases/system/<name>/key.yaml and is never copied into the copy the agent works on. One JSON line
// per run is appended to testbench/results/<case>.jsonl.
//
// Usage: node testbench/runners/run-system-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep]
//        node testbench/runners/run-system-case.mjs <caseDir> --setup-only [--keep]
//        node testbench/runners/run-system-case.mjs <caseDir> --grade-only <dir> --run-json <file>
// --keep keeps the copy and saves the snapshots of the turn as <tmp>/run.json. --setup-only builds the
// copy, checks it and prints one JSON line; it never calls the agent. --grade-only grades a saved
// run.json again without running the agent and does not append to the results file.
// Checks: X1 text_all, X2 text_any (skipped when empty), X3 text_none (skipped when empty), X4
// documents_unchanged (skipped when false or absent), X5 fight (skipped when absent), X6 no technical
// words in the final message. L-time and L-calls come from the limits.
// Exit codes: 0 every run passes (or setup is fine); 1 some run fails; 2 the case or key cannot be used.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
import { readTree, snapshotCopy } from './run-continuity-case.mjs';
import { technicalFindings } from './run-update-case.mjs';
import { generateInstructions } from '../../yllir/scripts/lib/instructions.mjs';
import { ensureRepo, listVersions, saveVersion } from '../../yllir/scripts/lib/versions.mjs';
import { openSession } from '../../yllir/skills/library/session-log/scripts/lib/log-store.mjs';
import { getCombat } from '../../yllir/skills/library/combat-tracker/scripts/lib/combat-store.mjs';

const USAGE =
  'usage: node testbench/runners/run-system-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep] [--setup-only] [--grade-only <dir> --run-json <file>]';
const AGENT_TIMEOUT_MS = 1800000;
const FIXTURES = path.join(REPO_ROOT, 'testbench', 'fixtures');
const BASE_MESSAGE = 'Created the campaign The Drowned Lantern';
const LIVE_TITLE = 'Salt Harbor fight';
const PATTERN_LISTS = ['text_all', 'text_any', 'text_none'];

// ---------------------------------------------------------------- case and key

function compilePattern(pattern, field) {
  try {
    return new RegExp(pattern, 'i');
  } catch (err) {
    throw new Error(`key.yaml: ${field} has an invalid pattern ${pattern}: ${err.message}`);
  }
}

/** Checks a key.yaml and returns it with every optional field filled in. Throws on a wrong field. */
export function validateSystemKey(raw) {
  const key = { ...raw };
  for (const field of PATTERN_LISTS) {
    const list = key[field] ?? [];
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string' || item === '')) {
      throw new Error(`key.yaml: ${field} must be a list of text patterns`);
    }
    for (const pattern of list) compilePattern(pattern, field);
    key[field] = list;
  }
  if (key.documents_unchanged !== undefined && typeof key.documents_unchanged !== 'boolean') {
    throw new Error('key.yaml: documents_unchanged must be true or false');
  }
  if (key.fight !== undefined) {
    const fight = key.fight;
    if (fight === null || typeof fight !== 'object' || Array.isArray(fight)) {
      throw new Error('key.yaml: fight must be a mapping with combatant and conditions');
    }
    if (typeof fight.combatant !== 'string' || fight.combatant.trim() === '') {
      throw new Error('key.yaml: fight.combatant must be a name');
    }
    if (fight.conditions !== undefined && (!Array.isArray(fight.conditions) || fight.conditions.some((c) => typeof c !== 'string'))) {
      throw new Error('key.yaml: fight.conditions must be a list of condition ids');
    }
  }
  return key;
}

/** Reads a system case: case.yaml (case, fixture, prompt, runs, optional limits and live_session) and key.yaml beside it. */
export function loadSystemCase(caseDir) {
  const data = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  for (const field of ['case', 'fixture', 'prompt']) {
    if (typeof data[field] !== 'string' || data[field].trim() === '') throw new Error(`case.yaml: ${field} missing`);
  }
  if (!Number.isInteger(data.runs) || data.runs < 1) throw new Error('case.yaml: runs must be a positive integer');
  if (data.live_session !== undefined && typeof data.live_session !== 'boolean') {
    throw new Error('case.yaml: live_session must be true or false');
  }
  const fixtureDir = path.join(FIXTURES, data.fixture, 'campaign');
  if (!fs.existsSync(fixtureDir)) throw new Error(`case.yaml: fixture ${data.fixture} not found`);
  const key = validateSystemKey(loadYamlMapping(path.join(caseDir, 'key.yaml')));
  return { ...data, live_session: data.live_session === true, limits: parseLimits(data), key, fixtureDir };
}

// ---------------------------------------------------------------- setup

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
 * Copies the fixture into a fresh temporary git repository, saves the baseline version and, when the
 * case asks for it, opens a live session (kept under .campaign/, which git ignores). Returns
 * { tmp, copy, baseline, versionsBefore, tree } where tree is the campaign as the agent first sees it.
 */
export function setupSystemCopy(caseData) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-system-'));
  try {
    const copy = path.join(tmp, 'campaign');
    fs.cpSync(caseData.fixtureDir, copy, { recursive: true });
    const generated = generateInstructions(copy);
    if (generated.errors.length > 0) throw new Error(`generateInstructions: ${JSON.stringify(generated.errors)}`);
    const saved = withIsolatedGit(() => {
      ensureRepo(copy);
      return saveVersion(copy, { message: BASE_MESSAGE, kind: 'framework' });
    });
    if (!saved.saved) throw new Error('setup: the baseline version was not saved');
    const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: copy, encoding: 'utf8' }).trim();
    const versionsBefore = listVersions(copy, { limit: 500 }).length;
    if (caseData.live_session) {
      const opened = openSession(copy, { title: LIVE_TITLE });
      if (!opened.ok) throw new Error(`setup: the live session did not open: ${opened.error?.message ?? 'unknown error'}`);
    }
    return { tmp, copy, baseline, versionsBefore, tree: readTree(copy) };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

// ---------------------------------------------------------------- snapshots

/** The fight state of the active session as { sessionId, combat }, or null when there is no fight state file. */
export function fightState(copy) {
  const got = getCombat(copy);
  if (!got.ok || got.combat === null || got.combat === undefined) return null;
  return { sessionId: got.sessionId, combat: got.combat };
}

/** What the agent left after its turn: the continuity snapshot plus the fight state. */
export function snapshotSystem(copy, setup, report) {
  return {
    ...snapshotCopy(copy, { baseline: setup.baseline, versionsBefore: setup.versionsBefore, report }),
    fight: fightState(copy),
  };
}

// ---------------------------------------------------------------- grading

function check(id, ok, reason) {
  return { id, ok: ok === true, reason };
}

/** The checks of one run as { checks, failures, pass }. A run with no checks never passes. */
function finish(list) {
  const checks = {};
  const failures = [];
  for (const item of list) {
    checks[item.id] = item.ok;
    if (!item.ok) failures.push(`${item.id} ${item.reason}`);
  }
  return { checks, failures, pass: list.length > 0 && failures.length === 0 };
}

function matches(pattern, text) {
  return new RegExp(pattern, 'i').test(text);
}

/** The paths whose text differs from the baseline, or that were added, outside .campaign/ (empty when none). */
export function documentDifferences(baseline, files) {
  const changed = Object.keys(baseline).filter((rel) => files[rel] !== baseline[rel]);
  const added = Object.keys(files).filter((rel) => baseline[rel] === undefined);
  return [...changed, ...added];
}

/** X5: the named combatant is in the fight state and has every condition of the key. */
function fightCheck(want, fight) {
  if (!fight || !fight.combat) return check('X5', false, 'no fight state file');
  const needle = want.combatant.toLowerCase();
  const found = (fight.combat.combatants ?? []).find((c) => typeof c.name === 'string' && c.name.toLowerCase().includes(needle));
  if (!found) return check('X5', false, `no combatant named ${want.combatant}`);
  const have = (found.conditions ?? []).map((c) => String(c.id).toLowerCase());
  const missing = (want.conditions ?? []).filter((id) => !have.includes(id.toLowerCase()));
  return check('X5', missing.length === 0, `${found.name} lacks ${missing.join(', ')}`);
}

/**
 * Grades one run of a system case. snap is the snapshot after the turn (null when the turn did not
 * finish, then agentError says why). baseline is the campaign tree before the agent ran.
 */
export function gradeSystemRun({ key, snap, baseline, agentError = null }) {
  if (agentError !== null) return { checks: {}, failures: [`agent: ${agentError}`], pass: false };
  if (!snap) return { checks: {}, failures: ['agent: no turn ran'], pass: false };
  const report = typeof snap.report === 'string' ? snap.report : '';
  const list = [];
  if (key.text_all.length > 0) {
    const missing = key.text_all.filter((pattern) => !matches(pattern, report));
    list.push(check('X1', missing.length === 0, `no match for ${missing.join(', ')}`));
  }
  if (key.text_any.length > 0) {
    list.push(check('X2', key.text_any.some((pattern) => matches(pattern, report)), `no match for any of ${key.text_any.join(', ')}`));
  }
  if (key.text_none.length > 0) {
    const found = key.text_none.filter((pattern) => matches(pattern, report));
    list.push(check('X3', found.length === 0, `matched ${found.join(', ')}`));
  }
  if (key.documents_unchanged === true) {
    const diff = documentDifferences(baseline, snap.files);
    list.push(check('X4', diff.length === 0, `changed or added: ${diff.slice(0, 5).join(', ')}`));
  }
  if (key.fight !== undefined) list.push(fightCheck(key.fight, snap.fight));
  const findings = technicalFindings(report);
  list.push(check('X6', findings.length === 0, `technical words: ${findings.join(', ')}`));
  return finish(list);
}

// ---------------------------------------------------------------- the run

const INSTRUCTION_DIRS = [
  path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'combat-tracker'),
  path.join(REPO_ROOT, 'yllir', 'modules', 'systems', 'fabula-ultima'),
  path.join(REPO_ROOT, 'yllir', 'skills', 'core', 'yllir'),
];

/** The files that define what is under test: the combat skill, the adapter and the core entry instructions. */
function instructionFiles() {
  return [
    ...INSTRUCTION_DIRS.flatMap((dir) => listFiles(dir)),
    ...listFiles(path.join(REPO_ROOT, 'yllir', 'scripts'), { scriptsOnly: true }),
  ];
}

function runOnce(caseData, opts) {
  const setup = setupSystemCopy(caseData);
  const result = runAgent({
    agent: opts.agent,
    cwd: setup.copy,
    prompt: caseData.prompt,
    model: opts.model,
    timeoutMs: AGENT_TIMEOUT_MS,
  });
  const agentError = result.ok ? null : `turn 1: ${result.error}`;
  const snap = result.ok ? snapshotSystem(setup.copy, setup, result.report) : null;
  const totals = { duration_ms: result.duration_ms, tool_calls: result.tool_calls, cost_usd: result.cost_usd };
  const graded = applyLimits(
    gradeSystemRun({ key: caseData.key, snap, baseline: setup.tree, agentError }),
    caseData.limits,
    totals,
  );
  return { setup, graded, snap, result, agentError, totals };
}

function makeRecord({ caseData, run, hash, opts, graded, result, totals, agentError, copy }) {
  return {
    case: caseData.case,
    run,
    date: new Date().toISOString(),
    ...recordHeader({ agent: opts.agent, modelLabel: opts.modelLabel }),
    instructions: hash,
    permission_mode: result?.permission_mode ?? null,
    kind: 'system',
    checks: graded.checks,
    failures: graded.failures,
    pass: graded.pass,
    limits: caseData.limits,
    cost_usd: totals.cost_usd ?? null,
    duration_ms: totals.duration_ms ?? null,
    tool_calls: totals.tool_calls ?? null,
    error: agentError,
    report: result?.report ?? null,
    copy: copy ?? null,
  };
}

function consoleView(record) {
  const { report, ...rest } = record;
  return rest;
}

/** Builds the copy, checks it and prints what the offline checks need. Never calls the agent. */
function setupOnly(caseData, opts) {
  const setup = setupSystemCopy(caseData);
  try {
    const versions = listVersions(setup.copy, { limit: 500 }).length;
    const adapter = loadYamlMapping(path.join(setup.copy, 'campaign.yaml')).system?.adapter ?? null;
    const liveOpen = fs.existsSync(path.join(setup.copy, '.campaign', 'state', 'live', 'active.json'));
    if (versions !== 1) throw new Error(`setup: ${versions} saved versions instead of 1`);
    if (typeof adapter !== 'string' || adapter === '') throw new Error('setup: the copy names no game system');
    console.log(JSON.stringify({ case: caseData.case, copy: setup.copy, versions, adapter, live_session_open: liveOpen }));
    if (opts.keep) console.error(`kept: ${setup.copy}`);
    return 0;
  } finally {
    if (!opts.keep) fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
}

function main() {
  const argv = process.argv.slice(2);
  const setupFlag = argv.includes('--setup-only');
  const opts = parseCommonArgs(
    argv.filter((arg) => arg !== '--setup-only'),
    USAGE,
    { valueOptions: ['--grade-only', '--run-json'] },
  );
  const caseData = loadSystemCase(opts.caseDir);

  if (setupFlag) {
    process.exitCode = setupOnly(caseData, opts);
    return;
  }

  const hash = instructionsHash(instructionFiles());
  const gradeOnly = opts.values['--grade-only'];
  if (gradeOnly !== undefined) {
    const runJson = opts.values['--run-json'];
    if (runJson === undefined) throw new Error(`--grade-only needs --run-json <file>\n${USAGE}`);
    const dir = path.resolve(gradeOnly);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--grade-only: ${dir} is not a folder`);
    const saved = JSON.parse(fs.readFileSync(path.resolve(runJson), 'utf8'));
    const graded = applyLimits(
      gradeSystemRun({ key: caseData.key, snap: saved.snap, baseline: saved.baseline, agentError: saved.agent_error ?? null }),
      caseData.limits,
      saved.totals ?? {},
    );
    const record = makeRecord({
      caseData,
      run: 1,
      hash,
      opts,
      graded,
      result: saved.agent ?? null,
      totals: saved.totals ?? {},
      agentError: saved.agent_error ?? null,
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
      result: one.result,
      totals: one.totals,
      agentError: one.agentError,
      copy: opts.keep ? one.setup.copy : null,
    });
    if (opts.keep) {
      fs.writeFileSync(
        path.join(one.setup.tmp, 'run.json'),
        `${JSON.stringify({ snap: one.snap, baseline: one.setup.tree, agent: one.result, agent_error: one.agentError, totals: one.totals }, null, 2)}\n`,
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
