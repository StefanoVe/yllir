#!/usr/bin/env node
// Runs one continuity-keeper case end to end: copies the continuity fixture into a temporary git
// repository, saves a baseline version, runs the entry point with `claude -p` (one turn, or two
// when the case has a reply, in the same folder), and grades what the agent left in the repository
// against the case's answer key. The key is read from cases/continuity/<name>/key.yaml and is never
// copied into the copy the agent works on. One JSON line per run is appended to
// testbench/results/<case>.jsonl.
//
// Usage: node testbench/runners/run-continuity-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep]
//        node testbench/runners/run-continuity-case.mjs <caseDir> --grade-only <dir> --run-json <file>
// --keep keeps the copy and saves the snapshots of each turn as <tmp>/run.json. --grade-only grades
// a saved run.json again without running the agent and does not append to the results file.
// Checks by kind: rename R1 to R6; delete D1 to D4 after turn 1 (the question) and D5 to D9 after
// turn 2 (the answer); merge M1 to M4; retcon T1 to T3. L-time and L-calls come from the limits.
// Exit codes: 0 every run passes; 1 some run fails; 2 the case or key cannot be used.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT,
  appendResult,
  applyLimits,
  changedFiles,
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

const USAGE =
  'usage: node testbench/runners/run-continuity-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep] [--grade-only <dir> --run-json <file>]';
const AGENT_TIMEOUT_MS = 1800000;
const FIXTURES = path.join(REPO_ROOT, 'testbench', 'fixtures');
const BASE_MESSAGE = 'Creata la campagna «Il faro di Tessa»';
const KINDS = ['rename', 'delete', 'merge', 'retcon'];
const KEY_FIELDS = {
  rename: ['subject', 'old_file', 'new_file', 'old_title', 'new_title', 'chronicle', 'homonym', 'link_documents', 'allowed_changes', 'versions_added'],
  delete: ['subject', 'sheet', 'dependent', 'dependent_title_word', 'dependent_field', 'allowed_changes', 'versions_added'],
  merge: ['survivor', 'other', 'sister', 'conflict_words', 'untouched'],
  retcon: ['chronicle', 'untouched'],
};
const LIST_FIELDS = ['link_documents', 'allowed_changes', 'conflict_words', 'untouched'];

// ---------------------------------------------------------------- case and key

/** Reads and checks a key.yaml. Throws on a missing or wrongly typed field. */
export function validateKey(key) {
  if (!KINDS.includes(key.kind)) throw new Error(`key.yaml: kind must be one of ${KINDS.join(', ')}`);
  for (const field of KEY_FIELDS[key.kind]) {
    if (key[field] === undefined) throw new Error(`key.yaml: ${field} missing`);
  }
  for (const field of LIST_FIELDS) {
    if (key[field] !== undefined && !Array.isArray(key[field])) throw new Error(`key.yaml: ${field} must be a list`);
  }
  if (key.versions_added !== undefined && !(Number.isInteger(key.versions_added) && key.versions_added >= 0)) {
    throw new Error('key.yaml: versions_added must be a whole number');
  }
  return key;
}

/** Reads a case: case.yaml (prompt, optional reply, runs, limits) and its key.yaml beside it. */
export function loadCase(caseDir) {
  const data = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  for (const field of ['case', 'fixture', 'prompt']) {
    if (typeof data[field] !== 'string') throw new Error(`case.yaml: ${field} missing`);
  }
  if (data.reply !== undefined && typeof data.reply !== 'string') throw new Error('case.yaml: reply must be a string');
  if (!Number.isInteger(data.runs) || data.runs < 1) throw new Error('case.yaml: runs must be a positive integer');
  const fixture = path.join(FIXTURES, data.fixture, 'campaign');
  if (!fs.existsSync(fixture)) throw new Error(`case.yaml: fixture ${data.fixture} not found`);
  const key = validateKey(loadYamlMapping(path.join(caseDir, 'key.yaml')));
  if (key.kind === 'delete' && data.reply === undefined) throw new Error('case.yaml: a delete case needs a reply (the answer)');
  if (key.kind !== 'delete' && data.reply !== undefined) throw new Error('case.yaml: only a delete case has a reply');
  return { ...data, limits: parseLimits(data), key, fixtureDir: fixture };
}

// ---------------------------------------------------------------- snapshots

/** Every file of a campaign folder as { relative path: text }, without .git and .campaign. */
export function readTree(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.campaign') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files[path.relative(root, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return files;
}

/** The changes saved since the baseline commit, as [{ status, path }]. */
function committedChanges(copy, baseline) {
  const out = execFileSync('git', ['diff', '--name-status', '--no-renames', '-z', baseline, 'HEAD'], {
    cwd: copy,
    encoding: 'utf8',
  });
  const tokens = out.split('\0').filter((token) => token !== '');
  const changes = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) changes.push({ status: tokens[i], path: tokens[i + 1] });
  return changes;
}

/**
 * What the agent left after one turn: the final message, the number of saved versions added since
 * the baseline, the saved changes, the uncommitted changes outside .campaign/ and every file.
 */
export function snapshotCopy(copy, { baseline, versionsBefore, report }) {
  return {
    report: report ?? null,
    versions_added: listVersions(copy, { limit: 500 }).length - versionsBefore,
    committed: committedChanges(copy, baseline),
    dirty: changedFiles(copy).filter((file) => !file.startsWith('.campaign/')),
    files: readTree(copy),
  };
}

// ---------------------------------------------------------------- grading helpers

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

/** True when the final message ends on a question (a question mark is the last visible character). */
export function endsWithQuestion(report) {
  return typeof report === 'string' && /\?\s*$/.test(report.trim());
}

function lower(text) {
  return typeof text === 'string' ? text.toLowerCase() : '';
}

/** Nothing saved and nothing uncommitted outside .campaign/. */
function quiet(snap) {
  return snap.versions_added === 0 && snap.committed.length === 0 && snap.dirty.length === 0;
}

/** The file exists in the snapshot and is byte for byte the fixture's. */
function same(snap, fixture, rel) {
  return snap.files[rel] !== undefined && snap.files[rel] === fixture[rel];
}

function fm(text) {
  if (typeof text !== 'string') return null;
  return parseFrontmatter(text).data ?? null;
}

function firstHeading(text) {
  if (typeof text !== 'string') return null;
  const line = text.split('\n').find((item) => /^# /.test(item));
  return line === undefined ? null : line.replace(/\r$/, '');
}

/** The campaign-relative documents that a Markdown text links to, normalised (anchors and external links dropped). */
export function linkTargets(file, text) {
  if (typeof text !== 'string') return [];
  const targets = [];
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const raw = match[1].split('#')[0];
    if (raw === '' || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      // keep the raw target when it is not valid percent-encoding
    }
    targets.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), decoded)));
  }
  return targets;
}

/** The saved changes all fall inside the allowed list, and nothing is left uncommitted. */
function onlyAllowed(snap, allowed) {
  const set = new Set(allowed);
  return snap.dirty.length === 0 && snap.committed.every((change) => set.has(change.path));
}

// ---------------------------------------------------------------- graders by kind

/** Rename: R1 to R6, after the single turn. */
export function renameChecks(key, snap, fixture) {
  const files = snap.files;
  const data = fm(files[key.new_file]);
  const aliases = Array.isArray(data?.aliases) ? data.aliases : [];
  const oldId = fm(fixture[key.old_file])?.id;
  const oldLinks = [];
  const newLinkers = new Set();
  for (const [file, text] of Object.entries(files)) {
    if (!file.endsWith('.md')) continue;
    for (const target of linkTargets(file, text)) {
      if (target === key.old_file) oldLinks.push(file);
      if (target === key.new_file) newLinkers.add(file);
    }
  }
  const missingNew = key.link_documents.filter((doc) => !newLinkers.has(doc));
  return [
    check(
      'R1',
      files[key.old_file] === undefined &&
        files[key.new_file] !== undefined &&
        data?.id === oldId &&
        firstHeading(files[key.new_file]) === `# ${key.new_title}` &&
        aliases.includes(key.old_title),
      'the sheet is not renamed with its id kept, its heading and the old title as an alias',
    ),
    check('R2', oldLinks.length === 0 && missingNew.length === 0, `links to the old file in ${oldLinks.join(', ') || '-'}; no link to the new file in ${missingNew.join(', ') || '-'}`),
    check('R3', same(snap, fixture, key.chronicle), 'the chronicle text changed'),
    check('R4', same(snap, fixture, key.homonym), 'the homonym sheet changed'),
    check('R5', snap.versions_added === key.versions_added, `${snap.versions_added} saved versions instead of ${key.versions_added}`),
    check('R6', onlyAllowed(snap, key.allowed_changes), 'a change outside the allowed set, or something left uncommitted'),
  ];
}

/** Delete, turn 1 (the question): D1 to D4. */
export function deleteQuestionChecks(key, snap, fixture) {
  return [
    check('D1', endsWithQuestion(snap.report), 'the run does not end on a question'),
    check('D2', same(snap, fixture, key.sheet), 'the sheet to delete is gone or changed before the answer'),
    check('D3', quiet(snap), 'something was saved or changed before the answer'),
    check('D4', lower(snap.report).includes(lower(key.dependent_title_word)), `the question does not name the dependent document (${key.dependent_title_word})`),
  ];
}

/** Delete, turn 2 (the answer): D5 to D9. */
export function deleteDoneChecks(key, snap) {
  const data = fm(snap.files[key.dependent]);
  const field = data === null ? undefined : data[key.dependent_field];
  const holds = field !== undefined && field !== null && field !== '';
  return [
    check('D5', snap.files[key.sheet] === undefined, 'the sheet is still there'),
    check('D6', data !== null && !holds, `the dependent document still holds the field ${key.dependent_field}`),
    check('D7', !linkTargets(key.dependent, snap.files[key.dependent]).includes(key.sheet), 'the dependent document still links to the deleted sheet'),
    check('D8', snap.versions_added === key.versions_added, `${snap.versions_added} saved versions instead of ${key.versions_added}`),
    check('D9', onlyAllowed(snap, key.allowed_changes), 'a change outside the allowed set, or something left uncommitted'),
  ];
}

/** Merge: M1 to M4, after the single turn. */
export function mergeChecks(key, snap, fixture) {
  return [
    check('M1', endsWithQuestion(snap.report), 'the run does not end on a question'),
    check('M2', key.conflict_words.every((word) => lower(snap.report).includes(lower(word))), `the question does not name every conflicting value (${key.conflict_words.join(' / ')})`),
    check('M3', quiet(snap), 'something was saved or changed before the answer'),
    check('M4', key.untouched.every((rel) => same(snap, fixture, rel)), 'a sheet of the merge changed'),
  ];
}

/** Retcon: T1 to T3, after the single turn. */
export function retconChecks(key, snap, fixture) {
  return [
    check('T1', endsWithQuestion(snap.report), 'the run does not end on a question'),
    check('T2', /cronaca|10 ottobre/i.test(snap.report ?? ''), 'the question does not name the played chronicle'),
    check('T3', quiet(snap) && key.untouched.every((rel) => same(snap, fixture, rel)), 'something was saved or changed before the answer'),
  ];
}

/**
 * Grades the snapshots of one run (one per turn that ran). agentError is the first error of a turn
 * that did not finish; such a run fails without checks. For delete, turn 2 is graded only when it ran.
 */
export function gradeRun({ key, snaps, fixture, agentError = null }) {
  if (agentError !== null) return { checks: {}, failures: [`agent: ${agentError}`], pass: false };
  if (snaps.length === 0) return { checks: {}, failures: ['agent: no turn ran'], pass: false };
  switch (key.kind) {
    case 'rename':
      return finish(renameChecks(key, snaps[0], fixture));
    case 'merge':
      return finish(mergeChecks(key, snaps[0], fixture));
    case 'retcon':
      return finish(retconChecks(key, snaps[0], fixture));
    case 'delete': {
      const list = deleteQuestionChecks(key, snaps[0], fixture);
      if (snaps.length > 1) {
        list.push(...deleteDoneChecks(key, snaps[1]));
      } else {
        for (const id of ['D5', 'D6', 'D7', 'D8', 'D9']) list.push(check(id, false, 'the answer turn did not run'));
      }
      return finish(list);
    }
    default:
      throw new Error(`unknown kind ${key.kind}`);
  }
}

// ---------------------------------------------------------------- the run

/** Copies the fixture into a fresh temporary git repository and saves the baseline version. */
export function setupCopy() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-case-'));
  try {
    const copy = path.join(tmp, 'campaign');
    fs.cpSync(path.join(FIXTURES, 'continuity', 'campaign'), copy, { recursive: true });
    const generated = generateInstructions(copy);
    if (generated.errors.length > 0) throw new Error(`generateInstructions: ${JSON.stringify(generated.errors)}`);
    const saved = withIsolatedGit(() => {
      ensureRepo(copy);
      return saveVersion(copy, { message: BASE_MESSAGE, kind: 'framework' });
    });
    if (!saved.saved) throw new Error('setup: the baseline version was not saved');
    const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: copy, encoding: 'utf8' }).trim();
    return { tmp, copy, baseline, versionsBefore: listVersions(copy, { limit: 500 }).length };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
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

function sumOf(values) {
  return values.every((value) => typeof value === 'number') ? values.reduce((a, b) => a + b, 0) : null;
}

/** The files that define what is under test: the skill, the core entry instructions and the engine scripts. */
function instructionFiles() {
  return [
    ...listFiles(path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'continuity-keeper')),
    ...listFiles(path.join(REPO_ROOT, 'yllir', 'skills', 'core', 'yllir')),
    ...listFiles(path.join(REPO_ROOT, 'yllir', 'scripts'), { scriptsOnly: true }),
  ];
}

/** Runs one case once. Returns the grade, the snapshots, the agent results and the temporary folder. */
function runOnce(caseData, opts) {
  const setup = setupCopy();
  const common = { agent: opts.agent, cwd: setup.copy, model: opts.model, modelGiven: opts.modelGiven, timeoutMs: AGENT_TIMEOUT_MS };
  const prompts = caseData.reply === undefined ? [caseData.prompt] : [caseData.prompt, caseData.reply];
  const snaps = [];
  const agents = [];
  let agentError = null;
  for (let i = 0; i < prompts.length; i++) {
    const result = runAgent({ ...common, prompt: prompts[i], continueConversation: i > 0 });
    agents.push(result);
    if (!result.ok) {
      agentError = `turn ${i + 1}: ${result.error}`;
      break;
    }
    snaps.push(snapshotCopy(setup.copy, { baseline: setup.baseline, versionsBefore: setup.versionsBefore, report: result.report }));
  }
  const graded = gradeRun({ key: caseData.key, snaps, fixture: readTree(caseData.fixtureDir), agentError });
  const totals = {
    duration_ms: sumOf(agents.map((a) => a.duration_ms)),
    tool_calls: sumOf(agents.map((a) => a.tool_calls)),
    cost_usd: sumOf(agents.map((a) => a.cost_usd)),
  };
  return { setup, graded: applyLimits(graded, caseData.limits, totals), snaps, agents, totals, agentError };
}

function makeRecord({ caseData, run, hash, opts, graded, agents, totals, agentError, copy }) {
  const last = agents[agents.length - 1];
  return {
    case: caseData.case,
    run,
    date: new Date().toISOString(),
    ...recordHeader({ agent: opts.agent, modelLabel: opts.modelLabel }),
    instructions: hash,
    permission_mode: agents[0]?.permission_mode ?? null,
    kind: caseData.key.kind,
    checks: graded.checks,
    failures: graded.failures,
    pass: graded.pass,
    limits: caseData.limits,
    cost_usd: totals.cost_usd,
    duration_ms: totals.duration_ms,
    tool_calls: totals.tool_calls,
    error: agentError,
    report: last?.report ?? null,
    copy: copy ?? null,
  };
}

function consoleView(record) {
  const { report, ...rest } = record;
  return rest;
}

// ---------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const opts = parseCommonArgs(argv, USAGE, { valueOptions: ['--grade-only', '--run-json'] });
  const caseData = loadCase(opts.caseDir);
  const hash = instructionsHash(instructionFiles());

  const gradeOnly = opts.values['--grade-only'];
  if (gradeOnly !== undefined) {
    const runJson = opts.values['--run-json'];
    if (runJson === undefined) throw new Error(`--grade-only needs --run-json <file>\n${USAGE}`);
    const dir = path.resolve(gradeOnly);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--grade-only: ${dir} is not a folder`);
    const saved = JSON.parse(fs.readFileSync(path.resolve(runJson), 'utf8'));
    const graded = applyLimits(
      gradeRun({ key: caseData.key, snaps: saved.snaps, fixture: readTree(caseData.fixtureDir), agentError: saved.agent_error ?? null }),
      caseData.limits,
      saved.totals,
    );
    const record = makeRecord({ caseData, run: 1, hash, opts, graded, agents: saved.agents, totals: saved.totals, agentError: saved.agent_error ?? null, copy: dir });
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
      const runFile = path.join(one.setup.tmp, 'run.json');
      fs.writeFileSync(
        runFile,
        `${JSON.stringify({ snaps: one.snaps, agents: one.agents, totals: one.totals, agent_error: one.agentError }, null, 2)}\n`,
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
