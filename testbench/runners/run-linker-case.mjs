#!/usr/bin/env node
// Runs one linker case end to end: copies the fixture campaign into a temporary
// git repository, runs the agent under test with `claude -p`, grades the result
// deterministically against the answer key, and appends one JSON line per run
// to testbench/results/<case>.jsonl.
//
// Usage: node testbench/runners/run-linker-case.mjs <caseDir> [--runs N] [--model haiku] [--keep]
// Exit codes: 0 every run passes; 1 some run fails; 2 the case or key cannot be used.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildSubjectIndex } from '../../yllir/scripts/lib/subjects.mjs';
import { scanMentions } from '../../yllir/scripts/lib/mentions.mjs';
import { parseYamlLite } from '../../yllir/scripts/lib/yaml-lite.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const RESULTS_DIR = path.join(REPO_ROOT, 'testbench', 'results');
const USAGE =
  'usage: node testbench/runners/run-linker-case.mjs <caseDir> [--runs N] [--model haiku] [--keep]';
const ALLOWED_TOOLS = 'Bash(node:*) Bash(mkdir:*) Bash(pwd) Read Write Grep Glob Agent';
const AGENT_TIMEOUT_MS = 900000;
const MAX_BUFFER = 64 * 1024 * 1024;
const LINK_RE = /\[([^\]]+)\]\(([^)]*)\)/g;

function parseArgs(argv) {
  const opts = { caseDir: null, runs: 3, model: 'haiku', keep: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs') {
      const value = argv[++i];
      if (value === undefined || !/^[1-9]\d*$/.test(value)) {
        throw new Error(`--runs needs a positive integer\n${USAGE}`);
      }
      opts.runs = Number(value);
    } else if (arg === '--model') {
      const value = argv[++i];
      if (value === undefined || value === '' || value.startsWith('--')) {
        throw new Error(`--model needs a value\n${USAGE}`);
      }
      opts.model = value;
    } else if (arg === '--keep') {
      opts.keep = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option ${arg}\n${USAGE}`);
    } else if (opts.caseDir === null) {
      opts.caseDir = path.resolve(arg);
    } else {
      throw new Error(USAGE);
    }
  }
  if (opts.caseDir === null) throw new Error(USAGE);
  return opts;
}

function parseFile(file) {
  const { data, errors } = parseYamlLite(fs.readFileSync(file, 'utf8'));
  if (errors.length > 0) throw new Error(`${file} line ${errors[0].line}: ${errors[0].message}`);
  if (data === null || typeof data !== 'object') throw new Error(`${file}: not a mapping`);
  return data;
}

function loadCase(caseDir) {
  const data = parseFile(path.join(caseDir, 'case.yaml'));
  for (const field of ['case', 'fixture', 'skill', 'prompt']) {
    if (typeof data[field] !== 'string') throw new Error(`case.yaml: ${field} missing`);
  }
  if (!Array.isArray(data.files) || data.files.length === 0 || !data.files.every((f) => typeof f === 'string')) {
    throw new Error('case.yaml: files must be a non-empty list of strings');
  }
  return data;
}

function loadKey(fixtureDir) {
  const data = parseFile(path.join(fixtureDir, 'key.yaml'));
  if (!Array.isArray(data.mentions)) throw new Error('key.yaml: mentions must be a list');
  if (!Array.isArray(data.subjects)) throw new Error('key.yaml: subjects must be a list');
  return data;
}

/** Recursively lists the *.mjs files under a folder, excluding *.test.mjs. */
function listScripts(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listScripts(full));
    } else if (entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs')) {
      found.push(full);
    }
  }
  return found;
}

/** sha256 (first 16 hex characters) of the instruction files, concatenated in path order. */
function instructionsHash() {
  const files = [
    path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'linker', 'SKILL.md'),
    path.join(REPO_ROOT, 'yllir', 'agents', 'linker-reviewer.md'),
    ...listScripts(path.join(REPO_ROOT, 'yllir', 'scripts')),
  ];
  const rel = (file) => path.relative(REPO_ROOT, file).split(path.sep).join('/');
  files.sort((a, b) => (rel(a) < rel(b) ? -1 : rel(a) > rel(b) ? 1 : 0));
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(fs.readFileSync(file));
  return hash.digest('hex').slice(0, 16);
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Copies the fixture campaign into a fresh temporary git repository. */
function prepareCopy(fixtureDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-case-'));
  const campaign = path.join(tmp, 'campaign');
  fs.cpSync(path.join(fixtureDir, 'campaign'), campaign, { recursive: true });
  git(campaign, ['init', '-q']);
  git(campaign, ['add', '-A']);
  git(campaign, ['-c', 'user.name=testbench', '-c', 'user.email=testbench@example.invalid', 'commit', '-qm', 'baseline']);
  return { tmp, campaign };
}

/** Runs the agent under test in the copy. Returns { report, cost_usd, duration_ms, num_turns } or throws. */
function runAgent(campaign, prompt, model) {
  const args = [
    '-p',
    prompt,
    '--plugin-dir',
    path.join(REPO_ROOT, 'yllir'),
    '--model',
    model,
    '--output-format',
    'json',
    '--allowedTools',
    ALLOWED_TOOLS,
  ];
  const stdout = execFileSync('claude', args, {
    cwd: campaign,
    encoding: 'utf8',
    timeout: AGENT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const data = JSON.parse(stdout);
  if (typeof data.result !== 'string') throw new Error('no result text in JSON output');
  return {
    report: data.result,
    cost_usd: typeof data.total_cost_usd === 'number' ? data.total_cost_usd : null,
    duration_ms: typeof data.duration_ms === 'number' ? data.duration_ms : null,
    num_turns: typeof data.num_turns === 'number' ? data.num_turns : null,
  };
}

/** Replaces every Markdown link wrapper [x](y) with x. */
function delinkAll(line) {
  return line.replace(LINK_RE, (_, label) => label);
}

/**
 * Removes link wrappers the agent added: a wrapper whose full text already
 * occurs in the original line is kept, every other one becomes its label.
 */
function delinkNew(newLine, originalLine) {
  return newLine.replace(LINK_RE, (whole, label) => (originalLine.includes(whole) ? whole : label));
}

/** Indexes of the lines whose text contains the snippet. */
function linesWith(lines, snippet) {
  const hits = [];
  lines.forEach((text, index) => {
    if (text.includes(snippet)) hits.push(index);
  });
  return hits;
}

function grade({ key, scope, fixtureCampaign, copy, report }) {
  const failures = [];
  const scopeSet = new Set(scope);
  const mentions = key.mentions.filter(
    (m) => m !== null && typeof m === 'object' && scopeSet.has(m.file),
  );

  // C1 only-scope-changed
  // -z: NUL-separated, paths never quoted (plain porcelain quotes names with spaces).
  // A rename or copy is followed by one more entry holding the old path.
  const entries = git(copy, ['status', '--porcelain', '-z']).split('\0');
  const strayPaths = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === '') continue;
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (code.includes('R') || code.includes('C')) i++;
    if (scopeSet.has(file) || file.startsWith('.campaign/')) continue;
    strayPaths.push(file);
  }
  const c1 = strayPaths.length === 0;
  if (!c1) failures.push(`C1 changed outside scope: ${strayPaths.join(', ')}`);

  // C2 structure-preserved, per scope file
  let c2 = true;
  const origByFile = new Map();
  const newByFile = new Map();
  for (const file of scope) {
    const orig = fs.readFileSync(path.join(fixtureCampaign, file), 'utf8').split('\n');
    const now = fs.readFileSync(path.join(copy, file), 'utf8').split('\n');
    origByFile.set(file, orig);
    newByFile.set(file, now);
    if (orig.length !== now.length) {
      c2 = false;
      failures.push(`C2 ${file} line count ${orig.length} -> ${now.length}`);
      continue;
    }
    const bad = [];
    for (let i = 0; i < orig.length; i++) {
      if (orig[i] === now[i]) continue;
      if (delinkNew(now[i], orig[i]) !== orig[i]) bad.push(i + 1);
    }
    if (bad.length > 0) {
      c2 = false;
      failures.push(`C2 ${file} non-link change at line ${bad.join(',')}`);
    }
  }

  // C3 expected-links, graded on the scanner output of the copy
  const index = buildSubjectIndex(copy);
  const scan = scanMentions(copy, index);
  const expectedLinks = mentions.filter((m) => m.expected === 'link');
  const consumed = new Set();
  const missing = [];
  let linked = 0;
  for (const m of expectedLinks) {
    const newLines = newByFile.get(m.file);
    const hits = linesWith(newLines.map(delinkAll), m.snippet);
    if (hits.length !== 1) {
      missing.push(m.id);
      continue;
    }
    const line = hits[0] + 1;
    const matched = scan.occurrences
      .filter((o) => o.file === m.file && o.line === line && o.subject === m.subject && o.state === 'linked')
      .sort((a, b) => a.col - b.col);
    let chosen;
    if (m.occurrence !== undefined) {
      chosen = matched[m.occurrence - 1];
    } else {
      chosen = matched.find((o) => !consumed.has(o));
    }
    if (chosen === undefined) {
      missing.push(m.id);
      continue;
    }
    consumed.add(chosen);
    linked += 1;
  }
  const c3 = `${linked}/${expectedLinks.length}`;
  if (missing.length > 0) failures.push(`C3 ${c3} missing ${missing.join(',')}`);

  // C4 untouched-lines: every line holding a mention that must not be linked
  const mustStay = mentions.filter((m) => m.expected !== 'link');
  const changedIds = [];
  for (const m of mustStay) {
    const origLines = origByFile.get(m.file);
    const newLines = newByFile.get(m.file);
    if (origLines === undefined) {
      changedIds.push(`${m.id}(no scope)`);
      continue;
    }
    const hits = linesWith(origLines, m.snippet);
    if (hits.length === 0) {
      changedIds.push(`${m.id}(snippet not found)`);
      continue;
    }
    if (hits.some((i) => origLines[i] !== newLines[i])) changedIds.push(m.id);
  }
  const c4 = changedIds.length === 0;
  if (!c4) failures.push(`C4 changed untouched lines: ${[...new Set(changedIds)].join(',')}`);

  // C5 decisions-reported
  const decisions = mentions.filter((m) => m.expected === 'ask' || m.expected === 'fix-link');
  const reportLower = report.toLowerCase();
  const undecided = [];
  for (const m of decisions) {
    const line = linesWith(origByFile.get(m.file), m.snippet)[0] + 1;
    const forms = new Set();
    const ids = [m.subject, ...(Array.isArray(m.candidates) ? m.candidates : [])];
    for (const id of ids) {
      const subject = key.subjects.find((s) => s !== null && typeof s === 'object' && s.id === id);
      for (const form of subject?.forms ?? []) forms.add(String(form));
    }
    for (const o of scan.occurrences) {
      if (o.file === m.file && o.line === line && o.text) forms.add(o.text);
    }
    const byLine = new RegExp(`:${line}(?!\\d)`).test(report);
    const byForm = [...forms].some((f) => reportLower.includes(f.toLowerCase()));
    if (!byLine && !byForm) undecided.push(`${m.id} ${m.file}:${line}`);
  }
  const c5 = undecided.length === 0;
  if (!c5) failures.push(`C5 not reported: ${undecided.join('; ')}`);

  // C6 report-status
  const c6 = report.includes('status: DONE');
  if (!c6) failures.push('C6 report does not contain "status: DONE"');

  const checks = { C1: c1, C2: c2, C3: c3, C4: c4, C5: c5, C6: c6 };
  const [a, b] = c3.split('/').map(Number);
  const pass = c1 && c2 && c4 && c5 && c6 && a === b;
  return { checks, pass, failures };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const caseDir = opts.caseDir;
  const caseData = loadCase(caseDir);
  const fixtureDir = path.join(REPO_ROOT, 'testbench', 'fixtures', caseData.fixture);
  const fixtureCampaign = path.join(fixtureDir, 'campaign');
  const key = loadKey(fixtureDir);
  const hash = instructionsHash();
  const resultFile = path.join(RESULTS_DIR, `${caseData.case}.jsonl`);
  const scope = caseData.files;

  const summaries = [];
  for (let i = 1; i <= opts.runs; i++) {
    const { tmp, campaign } = prepareCopy(fixtureDir);
    const date = new Date().toISOString();
    let record;
    try {
      let agent;
      try {
        agent = runAgent(campaign, caseData.prompt, opts.model);
      } catch (err) {
        const message = err.message.split('\n')[0];
        record = {
          case: caseData.case,
          run: i,
          date,
          model: opts.model,
          instructions_hash: hash,
          pass: false,
          checks: {},
          failures: [`agent error: ${message}`],
          report: null,
          cost_usd: null,
          duration_ms: null,
          num_turns: null,
        };
      }
      if (agent !== undefined) {
        const graded = grade({
          key,
          scope,
          fixtureCampaign,
          copy: campaign,
          report: agent.report,
        });
        record = {
          case: caseData.case,
          run: i,
          date,
          model: opts.model,
          instructions_hash: hash,
          pass: graded.pass,
          checks: graded.checks,
          failures: graded.failures,
          report: agent.report,
          cost_usd: agent.cost_usd,
          duration_ms: agent.duration_ms,
          num_turns: agent.num_turns,
        };
      }
    } finally {
      if (opts.keep) {
        console.log(`kept run ${i}: ${campaign}`);
      } else {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.appendFileSync(resultFile, `${JSON.stringify(record)}\n`);
    console.log(JSON.stringify(record));
    summaries.push(record);
  }

  const lines = summaries.map(
    (r) => `run ${r.run}: ${r.pass ? 'PASS' : 'FAIL'}${r.failures.length > 0 ? ` ${r.failures.join('; ')}` : ''}`,
  );
  const passed = summaries.filter((r) => r.pass).length;
  lines.push(`pass rate: ${passed}/${summaries.length}  model: ${opts.model}  instructions: ${hash}`);
  console.log(lines.join('\n'));
  process.exitCode = passed === summaries.length ? 0 : 1;
}

try {
  main();
} catch (err) {
  console.error(`run-linker-case: ${err.message}`);
  process.exitCode = 2;
}
