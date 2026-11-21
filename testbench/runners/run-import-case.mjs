#!/usr/bin/env node
// Runs the import/interrupted case end to end. The setup creates an empty Italian campaign with
// init-campaign.mjs, saves its baseline version and copies the case's input folder beside it, then
// writes a truncated PDF into the copy (makeTruncatedPdf: a valid one-page PDF cut after 45% of its
// bytes, so it cannot be opened). The agent (`claude -p`) gets the master's one request in the campaign
// folder. After the run the runner grades the campaign with deterministic checks only (no model). The
// key is read from cases/import/<name>/key.yaml and is never copied into the campaign or the input.
// One JSON line per run is appended to testbench/results/<case>.jsonl.
//
// Checks (see cases/import/interrupted/key.yaml for the meaning of each): I1 the kept source (a sources
// folder with a byte-identical copy of the original and a card.md); I2 the missing part is named in the
// final message; I3 the final message is never "complete" and says it is incomplete; I4 nothing invented
// in the transcriptions (a text original: every transcribed line is in the original; the PDF: no letters
// outside [illegible] markers); I5 the input folder is unchanged; I6 no campaign document holds a word of
// the cut part; I7 the saved state is clean (git status empty); L-time and L-calls from the limits.
//
// Usage: node testbench/runners/run-import-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep]
//        node testbench/runners/run-import-case.mjs <caseDir> --setup-only
//        node testbench/runners/run-import-case.mjs <caseDir> --grade-only <dir> --run-json <file>
// --setup-only builds the setup, prints { tmp, campaign, input } as JSON and exits 0 without calling the agent.
// --keep keeps the campaign folder (and the input copy beside it) and saves the agent result as <tmp>/run.json,
// so --grade-only grades the same run again without the agent. Exit codes: 0 every run passes; 1 some run
// fails; 2 the case or the key cannot be used.

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
import { ensureRepo, saveVersion } from '../../yllir/scripts/lib/versions.mjs';
import { parseYamlLite } from '../../yllir/scripts/lib/yaml-lite.mjs';

const USAGE =
  'usage: node testbench/runners/run-import-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep] [--setup-only] [--grade-only <dir> --run-json <file>]';
const AGENT_TIMEOUT_MS = 3600000;
const FIXTURES = path.join(REPO_ROOT, 'testbench', 'fixtures');
const INIT_SCRIPT = path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'new-campaign', 'scripts', 'init-campaign.mjs');
const INPUT_TOKEN = '{{INPUT_DIR}}';
const CAMPAIGN_NAME = 'La locanda del Tasso';
const BASE_MESSAGE = 'Creata la campagna «La locanda del Tasso»';
const PDF_NAME = 'mappa-del-porto.pdf';
const PDF_TEXT = 'Porto di Salvena - molo nord';
// Share of the PDF bytes that stay in the input: the rest is cut away and holds the words of PDF_TEXT.
const PDF_KEEP_RATIO = 0.45;
const KEY_FIELDS = ['kept_original', 'missing_names', 'cut_words', 'complete_words', 'incomplete_words'];
const LIST_KEY_FIELDS = ['missing_names', 'cut_words', 'complete_words', 'incomplete_words'];

// ---------------------------------------------------------------- the truncated PDF

/** A valid one-page PDF with PDF_TEXT in Helvetica. The text comes after a long filler, so the cut removes it. */
export function makeFullPdf() {
  const filler = '% layout filler, no text here\n'.repeat(40);
  const content = `${filler}BT /F1 24 Tf 72 720 Td (${PDF_TEXT}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  // Each entry is exactly 20 bytes: 10-digit offset, generation, type flag, and a two-byte end of line.
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** The same PDF cut after PDF_KEEP_RATIO of its bytes: it starts with %PDF- and has no %%EOF. */
export function makeTruncatedPdf() {
  const full = makeFullPdf();
  return Buffer.from(full.subarray(0, Math.floor(full.length * PDF_KEEP_RATIO)));
}

// ---------------------------------------------------------------- case and key

/** Reads and checks a key.yaml. Throws on a missing or wrongly typed field, or a regular expression that does not compile. */
export function validateKey(key) {
  for (const field of KEY_FIELDS) {
    if (key[field] === undefined) throw new Error(`key.yaml: ${field} missing`);
  }
  for (const field of LIST_KEY_FIELDS) {
    if (!Array.isArray(key[field]) || key[field].length === 0) throw new Error(`key.yaml: ${field} must be a non-empty list`);
  }
  if (typeof key.kept_original !== 'string' || key.kept_original === '') throw new Error('key.yaml: kept_original must be a text');
  for (const field of ['complete_words', 'incomplete_words']) {
    for (const pattern of key[field]) {
      try {
        new RegExp(pattern, 'i');
      } catch {
        throw new Error(`key.yaml: ${field} has a bad pattern: ${pattern}`);
      }
    }
  }
  return key;
}

/** Reads a case: case.yaml (prompt with the input token, runs, limits) and its key.yaml beside it. */
export function loadCase(caseDir) {
  const data = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  for (const field of ['case', 'fixture', 'prompt']) {
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

// ---------------------------------------------------------------- files

/** Every file under root as posix paths relative to root, without .git. */
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

/** The folder of the campaign's structure entry of type sources, or null (no entry, or an unreadable campaign.yaml). */
export function sourcesFolder(configText) {
  if (typeof configText !== 'string') return null;
  const { data, errors } = parseYamlLite(configText);
  if (errors.length > 0 || data === null) return null;
  const structure = Array.isArray(data.structure) ? data.structure : [];
  const entry = structure.find((item) => item && item.type === 'sources' && typeof item.folder === 'string');
  return entry ? entry.folder.replace(/\/+$/, '') : null;
}

/** Every file with the given base name under root (recursive, without .git). */
function filesNamed(root, name) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === name) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** The value of a `key: value` line of a card or a metadata block, without quotes, or null. */
function cardField(text, field) {
  const match = new RegExp(`^${field}:\\s*(.+?)\\s*$`, 'm').exec(text);
  return match ? match[1].replace(/^"(.*)"$/, '$1') : null;
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

/** Whitespace-folded text, so that a line break in a file does not count as a difference. */
function norm(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/** Subfolders of a folder, as absolute paths. */
function subfolders(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name));
}

/**
 * I1: a sources folder holds one folder with a card.md and a file that is a byte-identical copy of the
 * kept original. Returns the folder (absolute) or null.
 */
function keptCopyFolder(sourcesRoot, originalBytes) {
  if (!sourcesRoot || !fs.existsSync(sourcesRoot) || originalBytes === null) return null;
  for (const folder of subfolders(sourcesRoot)) {
    if (!fs.existsSync(path.join(folder, 'card.md'))) continue;
    for (const name of fs.readdirSync(folder)) {
      if (name === 'card.md' || name === 'transcription.md') continue;
      const file = path.join(folder, name);
      if (fs.statSync(file).isFile() && fs.readFileSync(file).equals(originalBytes)) return folder;
    }
  }
  return null;
}

/**
 * I4 for one transcription.md. Returns the list of failing lines (empty when the transcription is faithful).
 * A text original (any file read as text): every line is found in the original, after the [?: reading]
 * markers are replaced by their reading. A PDF original: no letters outside [illegible ...] markers.
 * [illegible] lines and remarks ([note: ...]) are not compared.
 */
function transcriptionProblems(transcriptionFile, inputDir, sourcesRoot) {
  const folder = path.dirname(transcriptionFile);
  const rel = path.relative(sourcesRoot, transcriptionFile).split(path.sep).join('/');
  const cardFile = path.join(folder, 'card.md');
  if (!fs.existsSync(cardFile)) return [`${rel}: no card.md beside it`];
  const originalName = cardField(fs.readFileSync(cardFile, 'utf8'), 'original_name');
  if (!originalName) return [`${rel}: card.md names no original_name`];
  const originalFile = path.join(inputDir, originalName);
  if (!fs.existsSync(originalFile)) return [`${rel}: original ${originalName} is not in the input`];
  const isPdf = path.extname(originalName).toLowerCase() === '.pdf';
  const originalText = isPdf ? '' : norm(fs.readFileSync(originalFile, 'utf8'));
  const problems = [];
  const lines = fs.readFileSync(transcriptionFile, 'utf8').split('\n');
  for (const line of lines) {
    const match = /^\[p(\d+):l(\d+)\] ?(.*)$/.exec(line.trim());
    if (!match) continue;
    const locator = `p${match[1]}:l${match[2]}`;
    const text = match[3];
    if (text.startsWith('[illegible')) continue;
    if (text.startsWith('[note:')) continue;
    if (isPdf) {
      const outside = text.replace(/\[illegible[^\]]*\]/g, '');
      if (/\p{L}/u.test(outside)) problems.push(`${rel} ${locator} has letters in a PDF with no reading to give`);
      continue;
    }
    const plain = norm(text.replace(/\[\?:\s*([^\]]*)\]/g, '$1'));
    if (!originalText.includes(plain)) problems.push(`${rel} ${locator} "${plain}" is not in ${originalName}`);
  }
  return problems;
}

/** Every file of the campaign, Markdown or not, with its path relative to the campaign (no .git). */
function campaignMarkdown(root) {
  return listRelFiles(root).filter((rel) => rel.endsWith('.md'));
}

/** The saved state is clean: the campaign is a git repository and `git status --porcelain` prints nothing. */
function savedClean(campaign) {
  if (!fs.existsSync(path.join(campaign, '.git'))) return { ok: false, reason: 'the campaign is not a git repository' };
  try {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: campaign, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim() === '' ? { ok: true, reason: '' } : { ok: false, reason: `uncommitted changes: ${out.trim().split('\n').join('; ')}` };
  } catch (err) {
    return { ok: false, reason: `git status failed: ${err.message.split('\n')[0]}` };
  }
}

// ---------------------------------------------------------------- grading

/**
 * Grades one import run. dir is the campaign after the run, inputDir the input copy (its files are
 * read for the original text and checked against setup.inputDigests, the digests taken at setup).
 * report is the final message (null when the run failed). Every check is deterministic.
 */
export function gradeImport({ dir, inputDir, setup, report, key, agentError = null }) {
  const list = [];
  if (agentError) list.push(check('AGENT', false, `agent error: ${agentError}`));

  const configFile = path.join(dir, 'campaign.yaml');
  const configText = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : null;
  const sourcesName = sourcesFolder(configText);
  const sourcesRoot = sourcesName ? path.join(dir, sourcesName) : null;
  const originalFile = path.join(inputDir, key.kept_original);
  const originalBytes = fs.existsSync(originalFile) ? fs.readFileSync(originalFile) : null;

  // I1: the kept source.
  const kept = keptCopyFolder(sourcesRoot, originalBytes);
  list.push(
    check(
      'I1',
      kept !== null,
      sourcesName === null
        ? 'campaign.yaml has no sources entry'
        : `no folder under ${sourcesName} holds a byte-identical ${key.kept_original} with a card.md`,
    ),
  );

  // I2: the missing part is named.
  const report2 = typeof report === 'string' ? report : '';
  const named = key.missing_names.some((name) => new RegExp(escapeRe(name), 'i').test(report2));
  list.push(check('I2', typeof report === 'string' && named, `the final message does not name the missing file (${key.missing_names.join(' or ')})`));

  // I3: never complete, and says it is incomplete.
  const complete = key.complete_words.find((pattern) => new RegExp(pattern, 'i').test(report2));
  const incomplete = key.incomplete_words.some((pattern) => new RegExp(pattern, 'i').test(report2));
  list.push(
    check(
      'I3',
      typeof report === 'string' && complete === undefined && incomplete,
      complete !== undefined
        ? `the final message declares the import complete (${complete})`
        : 'the final message does not say that the import is incomplete',
    ),
  );

  // I4: nothing invented in the transcriptions.
  const transcriptions = sourcesRoot ? filesNamed(sourcesRoot, 'transcription.md') : [];
  const problems = transcriptions.flatMap((file) => transcriptionProblems(file, inputDir, sourcesRoot));
  list.push(check('I4', problems.length === 0, problems.join('; ')));

  // I5: the input folder is unchanged.
  if (setup && setup.inputDigests) {
    list.push(check('I5', sameDigests(setup.inputDigests, folderDigests(inputDir)), 'the input folder changed'));
  } else {
    list.push(check('I5', false, 'no input digests were recorded at setup'));
  }

  // I6: the cut part is never in a campaign document.
  const cutHits = [];
  for (const rel of campaignMarkdown(dir)) {
    const text = fs.readFileSync(path.join(dir, rel), 'utf8').toLowerCase();
    for (const word of key.cut_words) {
      if (text.includes(word.toLowerCase())) cutHits.push(`${rel} holds "${word}"`);
    }
  }
  list.push(check('I6', cutHits.length === 0, cutHits.join('; ')));

  // I7: the framework saved what it wrote.
  const clean = savedClean(dir);
  list.push(check('I7', clean.ok, clean.reason));

  return finish(list);
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------- the setup

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
 * Creates the empty campaign (init-campaign.mjs, then a baseline saved version) in a temporary folder,
 * copies the input folder beside it and writes the truncated PDF into the copy. Records the digests of
 * the input after that, so I5 compares the run with what the agent was given. Returns the paths and digests.
 */
export function setupCase(inputDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-import-'));
  try {
    const campaign = path.join(tmp, 'campaign');
    const input = path.join(tmp, 'input');
    fs.cpSync(inputDir, input, { recursive: true });
    fs.writeFileSync(path.join(input, PDF_NAME), makeTruncatedPdf());
    execFileSync(process.execPath, [INIT_SCRIPT, campaign, '--name', CAMPAIGN_NAME, '--language', 'it', '--register', 'plain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const saved = withIsolatedGit(() => {
      ensureRepo(campaign);
      return saveVersion(campaign, { message: BASE_MESSAGE, kind: 'framework' });
    });
    if (!saved.saved) throw new Error('setup: the baseline version was not saved');
    return { tmp, campaign, input, inputDigests: folderDigests(input) };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

/** The files that define what is under test: the import and new-campaign skills, the core entry and the engine scripts. */
function instructionFiles() {
  const yllir = path.join(REPO_ROOT, 'yllir');
  const files = [
    ...listFiles(path.join(yllir, 'skills', 'library', 'import')),
    ...listFiles(path.join(yllir, 'skills', 'library', 'new-campaign')),
    ...listFiles(path.join(yllir, 'skills', 'core', 'yllir')),
    ...listFiles(path.join(yllir, 'scripts'), { scriptsOnly: true }),
  ];
  return [...new Set(files)];
}

// ---------------------------------------------------------------- the run

function makeRecord({ caseData, run, hash, opts, graded, agent, agentError, copy }) {
  return {
    case: caseData.case,
    run,
    date: new Date().toISOString(),
    ...recordHeader({ agent: opts.agent, modelLabel: opts.modelLabel }),
    instructions: hash,
    permission_mode: agent?.permission_mode ?? null,
    kind: caseData.kind,
    checks: graded.checks,
    failures: graded.failures,
    pass: graded.pass,
    limits: caseData.limits,
    cost_usd: agent?.cost_usd ?? null,
    duration_ms: agent?.duration_ms ?? null,
    tool_calls: agent?.tool_calls ?? null,
    error: agentError,
    report: agent?.report ?? null,
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
  const setupOnly = argv.includes('--setup-only');
  const opts = parseCommonArgs(
    argv.filter((arg) => arg !== '--setup-only'),
    USAGE,
    { valueOptions: ['--grade-only', '--run-json'] },
  );
  const caseData = loadCase(opts.caseDir);
  if (!argv.includes('--runs')) opts.runs = caseData.runs;

  if (setupOnly) {
    const setup = setupCase(caseData.inputDir);
    console.log(JSON.stringify({ tmp: setup.tmp, campaign: setup.campaign, input: setup.input }, null, 2));
    process.exitCode = 0;
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
    const agent = saved.agents[0] ?? null;
    const graded = applyLimits(
      gradeImport({
        dir,
        inputDir: path.join(path.dirname(dir), 'input'),
        setup: { inputDigests: saved.input_digests },
        report: saved.report ?? null,
        key: caseData.key,
        agentError: saved.agent_error ?? null,
      }),
      caseData.limits,
      saved.totals,
    );
    const record = makeRecord({ caseData, run: 1, hash, opts, graded, agent, agentError: saved.agent_error ?? null, copy: dir });
    console.log(JSON.stringify(consoleView(record)));
    process.exitCode = printSummary([record], opts.modelLabel, hash, opts.agent) === 1 ? 0 : 1;
    return;
  }

  const records = [];
  for (let run = 1; run <= opts.runs; run++) {
    const setup = setupCase(caseData.inputDir);
    const prompt = caseData.prompt.split(INPUT_TOKEN).join(setup.input);
    const agent = runAgent({ agent: opts.agent, cwd: setup.campaign, prompt, model: opts.model, timeoutMs: AGENT_TIMEOUT_MS });
    const agentError = agent.ok ? null : `turn 1: ${agent.error}`;
    const graded = applyLimits(
      gradeImport({
        dir: setup.campaign,
        inputDir: setup.input,
        setup,
        report: agent.ok ? agent.report : null,
        key: caseData.key,
        agentError,
      }),
      caseData.limits,
      { duration_ms: agent.duration_ms, tool_calls: agent.tool_calls },
    );
    if (opts.keep) {
      fs.writeFileSync(
        path.join(setup.tmp, 'run.json'),
        `${JSON.stringify(
          {
            report: agent.report,
            agent_error: agentError,
            agents: [agent],
            totals: { duration_ms: agent.duration_ms, tool_calls: agent.tool_calls, cost_usd: agent.cost_usd },
            input_digests: setup.inputDigests,
          },
          null,
          2,
        )}\n`,
      );
      console.error(`kept: ${setup.campaign} (run.json beside it)`);
    } else {
      fs.rmSync(setup.tmp, { recursive: true, force: true });
    }
    const record = makeRecord({ caseData, run, hash, opts, graded, agent, agentError, copy: opts.keep ? setup.campaign : null });
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
