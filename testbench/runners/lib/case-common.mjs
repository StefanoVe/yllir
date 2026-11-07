// Shared helpers for the testbench case runners: argument parsing, the temporary
// git copy an agent works in, the `claude -p` call, the hash of the instructions
// under test, the JSONL record and the printed summary. Built-ins only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseYamlLite } from '../../../yllir/scripts/lib/yaml-lite.mjs';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const RESULTS_DIR = path.join(REPO_ROOT, 'testbench', 'results');
const MAX_BUFFER = 64 * 1024 * 1024;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Parses --runs, --model and --keep, plus the extra value options listed in
 * valueOptions (their values go to opts.values). Throws with the usage text.
 */
export function parseCommonArgs(argv, usage, { valueOptions = [] } = {}) {
  const opts = { caseDir: null, runs: 3, model: 'haiku', keep: false, values: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs') {
      const value = argv[++i];
      if (value === undefined || !/^[1-9]\d*$/.test(value)) {
        throw new Error(`--runs needs a positive integer\n${usage}`);
      }
      opts.runs = Number(value);
    } else if (arg === '--model') {
      const value = argv[++i];
      if (value === undefined || value === '' || value.startsWith('--')) {
        throw new Error(`--model needs a value\n${usage}`);
      }
      opts.model = value;
    } else if (arg === '--keep') {
      opts.keep = true;
    } else if (valueOptions.includes(arg)) {
      const value = argv[++i];
      if (value === undefined || value === '' || value.startsWith('--')) {
        throw new Error(`${arg} needs a value\n${usage}`);
      }
      opts.values[arg] = value;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option ${arg}\n${usage}`);
    } else if (opts.caseDir === null) {
      opts.caseDir = path.resolve(arg);
    } else {
      throw new Error(usage);
    }
  }
  if (opts.caseDir === null) throw new Error(usage);
  return opts;
}

/** Reads a YAML file that must hold a mapping. Throws on syntax errors. */
export function loadYamlMapping(file) {
  const { data, errors } = parseYamlLite(fs.readFileSync(file, 'utf8'));
  if (errors.length > 0) throw new Error(`${file} line ${errors[0].line}: ${errors[0].message}`);
  if (data === null || typeof data !== 'object') throw new Error(`${file}: not a mapping`);
  return data;
}

/**
 * Recursively lists the files under a folder, excluding *.test.mjs.
 * With scriptsOnly, only *.mjs files are listed.
 */
export function listFiles(dir, { scriptsOnly = false } = {}) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listFiles(full, { scriptsOnly }));
    } else if (entry.name.endsWith('.test.mjs')) {
      continue;
    } else if (!scriptsOnly || entry.name.endsWith('.mjs')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * sha256 (first 16 hex characters) of the given files, concatenated in
 * repository-relative path order. Identifies the instructions under test.
 */
export function instructionsHash(files) {
  const rel = (file) => path.relative(REPO_ROOT, file).split(path.sep).join('/');
  const sorted = [...files].sort((a, b) => (rel(a) < rel(b) ? -1 : rel(a) > rel(b) ? 1 : 0));
  const hash = crypto.createHash('sha256');
  for (const file of sorted) hash.update(fs.readFileSync(file));
  return hash.digest('hex').slice(0, 16);
}

/**
 * Creates an empty temporary folder (no git) for a case that starts from nothing,
 * and returns its path. Remove it with fs.rmSync(path, { recursive: true, force: true }).
 */
export function prepareEmpty() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-case-'));
}

/**
 * Copies the fixture campaign into a fresh temporary git repository, commits
 * it as the baseline and returns the path of the copy (the folder `campaign`
 * inside the temporary folder). Remove it with removeCopy.
 */
export function prepareCopy(fixtureDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-case-'));
  const campaign = path.join(tmp, 'campaign');
  fs.cpSync(path.join(fixtureDir, 'campaign'), campaign, { recursive: true });
  git(campaign, ['init', '-q']);
  git(campaign, ['add', '-A']);
  git(campaign, ['-c', 'user.name=testbench', '-c', 'user.email=testbench@example.invalid', 'commit', '-qm', 'baseline']);
  return campaign;
}

/** Removes a copy made by prepareCopy together with its temporary folder. */
export function removeCopy(campaign) {
  fs.rmSync(path.dirname(campaign), { recursive: true, force: true });
}

/**
 * Runs the agent under test with `claude -p` in cwd. Never throws: the result
 * is { ok, report, cost_usd, duration_ms, num_turns, error }, where error is
 * the first line of the failure message when ok is false.
 */
export function runClaude({
  cwd,
  prompt,
  model,
  allowedTools,
  timeoutMs,
  pluginDir = path.join(REPO_ROOT, 'yllir'),
  continueConversation = false,
}) {
  const args = [
    '-p',
    prompt,
    '--plugin-dir',
    pluginDir,
    '--model',
    model,
    '--output-format',
    'json',
    ...(continueConversation ? ['--continue'] : []),
    '--allowedTools',
    allowedTools,
  ];
  try {
    const stdout = execFileSync('claude', args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const data = JSON.parse(stdout);
    if (typeof data.result !== 'string') throw new Error('no result text in JSON output');
    const num = (value) => (typeof value === 'number' ? value : null);
    return {
      ok: true,
      report: data.result,
      cost_usd: num(data.total_cost_usd),
      duration_ms: num(data.duration_ms),
      num_turns: num(data.num_turns),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      report: null,
      cost_usd: null,
      duration_ms: null,
      num_turns: null,
      error: err.message.split('\n')[0],
    };
  }
}

/**
 * Paths changed in the git repository at copy (staged, unstaged or untracked),
 * as repository-relative paths. Untracked folders appear with a trailing slash.
 */
export function changedFiles(copy) {
  // -z: NUL-separated, paths never quoted (plain porcelain quotes names with spaces).
  // A rename or copy is followed by one more entry holding the old path.
  const entries = git(copy, ['status', '--porcelain', '-z']).split('\0');
  const files = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === '') continue;
    const code = entry.slice(0, 2);
    files.push(entry.slice(3));
    if (code.includes('R') || code.includes('C')) i++;
  }
  return files;
}

/** 1-based line of the only line of text that contains snippet, or null when 0 or 2+ lines match. */
export function locateSnippet(text, snippet) {
  const hits = [];
  text.split('\n').forEach((line, index) => {
    if (line.includes(snippet)) hits.push(index + 1);
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Appends one JSON record to testbench/results/<caseName>.jsonl. Returns the file path. */
export function appendResult(caseName, record) {
  const file = path.join(RESULTS_DIR, `${caseName}.jsonl`);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  return file;
}

/** Prints one line per run, then the pass rate. Returns the number of passing runs. */
export function printSummary(results, model, hash) {
  const lines = results.map(
    (r) => `run ${r.run}: ${r.pass ? 'PASS' : 'FAIL'}${r.failures.length > 0 ? ` ${r.failures.join('; ')}` : ''}`,
  );
  const passed = results.filter((r) => r.pass).length;
  lines.push(`pass rate: ${passed}/${results.length}  model: ${model}  instructions: ${hash}`);
  console.log(lines.join('\n'));
  return passed;
}
