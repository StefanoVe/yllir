#!/usr/bin/env node
// Runs one framework-update case end to end on an existing campaign. The setup is
// deterministic: it copies the morvalle fixture into a temporary folder, generates the
// instructions and saves version 1. Then, per scenario:
//   stale-campaign   the campaign was made with an older version (version.yaml is rewound to 0.0.1),
//                    the master has a line in customizations.md and a hand-added line in agent.md,
//                    and the tree is saved. The entry point must update silently.
//   newer-published  a campaign at the installed version, and a published source (folder named by
//                    YLLIR_PUBLISHED_SOURCE) with a newer version and its news. The master asks a
//                    question; the answer must end with a question about updating and nothing is updated.
//   declined         the same, but the master says «not now». Nothing is updated and the notice is postponed.
// The agent (`claude -p`, or `codex exec` with --agent codex) runs with the case prompt (the master's
// message), and the runner grades what the agent left in the folder. One JSON line per run is appended
// to testbench/results/<case>.jsonl. The grading helpers are exported and tested offline.
//
// Usage: node testbench/runners/run-update-case.mjs <caseDir> [--runs N] [--model haiku] [--agent claude|codex] [--keep]
//        node testbench/runners/run-update-case.mjs <caseDir> --setup-only
//        node testbench/runners/run-update-case.mjs <caseDir> --grade-only <dir> --run-json <file>
// --setup-only runs the setup, prints the folders and the git log, and keeps them.
// With --keep, the folder is kept and the agent's final message, cost and the setup values are saved
// beside it as <dir>.run.json; --grade-only with --run-json grades a kept folder again without running
// the agent and does not append the record to the results file.
// Exit codes: 0 every run passes; 1 some run fails; 2 the case cannot be used.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  REPO_ROOT,
  appendResult,
  instructionsHash,
  listFiles,
  loadYamlMapping,
  parseCommonArgs,
  printSummary,
  recordHeader,
  runAgent,
} from './lib/case-common.mjs';
import { generateInstructions } from '../../yllir/scripts/lib/instructions.mjs';
import { ensureRepo, saveManualChanges, saveVersion, status } from '../../yllir/scripts/lib/versions.mjs';
import { checkLinks } from '../../yllir/skills/library/linker/scripts/lib/check-links.mjs';
import { parseYamlLite } from '../../yllir/scripts/lib/yaml-lite.mjs';

const USAGE =
  'usage: node testbench/runners/run-update-case.mjs <caseDir> [--runs N] [--model haiku] [--agent claude|codex] [--keep] [--setup-only] [--grade-only <dir> --run-json <file>]';
const AGENT_TIMEOUT_MS = 1800000;
const FIXTURE = path.join(REPO_ROOT, 'testbench', 'fixtures', 'morvalle', 'campaign');
const LEXICON = path.join(REPO_ROOT, 'yllir', 'skills', 'core', 'yllir', 'lexicon.md');
const PLUGIN_JSON = path.join(REPO_ROOT, 'yllir', '.claude-plugin', 'plugin.json');
const VERSION_PATH = '.campaign/version.yaml';
const AGENT_PATH = '.campaign/instructions/agent.md';
const CUSTOMIZATIONS_PATH = '.campaign/customizations.md';
const UPDATE_PATH = '.campaign/state/update.yaml';
const NOTICE_PATH = '.campaign/state/update-notice.yaml';
const OLD_VERSION = '0.0.1';
const V1_MESSAGE = 'Creata la campagna «Le ceneri della valle»';
const MANUAL_MESSAGE = 'Modifiche a mano prima della prova di aggiornamento';
const MASTER_LINE = 'Il master: «Teodo Marr non parla con gli stranieri prima del tramonto».';
const HAND_MARKER = 'riga-a-mano-4471';
const HAND_LINE = `Regola scritta a mano, da non perdere: ${HAND_MARKER}.`;
const NEWS =
  'La nuova versione rende più precisi i collegamenti tra personaggi e luoghi. ' +
  'Le sessioni già giocate restano come sono, e la tua campagna non cambia da sola.';
const SCENARIOS = ['stale-campaign', 'newer-published', 'declined'];
const CASE_SCENARIO = {
  'update-stale-campaign': 'stale-campaign',
  'update-newer-published': 'newer-published',
  'update-declined': 'declined',
};
const EXTRA_TECHNICAL_WORDS = ['framework', 'hash', 'fingerprint'];
const ACK_WORDS = ['domani', 'ricord', 'va bene', "d'accordo", 'nessun problema', 'certo', 'perfetto'];
const VERSION_RE = /\b\d+\.\d+\.\d+\b/g;

// ---------------------------------------------------------------- pure helpers

/** Parses and checks case.yaml data. Throws with the reason when the case cannot be used. */
export function parseCaseData(data) {
  for (const field of ['case', 'scenario', 'prompt']) {
    if (typeof data[field] !== 'string' || data[field].trim() === '') throw new Error(`case.yaml: ${field} missing`);
  }
  if (!SCENARIOS.includes(data.scenario)) throw new Error(`case.yaml: unknown scenario ${data.scenario}`);
  if (!(data.case in CASE_SCENARIO)) throw new Error(`case.yaml: unknown case ${data.case}`);
  if (CASE_SCENARIO[data.case] !== data.scenario) {
    throw new Error(`case.yaml: case ${data.case} needs scenario ${CASE_SCENARIO[data.case]}`);
  }
  return data;
}

/** The next minor version of MAJOR.MINOR.PATCH: 0.1.0 becomes 0.2.0. Throws on other input. */
export function nextMinorVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (match === null) throw new TypeError(`not a MAJOR.MINOR.PATCH version: ${version}`);
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

/** The text with the framework_version line set to version. Every other line stays as it is. */
export function setFrameworkVersion(text, version) {
  const line = /^framework_version: "[^"]*"$/gm;
  const hits = text.match(line) ?? [];
  if (hits.length !== 1) throw new Error(`version.yaml: framework_version line found ${hits.length} times`);
  return text.replace(line, `framework_version: "${version}"`);
}

/** The words the master must never see, from the "Never say" section of lexicon.md (same rule as run-entry-case). */
export function neverSayWords(lexiconText) {
  const start = lexiconText.indexOf('## Never say');
  if (start < 0) throw new Error('lexicon.md: "Never say" section missing');
  const rest = lexiconText.slice(start + '## Never say'.length);
  const next = rest.search(/^## /m);
  const section = (next < 0 ? rest : rest.slice(0, next)).trim();
  const paragraph = section.split('\n\n')[0].replace(/\([^)]*\)/g, '');
  const list = paragraph.slice(paragraph.indexOf(':') + 1).replace(/\.\s*$/, '');
  const words = list
    .split(',')
    .map((item) => item.trim().replace(/^and\s+/, '').trim())
    .filter((item) => item !== '' && !/terminal command/i.test(item));
  if (words.length === 0) throw new Error('lexicon.md: no words in "Never say"');
  return words;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when word occurs in text as a whole word, case-insensitive. */
function containsWord(text, word) {
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(word)}(?![\\p{L}\\p{N}_-])`, 'iu').test(text);
}

/** Typographic apostrophes become ASCII; the text is lower-cased. */
function normalized(text) {
  return text.replace(/[’‘]/g, "'").toLowerCase();
}

/**
 * Technical words in a message to the master: never-say words, the extra words of the
 * spec, backticks, saved-version codes (hexadecimal) and version numbers. Returns the findings.
 */
export function technicalFindings(report, words = neverSayWords(fs.readFileSync(LEXICON, 'utf8'))) {
  const findings = [];
  for (const word of [...words, ...EXTRA_TECHNICAL_WORDS]) {
    if (containsWord(report, word)) findings.push(`word: ${word}`);
  }
  if (report.includes('`')) findings.push('backtick');
  for (const match of report.matchAll(/(?<![\p{L}\p{N}])[0-9a-f]{7,40}(?![\p{L}\p{N}])/gu)) {
    if (/\d/.test(match[0]) && /\p{L}/u.test(match[0])) findings.push(`code: ${match[0]}`);
  }
  for (const match of report.matchAll(VERSION_RE)) findings.push(`version number: ${match[0]}`);
  return findings;
}

/** Paragraphs of a message: blocks separated by blank lines, trimmed, empty ones dropped. */
export function paragraphsOf(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

/** True when the text holds a question (a «?») and one of the words aggiorn… */
export function isUpdateQuestion(text) {
  return text.includes('?') && /aggiorn/i.test(text);
}

/** True when any sentence of the message is a question about updating. */
export function asksToUpdate(report) {
  return report
    .split(/(?<=[.!?])\s+|\n+/)
    .some((sentence) => isUpdateQuestion(sentence));
}

/** Reads framework_version from version.yaml text, or null. */
export function frameworkVersionOf(versionText) {
  if (typeof versionText !== 'string') return null;
  const parsed = parseYamlLite(versionText);
  if (parsed.errors.length > 0 || parsed.data === null || typeof parsed.data !== 'object') return null;
  return typeof parsed.data.framework_version === 'string' ? parsed.data.framework_version : null;
}

/** The fields of update-notice.yaml that matter, or null when the file is missing or unreadable. */
export function readNotice(dir) {
  const text = readText(dir, NOTICE_PATH);
  if (text === null) return null;
  const parsed = parseYamlLite(text);
  if (parsed.errors.length > 0 || parsed.data === null || typeof parsed.data !== 'object') return null;
  return {
    last_notified_on: typeof parsed.data.last_notified_on === 'string' ? parsed.data.last_notified_on : null,
    snoozed_until: typeof parsed.data.snoozed_until === 'string' ? parsed.data.snoozed_until : null,
  };
}

/** Today's date as YYYY-MM-DD in the local calendar and in UTC (the two date rules of the framework). */
export function todayDates(now = new Date()) {
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const utc = now.toISOString().slice(0, 10);
  return [...new Set([local, utc])];
}

// ---------------------------------------------------------------- grading helpers

/** A check result as the tuple [id, ok, reasons]. */
const result = (id, reasons) => [id, reasons.length === 0, reasons];

function readText(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, rel), 'utf8');
  } catch {
    return null;
  }
}

/** Runs git in dir without throwing: stdout, or null on failure. */
function tryGit(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

/** Number of commits of the campaign, NaN when git fails. */
function commitCount(dir) {
  return Number(tryGit(dir, ['rev-list', '--count', 'HEAD'])?.trim());
}

/** Reasons why the tree is not clean (git status), or none. */
function dirtyReasons(dir) {
  const out = tryGit(dir, ['status', '--porcelain']);
  if (out === null) return ['git status failed'];
  return out.trim() === '' ? [] : [`git status not empty: ${out.trim().split('\n').join(' | ')}`];
}

/** True when version.yaml still holds the text saved at setup. */
function versionUnchanged(dir, setup) {
  return readText(dir, VERSION_PATH) === setup.versionYamlText;
}

/** Stale campaign checks S1 to S6: the update ran silently and was saved, and the master's text is intact. */
export function gradeStale({ dir, setup, report }) {
  const s1 = [];
  const version = frameworkVersionOf(readText(dir, VERSION_PATH));
  if (version !== setup.installed) s1.push(`framework_version is ${version} (want ${setup.installed})`);

  const s2 = [];
  const agent = readText(dir, AGENT_PATH);
  if (agent === null) s2.push('agent.md is missing');
  else if (agent.includes(setup.marker)) s2.push('the hand-added line is still in agent.md');

  const s3 = [];
  if (readText(dir, CUSTOMIZATIONS_PATH) !== setup.customizationsText) s3.push('customizations.md changed');

  const s4 = [];
  const count = commitCount(dir);
  const want = setup.commits + 1;
  if (count !== want) s4.push(`commit count is ${Number.isNaN(count) ? 'unknown' : count} (want ${want})`);
  s4.push(...dirtyReasons(dir));

  const s5 = [];
  if (report === null || report === undefined) s5.push('no final message');
  else s5.push(...technicalFindings(report).map((f) => `technical word: ${f}`));

  const s6 = [];
  try {
    const { errors } = checkLinks(dir);
    for (const e of errors.slice(0, 5)) s6.push(`${e.file}:${e.line} ${e.code} ${e.message}`);
  } catch (err) {
    s6.push(`checkLinks: ${err.message}`);
  }
  return [result('S1', s1), result('S2', s2), result('S3', s3), result('S4', s4), result('S5', s5), result('S6', s6)];
}

/** Newer-published checks N1 to N6: the question is answered, the notice is recorded, nothing is updated. */
export function gradeNewer({ dir, setup, report, todays }) {
  const n1 = [];
  const n2 = [];
  const n3 = [];
  if (report === null || report === undefined) {
    n1.push('no final message');
    n2.push('no final message');
  } else {
    if (!normalized(report).includes('teodo')) n1.push('the final message does not answer the question about Teodo Marr');
    const paragraphs = paragraphsOf(report);
    const last = paragraphs[paragraphs.length - 1] ?? '';
    if (!isUpdateQuestion(last)) n2.push('the last paragraph has no question about updating');
    for (const paragraph of paragraphs.slice(0, -1)) {
      for (const match of paragraph.matchAll(VERSION_RE)) n3.push(`version number outside the last paragraph: ${match[0]}`);
    }
  }

  const n4 = [];
  const notice = readNotice(dir);
  if (notice === null) n4.push('update-notice.yaml is missing or unreadable');
  else if (!todays.includes(notice.last_notified_on)) {
    n4.push(`last_notified_on is ${notice.last_notified_on} (want one of ${todays.join(', ')})`);
  }

  const n5 = [];
  if (!versionUnchanged(dir, setup)) n5.push('version.yaml changed');
  const count = commitCount(dir);
  if (count !== setup.commits) n5.push(`a version was saved (commit count ${count}, want ${setup.commits})`);
  if (readText(dir, UPDATE_PATH) !== null) n5.push('an update was started (update.yaml exists)');

  const n6 = report === null || report === undefined ? ['no final message'] : technicalFindings(report).map((f) => `technical word: ${f}`);
  return [result('N1', n1), result('N2', n2), result('N3', n3), result('N4', n4), result('N5', n5), result('N6', n6)];
}

/** Declined checks D1 to D4: nothing is updated, the master is acknowledged, the update is not asked again. */
export function gradeDeclined({ dir, setup, report }) {
  const d1 = [];
  if (!versionUnchanged(dir, setup)) d1.push('version.yaml changed');
  const count = commitCount(dir);
  if (count !== setup.commits) d1.push(`a version was saved (commit count ${count}, want ${setup.commits})`);

  const d2 = [];
  const d3 = [];
  const d4 = [];
  if (report === null || report === undefined) {
    d2.push('no final message');
    d4.push('no final message');
  } else {
    const text = normalized(report);
    if (!ACK_WORDS.some((word) => text.includes(word))) d2.push('the final message does not acknowledge the postponement');
    if (asksToUpdate(report)) d3.push('the final message asks again to update now');
    d4.push(...technicalFindings(report).map((f) => `technical word: ${f}`));
  }
  return [result('D1', d1), result('D2', d2), result('D3', d3), result('D4', d4)];
}

/**
 * Grades one run of a scenario. Returns { checks, pass, failures, technical_found, notice }:
 * checks maps each check id to a boolean; notice is what update-notice.yaml holds (information only).
 */
export function gradeScenario({ scenario, dir, setup, report, todays }) {
  const grade = {
    'stale-campaign': () => gradeStale({ dir, setup, report }),
    'newer-published': () => gradeNewer({ dir, setup, report, todays }),
    declined: () => gradeDeclined({ dir, setup, report, todays }),
  }[scenario];
  if (grade === undefined) throw new Error(`no checks for scenario ${scenario}`);
  const checks = {};
  const failures = [];
  for (const [id, ok, reasons] of grade()) {
    checks[id] = ok === true;
    if (!ok) failures.push(`${id} ${reasons.length > 0 ? reasons.join('; ') : 'failed'}`);
  }
  return {
    checks,
    pass: Object.values(checks).every(Boolean),
    failures,
    technical_found: report === null || report === undefined ? null : technicalFindings(report),
    notice: readNotice(dir),
  };
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

function readInstalledVersion() {
  const version = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8')).version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('plugin.json has no version');
  return version;
}

/** A folder with the .claude-plugin/plugin.json and news of a newer version, for YLLIR_PUBLISHED_SOURCE. */
function makePublishedSource(installed) {
  const version = nextMinorVersion(installed);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-published-'));
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'yllir', version }, null, 2)}\n`);
  fs.mkdirSync(path.join(dir, 'news'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'news', `${version}.md`), `${NEWS}\n`);
  return { dir, version };
}

/**
 * Builds the morvalle campaign with instructions and one saved version, then the scenario's
 * changes. Returns { tmp, dir, setup, publishedDir }; setup holds what the grading compares with.
 * Throws when the setup cannot be made; the temporary folders are removed in that case.
 */
export function setupScenario(scenario) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-update-'));
  let publishedDir = null;
  try {
    const dir = path.join(tmp, 'campaign');
    fs.cpSync(FIXTURE, dir, { recursive: true });
    const installed = readInstalledVersion();
    withIsolatedGit(() => {
      const generated = generateInstructions(dir);
      if (generated.errors.length > 0) throw new Error(`generateInstructions: ${JSON.stringify(generated.errors)}`);
      ensureRepo(dir);
      const v1 = saveVersion(dir, { message: V1_MESSAGE, kind: 'framework' });
      if (!v1.saved) throw new Error('setup: version 1 was not saved');
      if (scenario === 'stale-campaign') {
        const versionPath = path.join(dir, VERSION_PATH);
        fs.writeFileSync(versionPath, setFrameworkVersion(fs.readFileSync(versionPath, 'utf8'), OLD_VERSION));
        fs.appendFileSync(path.join(dir, CUSTOMIZATIONS_PATH), `\n${MASTER_LINE}\n`);
        fs.appendFileSync(path.join(dir, AGENT_PATH), `\n${HAND_LINE}\n`);
        const saved = saveManualChanges(dir, MANUAL_MESSAGE);
        if (!saved.saved) throw new Error('setup: the changes before the update were not saved');
      }
      if (!status(dir).clean) throw new Error('setup: the tree is not clean after the setup');
    });
    const commits = Number(tryGit(dir, ['rev-list', '--count', 'HEAD'])?.trim());
    if (Number.isNaN(commits)) throw new Error('setup: git log failed');
    if (scenario !== 'stale-campaign') {
      const published = makePublishedSource(installed);
      publishedDir = published.dir;
    }
    const setup = {
      installed,
      commits,
      versionYamlText: fs.readFileSync(path.join(dir, VERSION_PATH), 'utf8'),
      customizationsText: fs.readFileSync(path.join(dir, CUSTOMIZATIONS_PATH), 'utf8'),
      marker: HAND_MARKER,
      published: publishedDir === null ? null : nextMinorVersion(installed),
    };
    return { tmp, dir, setup, publishedDir };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (publishedDir !== null) fs.rmSync(publishedDir, { recursive: true, force: true });
    throw err;
  }
}

/** Runs fn with YLLIR_PUBLISHED_SOURCE set to dir (or unset when dir is null), then restores it. */
function withPublishedSource(dir, fn) {
  const saved = process.env.YLLIR_PUBLISHED_SOURCE;
  if (dir === null) delete process.env.YLLIR_PUBLISHED_SOURCE;
  else process.env.YLLIR_PUBLISHED_SOURCE = dir;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.YLLIR_PUBLISHED_SOURCE;
    else process.env.YLLIR_PUBLISHED_SOURCE = saved;
  }
}

// ---------------------------------------------------------------- case files

function loadCase(caseDir) {
  return parseCaseData(loadYamlMapping(path.join(caseDir, 'case.yaml')));
}

/** The files that define the process under test (same set as the other runners). */
function instructionFiles() {
  const yllir = path.join(REPO_ROOT, 'yllir');
  const files = ['skills', 'agents', 'templates', 'hooks'].flatMap((dir) => listFiles(path.join(yllir, dir)));
  files.push(...listFiles(path.join(yllir, 'scripts'), { scriptsOnly: true }));
  return [...new Set(files)].filter((file) => !path.basename(file).startsWith('.'));
}

// ---------------------------------------------------------------- records and main

function makeRecord({ caseName, scenario, run, date, header, hash, agent, graded, setup, copy, gradeOnly }) {
  const agentFailure = agent && !agent.ok ? agent.error : null;
  const record = {
    case: caseName,
    scenario,
    run,
    date,
    ...header,
    instructions_hash: hash,
    permission_mode: agent ? agent.permission_mode : null,
    pass: graded.pass && !agentFailure,
    checks: graded.checks,
    failures: [...(agentFailure ? [`agent error: ${agentFailure}`] : []), ...graded.failures],
    technical_found: graded.technical_found,
    notice: graded.notice,
    published_version: setup?.published ?? null,
    report: agent ? agent.report : null,
    cost_usd: agent ? agent.cost_usd : null,
    duration_ms: agent ? agent.duration_ms : null,
    num_turns: agent ? agent.num_turns : null,
    denied: agent?.denied ?? [],
    tool_calls: agent?.tool_calls ?? null,
  };
  if (copy !== undefined) record.copy = copy;
  if (gradeOnly) record.grade_only = true;
  return record;
}

/** The record without the long report text, for the console. */
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
  const caseData = loadCase(opts.caseDir);
  const hash = instructionsHash(instructionFiles());
  const header = recordHeader({ agent: opts.agent, modelLabel: opts.modelLabel });
  const scenario = caseData.scenario;

  if (setupOnly) {
    const prepared = setupScenario(scenario);
    console.log(`dir: ${prepared.dir}`);
    console.log(`installed version: ${prepared.setup.installed}`);
    console.log(`saved versions (commits): ${prepared.setup.commits}`);
    if (prepared.publishedDir !== null) console.log(`published source: ${prepared.publishedDir} (version ${prepared.setup.published})`);
    console.log('git log:');
    console.log(tryGit(prepared.dir, ['log', '--format=%h %s']) ?? 'git log failed');
    return;
  }

  const gradeOnly = opts.values['--grade-only'];
  if (gradeOnly !== undefined) {
    const runJson = opts.values['--run-json'];
    if (runJson === undefined) throw new Error(`--grade-only needs --run-json <file>\n${USAGE}`);
    const dir = path.resolve(gradeOnly);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--grade-only: ${dir} is not a folder`);
    const saved = JSON.parse(fs.readFileSync(path.resolve(runJson), 'utf8'));
    const graded = gradeScenario({
      scenario,
      dir,
      setup: saved.setup,
      report: saved.report ?? null,
      todays: todayDates(),
    });
    const agent = saved.report === null || saved.report === undefined ? { ok: false, error: saved.error ?? 'no report' } : saved;
    const record = makeRecord({
      caseName: caseData.case,
      scenario,
      run: 1,
      date: new Date().toISOString(),
      header,
      hash,
      agent: { ...agent, ok: saved.error ? false : true, permission_mode: saved.permission_mode ?? null },
      graded,
      setup: saved.setup,
      copy: dir,
      gradeOnly: true,
    });
    console.log(JSON.stringify(consoleView(record)));
    process.exitCode = printSummary([record], opts.modelLabel, hash, opts.agent) === 1 ? 0 : 1;
    return;
  }

  const summaries = [];
  for (let i = 1; i <= opts.runs; i++) {
    const date = new Date().toISOString();
    const prepared = setupScenario(scenario);
    const { tmp, dir, setup, publishedDir } = prepared;
    let record;
    try {
      const agent = withPublishedSource(publishedDir, () =>
        runAgent({
          agent: opts.agent,
          cwd: dir,
          prompt: caseData.prompt,
          model: opts.model,
          modelGiven: opts.modelGiven,
          timeoutMs: AGENT_TIMEOUT_MS,
        }),
      );
      const graded = gradeScenario({
        scenario,
        dir,
        setup,
        report: agent.ok ? agent.report : null,
        todays: todayDates(),
      });
      record = makeRecord({
        caseName: caseData.case,
        scenario,
        run: i,
        date,
        header,
        hash,
        agent,
        graded,
        setup,
        copy: opts.keep ? dir : undefined,
      });
      if (opts.keep) {
        fs.writeFileSync(
          `${dir}.run.json`,
          JSON.stringify({
            report: agent.report,
            cost_usd: agent.cost_usd,
            duration_ms: agent.duration_ms,
            num_turns: agent.num_turns,
            denied: agent.denied,
            tool_calls: agent.tool_calls,
            error: agent.ok ? null : agent.error,
            permission_mode: agent.permission_mode,
            setup,
          }),
        );
      }
    } finally {
      if (opts.keep) {
        console.log(`kept run ${i}: ${dir}`);
      } else {
        fs.rmSync(tmp, { recursive: true, force: true });
        if (publishedDir !== null) fs.rmSync(publishedDir, { recursive: true, force: true });
      }
    }
    appendResult(caseData.case, record);
    console.log(JSON.stringify(consoleView(record)));
    summaries.push(record);
  }

  const passed = printSummary(summaries, opts.modelLabel, hash, opts.agent);
  process.exitCode = passed === summaries.length ? 0 : 1;
}

// Runs the CLI only when this file is the entry point, so the test file can import the helpers.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`run-update-case: ${err.message}`);
    process.exitCode = 2;
  }
}
