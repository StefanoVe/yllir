#!/usr/bin/env node
// Runs one convert case end to end. The setup creates an empty campaign with init-campaign.mjs,
// saves its baseline version and copies the case's input folder beside it. The agent (`claude -p`)
// gets the master's request in the campaign folder and then the master's yes, in the same folder
// (two turns). After each turn the runner takes a snapshot of the campaign, and at the end it grades
// the snapshots against the case's answer key with deterministic checks only (no model). The key is
// read from cases/convert/<name>/key.yaml and is never copied into the campaign or the input.
// One JSON line per run is appended to testbench/results/<case>.jsonl.
//
// Checks (see cases/convert/basic/key.yaml for the meaning of each): O1 to O4 after turn 1 (the
// outline question, nothing saved, the outline sections, the session dates); W1 and D1 (saved, nothing
// deleted); E1 to En (every subject is written); H1 to H3 (two homonyms stay two documents); A1 and A2
// (the alias); C1 and C2 (the contradiction is reported, not decided); Y1 (a hypothesis is never an
// accusation); S1 to S3 (the master-only secret); U1 to U3 (the dated evening has its date, the undated
// one has none); I1 (the input folder is unchanged); L-time and L-calls from the limits.
//
// Usage: node testbench/runners/run-convert-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep]
//        node testbench/runners/run-convert-case.mjs <caseDir> --grade-only <dir> --run-json <file>
// --keep keeps the campaign folder and saves the snapshots, the agent results and the input check as
// <tmp>/run.json, so --grade-only grades the same run again without the agent.
// Exit codes: 0 every run passes; 1 some run fails; 2 the case or the key cannot be used.

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
import { ensureRepo, listVersions, saveVersion } from '../../yllir/scripts/lib/versions.mjs';
import { parseYamlLite } from '../../yllir/scripts/lib/yaml-lite.mjs';

const USAGE =
  'usage: node testbench/runners/run-convert-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep] [--grade-only <dir> --run-json <file>]';
const AGENT_TIMEOUT_MS = 3600000;
const FIXTURES = path.join(REPO_ROOT, 'testbench', 'fixtures');
const INIT_SCRIPT = path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'new-campaign', 'scripts', 'init-campaign.mjs');
const INPUT_TOKEN = '{{INPUT_DIR}}';
const CAMPAIGN_NAME = 'Le ceneri di Ardelmo';
const BASE_MESSAGE = 'Creata la campagna «Le ceneri di Ardelmo»';
const GENERATED_ROOT_FILES = ['CLAUDE.md', 'campaign.yaml'];
const KEY_FIELDS = [
  'subjects',
  'alias_subject',
  'alias_name',
  'homonym_name',
  'smith_word',
  'priest_word',
  'contradiction_place',
  'small_figure',
  'small_word',
  'large_figure',
  'large_word',
  'thief_words',
  'hedge_words',
  'secret_text',
  'dated_date',
  'undated_text',
  'outline_sections',
];
const LIST_KEY_FIELDS = ['subjects', 'thief_words', 'hedge_words', 'outline_sections'];
const EMPTY_SNAPSHOT = { report: null, versions_added: null, committed: [], outline: null, files: {} };

// ---------------------------------------------------------------- case and key

/** Reads and checks a key.yaml. Throws on a missing or wrongly typed field. */
export function validateKey(key) {
  for (const field of KEY_FIELDS) {
    if (key[field] === undefined) throw new Error(`key.yaml: ${field} missing`);
  }
  for (const field of LIST_KEY_FIELDS) {
    if (!Array.isArray(key[field]) || key[field].length === 0) throw new Error(`key.yaml: ${field} must be a non-empty list`);
  }
  for (const field of KEY_FIELDS.filter((f) => !LIST_KEY_FIELDS.includes(f))) {
    if (typeof key[field] !== 'string' || key[field] === '') throw new Error(`key.yaml: ${field} must be a text`);
  }
  return key;
}

/** Reads a case: case.yaml (prompt with the input token, reply, runs, limits) and its key.yaml beside it. */
export function loadCase(caseDir) {
  const data = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  for (const field of ['case', 'fixture', 'prompt', 'reply']) {
    if (typeof data[field] !== 'string') throw new Error(`case.yaml: ${field} missing`);
  }
  if (!data.prompt.includes(INPUT_TOKEN)) throw new Error(`case.yaml: prompt must hold ${INPUT_TOKEN}`);
  if (!Number.isInteger(data.runs) || data.runs < 1) throw new Error('case.yaml: runs must be a positive integer');
  const inputDir = path.join(FIXTURES, data.fixture);
  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    throw new Error(`case.yaml: fixture ${data.fixture} not found`);
  }
  const key = validateKey(loadYamlMapping(path.join(caseDir, 'key.yaml')));
  return { ...data, limits: parseLimits(data), key, inputDir };
}

// ---------------------------------------------------------------- snapshots

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Every file under root as repository-relative paths, without .git. */
export function listRelFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out;
}

/**
 * The folders that hold the sources. The convert process keeps each source as <SOURCES>/<id>/card.md,
 * so a folder is a sources folder when one of its sub-folders holds a card.md; a campaign.yaml structure
 * entry of type sources counts too.
 */
export function sourceFolders(all, configText = null) {
  const folders = new Set();
  for (const rel of all) {
    if (!rel.endsWith('/card.md')) continue;
    const folder = path.posix.dirname(path.posix.dirname(rel));
    if (folder !== '.' && folder !== '') folders.add(folder);
  }
  if (typeof configText === 'string') {
    try {
      const { data } = parseYamlLite(configText);
      const structure = Array.isArray(data?.structure) ? data.structure : [];
      for (const entry of structure) {
        if (entry && entry.type === 'sources' && typeof entry.folder === 'string') {
          folders.add(entry.folder.replace(/\/+$/, ''));
        }
      }
    } catch {
      // an unreadable campaign.yaml adds no folder; the card.md rule still applies
    }
  }
  return [...folders];
}

/**
 * The public text of a campaign: the Markdown documents, without the hidden folders (.campaign, .claude),
 * the generated root files and the sources folders. Returns { files: { rel: text }, sources: [folder] }.
 */
export function readPublicFiles(root) {
  const all = listRelFiles(root);
  const configFile = path.join(root, 'campaign.yaml');
  const configText = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : null;
  const sources = sourceFolders(all, configText);
  const files = {};
  for (const rel of all) {
    const segments = rel.split('/');
    if (segments.some((segment) => segment.startsWith('.'))) continue;
    if (!rel.endsWith('.md')) continue;
    if (segments.length === 1 && GENERATED_ROOT_FILES.includes(rel)) continue;
    if (sources.some((folder) => rel.startsWith(`${folder}/`))) continue;
    files[rel] = fs.readFileSync(path.join(root, rel), 'utf8');
  }
  return { files, sources };
}

/** The outline draft of the convert process, or null when it does not exist. */
function readOutline(root) {
  const file = path.join(root, '.campaign', 'drafts', 'outline.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

/** The changes saved since the baseline commit, as [{ status, path }]. */
function committedChanges(copy, baseline) {
  const out = git(copy, ['diff', '--name-status', '--no-renames', '-z', baseline, 'HEAD']);
  const tokens = out.split('\0').filter((token) => token !== '');
  const changes = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) changes.push({ status: tokens[i], path: tokens[i + 1] });
  return changes;
}

/** What the campaign holds after one turn: the final message, the versions added, the saved changes, the outline and the public text. */
export function snapshotConvert(copy, { baseline, versionsBefore, report }) {
  const pub = readPublicFiles(copy);
  return {
    report: report ?? null,
    versions_added: listVersions(copy, { limit: 500 }).length - versionsBefore,
    committed: committedChanges(copy, baseline),
    outline: readOutline(copy),
    files: pub.files,
    sources: pub.sources,
  };
}

/** sha256 of every file under a folder, by relative path. Identifies the input folder before and after the run. */
export function folderDigests(root) {
  const digests = {};
  for (const rel of listRelFiles(root)) {
    digests[rel] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
  }
  return digests;
}

/** True when two digest maps hold the same paths with the same bytes. */
export function sameDigests(a, b) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return JSON.stringify(ka) === JSON.stringify(kb) && ka.every((key) => a[key] === b[key]);
}

// ---------------------------------------------------------------- text helpers

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

/** Case-insensitive substring test. */
function has(text, word) {
  return typeof text === 'string' && text.toLowerCase().includes(String(word).toLowerCase());
}

/** A document's title: its file name and its first `# ` heading, folded into one string for matching. */
export function titleOf(rel, text) {
  const base = path.posix.basename(rel, '.md');
  const heading = typeof text === 'string' ? (text.split('\n').find((line) => /^# /.test(line)) ?? '') : '';
  return `${base} ${heading.replace(/^# /, '')}`;
}

/** The lines of a `## <title>` section of a Markdown text (up to the next `## `), or null when the section is missing. */
export function sectionOf(markdown, title) {
  if (typeof markdown !== 'string') return null;
  let found = false;
  const out = [];
  for (const line of markdown.split('\n')) {
    const heading = /^##\s+(.*?)\s*$/.exec(line);
    if (heading) {
      if (found) break;
      found = heading[1].toLowerCase() === title.toLowerCase();
      continue;
    }
    if (found) out.push(line);
  }
  return found ? out.join('\n') : null;
}

/** The [start, end] line indexes of every master-only block (`<!-- master -->` ... `<!-- /master -->`). */
export function masterSpans(lines) {
  const spans = [];
  let start = -1;
  lines.forEach((line, index) => {
    const t = line.trim();
    if (t === '<!-- master -->') start = index;
    else if (t === '<!-- /master -->' && start >= 0) {
      spans.push([start, index]);
      start = -1;
    }
  });
  return spans;
}

/** True when a figure appears as a whole number (not inside a longer number) or as its word. */
function figureIn(text, figure, word) {
  const number = new RegExp(`(^|[^0-9])${figure}([^0-9]|$)`);
  return number.test(text) || has(text, word);
}

/** The whole numbers and ISO dates of a text. */
function dateTokens(text) {
  return text.match(/\b\d{4}(?:-\d{2}-\d{2})?\b/g) ?? [];
}

/** True when the file name is the dated chronicle page of the date: <date>.md or <date>-<letters>.md. */
export function isDatedPage(rel, date) {
  const base = path.posix.basename(rel);
  return new RegExp(`^${date}(-[a-z]+)?\\.md$`).test(base);
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------- grading

/**
 * Grades one run against the key. turn1 is the snapshot after the master's request, turn2 after the
 * master's yes (null when the run stopped earlier). Every check is deterministic; the agent judges nothing here.
 */
export function gradeConvert({ key, turn1, turn2, inputUnchanged, agentError = null }) {
  const t1 = turn1 ?? EMPTY_SNAPSHOT;
  const t2 = turn2 ?? EMPTY_SNAPSHOT;
  const files = Object.entries(t2.files ?? {});
  const list = [];
  if (agentError) list.push(check('AGENT', false, `agent error: ${agentError}`));

  // Turn 1: the outline, before the yes.
  const outline1 = t1.outline;
  list.push(check('O1', endsWithQuestion(t1.report), 'the first message does not end with a question'));
  list.push(check('O2', t1.versions_added === 0, `${t1.versions_added} version(s) saved in turn 1`));
  const missing = key.outline_sections.filter((title) => sectionOf(outline1, title) === null);
  list.push(
    check('O3', outline1 !== null && missing.length === 0, outline1 === null ? 'no outline draft' : `outline lacks ${missing.join(', ')}`),
  );
  const sessionDates = dateTokens(sectionOf(outline1, 'Sessions') ?? '');
  const otherDates = sessionDates.filter((date) => date !== key.dated_date);
  list.push(
    check(
      'O4',
      sessionDates.includes(key.dated_date) && otherDates.length === 0,
      `session dates in the outline: ${sessionDates.join(', ') || 'none'}`,
    ),
  );

  // Turn 2: the campaign after the yes.
  list.push(
    check('W1', t2.versions_added !== null && t2.versions_added >= 1, `${t2.versions_added} version(s) saved in turn 2`),
  );
  const deleted = t2.committed.filter((change) => change.status.startsWith('D'));
  list.push(check('D1', deleted.length === 0, `deleted: ${deleted.map((change) => change.path).join(', ')}`));

  key.subjects.forEach((name, index) => {
    const named = files.some(([rel, text]) => has(titleOf(rel, text), name));
    list.push(check(`E${index + 1}`, named, `no document is named ${name}`));
  });

  // Homonyms: two people with the same name stay two documents.
  const homonym = files.filter(([rel, text]) => has(titleOf(rel, text), key.homonym_name));
  const smithRel = homonym.find(([, text]) => has(text, key.smith_word))?.[0] ?? null;
  const priestRel = homonym.find(([rel, text]) => rel !== smithRel && has(text, key.priest_word))?.[0] ?? null;
  list.push(check('H1', homonym.length >= 2, `${homonym.length} document(s) about ${key.homonym_name}`));
  list.push(
    check('H2', smithRel !== null && priestRel !== null, `smith document: ${smithRel ?? 'none'}; priest document: ${priestRel ?? 'none'}`),
  );
  const merged = homonym.filter(([, text]) => has(text, key.smith_word) && has(text, key.priest_word));
  list.push(check('H3', merged.length === 0, `a document holds both people: ${merged.map(([rel]) => rel).join(', ')}`));

  // Alias: one person under two names.
  const captain = files.filter(([rel, text]) => has(titleOf(rel, text), key.alias_subject));
  list.push(check('A1', captain.some(([, text]) => has(text, key.alias_name)), `the ${key.alias_subject} document does not say ${key.alias_name}`));
  const aliasTitled = files.filter(
    ([rel, text]) => has(titleOf(rel, text), key.alias_name) && !has(titleOf(rel, text), key.alias_subject),
  );
  list.push(check('A2', aliasTitled.length === 0, `separate documents: ${aliasTitled.map(([rel]) => rel).join(', ')}`));

  // Contradiction: reported, not decided.
  const figures = (text) => ({
    place: has(text, key.contradiction_place),
    small: figureIn(text, key.small_figure, key.small_word),
    large: figureIn(text, key.large_figure, key.large_word),
  });
  const contradictionSection = figures(sectionOf(t2.outline ?? outline1, 'Contradictions') ?? '');
  list.push(
    check(
      'C1',
      contradictionSection.place && contradictionSection.small && contradictionSection.large,
      `the outline's Contradictions section lacks ${key.contradiction_place} with both figures`,
    ),
  );
  const report2 = figures(t2.report ?? '');
  list.push(
    check('C2', report2.place && report2.small && report2.large, `the final message lacks ${key.contradiction_place} with both figures`),
  );

  // Hypothesis: an uncertain statement is never an accusation (public text and both messages).
  const thief = new RegExp(key.thief_words.map(escapeRe).join('|'), 'i');
  const hedge = new RegExp(key.hedge_words.map(escapeRe).join('|'), 'i');
  const unhedged = [];
  for (const [rel, text] of files) {
    text.split('\n').forEach((line, index) => {
      if (thief.test(line) && !hedge.test(line)) unhedged.push(`${rel}:${index + 1}`);
    });
  }
  for (const [label, report] of [
    ['first message', t1.report],
    ['final message', t2.report],
  ]) {
    if (typeof report !== 'string') continue;
    report.split('\n').forEach((line, index) => {
      if (thief.test(line) && !hedge.test(line)) unhedged.push(`${label}:${index + 1}`);
    });
  }
  list.push(check('Y1', unhedged.length === 0, `unhedged thief line: ${unhedged.join(', ')}`));

  // Secret: master-only text only.
  const secret = new RegExp(escapeRe(key.secret_text), 'i');
  const outside = [];
  let inside = 0;
  for (const [rel, text] of files) {
    const lines = text.split('\n');
    const spans = masterSpans(lines);
    lines.forEach((line, index) => {
      if (!secret.test(line)) return;
      if (spans.some(([start, end]) => index > start && index < end)) inside += 1;
      else outside.push(`${rel}:${index + 1}`);
    });
  }
  list.push(check('S1', outside.length === 0, `secret outside a master block: ${outside.join(', ')}`));
  list.push(check('S2', inside > 0, 'no master block holds the secret'));
  list.push(
    check('S3', ![t1.report, t2.report].some((report) => typeof report === 'string' && secret.test(report)), 'the secret is in a message to the master'),
  );

  // Sessions: the dated evening has its date; the undated one has none.
  const datedPages = files.filter(([rel]) => isDatedPage(rel, key.dated_date));
  list.push(
    check(
      'U1',
      datedPages.some(([, text]) => /lanterna|fenvale|varn|oddo/i.test(text)),
      `no chronicle page dated ${key.dated_date} about the evening`,
    ),
  );
  const undated = files.filter(([, text]) => has(text, key.undated_text));
  const namedWithDate = undated.filter(([rel]) => /^\d{4}-\d{2}-\d{2}/.test(path.posix.basename(rel)));
  const textWithDate = undated.filter(([, text]) => /\b\d{4}-\d{2}-\d{2}\b/.test(text));
  list.push(
    check(
      'U2',
      namedWithDate.length === 0 && textWithDate.length === 0,
      `invented date in: ${[...namedWithDate, ...textWithDate].map(([rel]) => rel).join(', ')}`,
    ),
  );
  list.push(check('U3', /dat[ae]|senza data/i.test(t2.report ?? ''), 'the final message does not say that the undated evening waits for a date'));

  list.push(check('I1', inputUnchanged === true, 'the input folder changed'));
  return finish(list);
}

// ---------------------------------------------------------------- the run

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
 * Creates the empty campaign (init-campaign.mjs, then a baseline saved version) in a temporary folder and
 * copies the input folder beside it. Returns the paths and the baseline commit.
 */
export function setupRun(inputDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-convert-'));
  try {
    const campaign = path.join(tmp, 'campaign');
    const input = path.join(tmp, 'input');
    fs.cpSync(inputDir, input, { recursive: true });
    execFileSync(process.execPath, [INIT_SCRIPT, campaign, '--name', CAMPAIGN_NAME, '--language', 'it', '--register', 'plain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const saved = withIsolatedGit(() => {
      ensureRepo(campaign);
      return saveVersion(campaign, { message: BASE_MESSAGE, kind: 'framework' });
    });
    if (!saved.saved) throw new Error('setup: the baseline version was not saved');
    const baseline = git(campaign, ['rev-parse', 'HEAD']).trim();
    return {
      tmp,
      campaign,
      input,
      baseline,
      versionsBefore: listVersions(campaign, { limit: 500 }).length,
      inputDigests: folderDigests(input),
    };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

/** The files that define what is under test: the convert and import skills, the core entry and the engine scripts. */
function instructionFiles() {
  const yllir = path.join(REPO_ROOT, 'yllir');
  const files = [
    ...listFiles(path.join(yllir, 'skills', 'library', 'convert-campaign')),
    ...listFiles(path.join(yllir, 'skills', 'library', 'import')),
    ...listFiles(path.join(yllir, 'skills', 'library', 'new-campaign')),
    ...listFiles(path.join(yllir, 'skills', 'core', 'yllir')),
    ...listFiles(path.join(yllir, 'scripts'), { scriptsOnly: true }),
  ];
  return [...new Set(files)];
}

/** Runs one case once: the two turns, the snapshots, the input check and the grade. */
function runOnce(caseData, opts) {
  const setup = setupRun(caseData.inputDir);
  const prompt1 = caseData.prompt.split(INPUT_TOKEN).join(setup.input);
  const common = { agent: opts.agent, cwd: setup.campaign, model: opts.model, modelGiven: opts.modelGiven, timeoutMs: AGENT_TIMEOUT_MS };
  const agents = [];
  const snaps = [];
  let agentError = null;
  const first = runAgent({ ...common, prompt: prompt1 });
  agents.push(first);
  if (!first.ok) {
    agentError = `turn 1: ${first.error}`;
  } else {
    snaps.push(snapshotConvert(setup.campaign, { baseline: setup.baseline, versionsBefore: setup.versionsBefore, report: first.report }));
    const second = runAgent({ ...common, prompt: caseData.reply, continueConversation: true });
    agents.push(second);
    if (!second.ok) agentError = `turn 2: ${second.error}`;
    else snaps.push(snapshotConvert(setup.campaign, { baseline: setup.baseline, versionsBefore: setup.versionsBefore, report: second.report }));
  }
  const inputUnchanged = sameDigests(setup.inputDigests, folderDigests(setup.input));
  const graded = gradeConvert({ key: caseData.key, turn1: snaps[0] ?? null, turn2: snaps[1] ?? null, inputUnchanged, agentError });
  const totals = {
    duration_ms: sumOf(agents.map((a) => a.duration_ms)),
    tool_calls: sumOf(agents.map((a) => a.tool_calls)),
    cost_usd: sumOf(agents.map((a) => a.cost_usd)),
  };
  return { setup, graded: applyLimits(graded, caseData.limits, totals), snaps, agents, totals, agentError, inputUnchanged };
}

function sumOf(values) {
  return values.every((value) => typeof value === 'number') ? values.reduce((a, b) => a + b, 0) : null;
}

function makeRecord({ caseData, run, hash, opts, graded, agents, totals, agentError, copy }) {
  return {
    case: caseData.case,
    run,
    date: new Date().toISOString(),
    ...recordHeader({ agent: opts.agent, modelLabel: opts.modelLabel }),
    instructions: hash,
    permission_mode: agents[0]?.permission_mode ?? null,
    kind: caseData.key.kind ?? caseData.kind,
    checks: graded.checks,
    failures: graded.failures,
    pass: graded.pass,
    limits: caseData.limits,
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

// ---------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const opts = parseCommonArgs(argv, USAGE, { valueOptions: ['--grade-only', '--run-json'] });
  const caseData = loadCase(opts.caseDir);
  if (!argv.includes('--runs')) opts.runs = caseData.runs;
  const hash = instructionsHash(instructionFiles());

  const gradeOnly = opts.values['--grade-only'];
  if (gradeOnly !== undefined) {
    const runJson = opts.values['--run-json'];
    if (runJson === undefined) throw new Error(`--grade-only needs --run-json <file>\n${USAGE}`);
    const dir = path.resolve(gradeOnly);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--grade-only: ${dir} is not a folder`);
    const saved = JSON.parse(fs.readFileSync(path.resolve(runJson), 'utf8'));
    const graded = applyLimits(
      gradeConvert({
        key: caseData.key,
        turn1: saved.snaps[0] ?? null,
        turn2: saved.snaps[1] ?? null,
        inputUnchanged: saved.input_unchanged === true,
        agentError: saved.agent_error ?? null,
      }),
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
      copy: opts.keep ? one.setup.campaign : null,
    });
    if (opts.keep) {
      const runFile = path.join(one.setup.tmp, 'run.json');
      fs.writeFileSync(
        runFile,
        `${JSON.stringify({ snaps: one.snaps, agents: one.agents, totals: one.totals, agent_error: one.agentError, input_unchanged: one.inputUnchanged }, null, 2)}\n`,
      );
      console.error(`kept: ${one.setup.campaign} (run.json beside it)`);
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
