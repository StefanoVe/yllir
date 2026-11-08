#!/usr/bin/env node
// Runs one linker case end to end: copies the fixture campaign into a temporary
// git repository, runs the agent under test with `claude -p`, grades the result
// deterministically against the answer key, and appends one JSON line per run
// to testbench/results/<case>.jsonl.
//
// Usage: node testbench/runners/run-linker-case.mjs <caseDir> [--runs N] [--model haiku] [--keep]
// Exit codes: 0 every run passes; 1 some run fails; 2 the case or key cannot be used.

import fs from 'node:fs';
import path from 'node:path';
import { buildSubjectIndex } from '../../yllir/scripts/lib/subjects.mjs';
import { scanMentions } from '../../yllir/scripts/lib/mentions.mjs';
import {
  REPO_ROOT,
  appendResult,
  changedFiles,
  instructionsHash,
  listFiles,
  loadYamlMapping,
  parseCommonArgs,
  prepareCopy,
  printSummary,
  removeCopy,
  runClaude,
} from './lib/case-common.mjs';

const USAGE =
  'usage: node testbench/runners/run-linker-case.mjs <caseDir> [--runs N] [--model haiku] [--keep]';
const AGENT_TIMEOUT_MS = 900000;
const LINK_RE = /\[([^\]]+)\]\(([^)]*)\)/g;

function loadCase(caseDir) {
  const data = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  for (const field of ['case', 'fixture', 'skill', 'prompt']) {
    if (typeof data[field] !== 'string') throw new Error(`case.yaml: ${field} missing`);
  }
  if (!Array.isArray(data.files) || data.files.length === 0 || !data.files.every((f) => typeof f === 'string')) {
    throw new Error('case.yaml: files must be a non-empty list of strings');
  }
  return data;
}

function loadKey(fixtureDir) {
  const data = loadYamlMapping(path.join(fixtureDir, 'key.yaml'));
  if (!Array.isArray(data.mentions)) throw new Error('key.yaml: mentions must be a list');
  if (!Array.isArray(data.subjects)) throw new Error('key.yaml: subjects must be a list');
  return data;
}

/** The files that define the linker under test. */
function linkerInstructionFiles() {
  return [
    ...listFiles(path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'linker')),
    path.join(REPO_ROOT, 'yllir', 'agents', 'linker-reviewer.md'),
    ...listFiles(path.join(REPO_ROOT, 'yllir', 'scripts'), { scriptsOnly: true }),
  ];
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

/** The LINKER REPORT the skill wrote in the copy, or null when the file is missing. */
function readLinkerReport(copy) {
  const file = path.join(copy, '.campaign', 'state', 'linker', 'report.txt');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function grade({ key, scope, fixtureCampaign, copy }) {
  const failures = [];
  const report = readLinkerReport(copy);
  const scopeSet = new Set(scope);
  const mentions = key.mentions.filter(
    (m) => m !== null && typeof m === 'object' && scopeSet.has(m.file),
  );

  // C1 only-scope-changed
  const strayPaths = changedFiles(copy).filter(
    (file) => !scopeSet.has(file) && !file.startsWith('.campaign/'),
  );
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
  const reportLower = (report ?? '').toLowerCase();
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
    const byLine = new RegExp(`:${line}(?!\\d)`).test(report ?? '');
    const byForm = [...forms].some((f) => reportLower.includes(f.toLowerCase()));
    if (!byLine && !byForm) undecided.push(`${m.id} ${m.file}:${line}`);
  }
  const c5 = report !== null && undecided.length === 0;
  if (report === null) failures.push('C5 no linker report file');
  else if (undecided.length > 0) failures.push(`C5 not reported: ${undecided.join('; ')}`);

  // C6 report-status
  const c6 = report !== null && report.includes('status: DONE');
  if (report === null) failures.push('C6 no linker report file');
  else if (!c6) failures.push('C6 report does not contain "status: DONE"');

  const checks = { C1: c1, C2: c2, C3: c3, C4: c4, C5: c5, C6: c6 };
  const [a, b] = c3.split('/').map(Number);
  const pass = c1 && c2 && c4 && c5 && c6 && a === b;
  return { checks, pass, failures, report };
}

function main() {
  const opts = parseCommonArgs(process.argv.slice(2), USAGE);
  const caseDir = opts.caseDir;
  const caseData = loadCase(caseDir);
  const fixtureDir = path.join(REPO_ROOT, 'testbench', 'fixtures', caseData.fixture);
  const fixtureCampaign = path.join(fixtureDir, 'campaign');
  const key = loadKey(fixtureDir);
  const hash = instructionsHash(linkerInstructionFiles());
  const scope = caseData.files;

  const summaries = [];
  for (let i = 1; i <= opts.runs; i++) {
    const campaign = prepareCopy(fixtureDir);
    const date = new Date().toISOString();
    let record;
    try {
      const agent = runClaude({
        cwd: campaign,
        prompt: caseData.prompt,
        model: opts.model,
        timeoutMs: AGENT_TIMEOUT_MS,
      });
      if (!agent.ok) {
        record = {
          case: caseData.case,
          run: i,
          date,
          model: opts.model,
          instructions_hash: hash,
          permission_mode: agent.permission_mode,
          pass: false,
          checks: {},
          failures: [`agent error: ${agent.error}`],
          report: null,
          final_message: null,
          cost_usd: null,
          duration_ms: null,
          num_turns: null,
        };
      } else {
        const graded = grade({
          key,
          scope,
          fixtureCampaign,
          copy: campaign,
        });
        record = {
          case: caseData.case,
          run: i,
          date,
          model: opts.model,
          instructions_hash: hash,
          permission_mode: agent.permission_mode,
          pass: graded.pass,
          checks: graded.checks,
          failures: graded.failures,
          report: graded.report,
          final_message: agent.report,
          cost_usd: agent.cost_usd,
          duration_ms: agent.duration_ms,
          num_turns: agent.num_turns,
        };
      }
    } finally {
      if (opts.keep) {
        console.log(`kept run ${i}: ${campaign}`);
      } else {
        removeCopy(campaign);
      }
    }
    appendResult(caseData.case, record);
    console.log(JSON.stringify(record));
    summaries.push(record);
  }

  const passed = printSummary(summaries, opts.model, hash);
  process.exitCode = passed === summaries.length ? 0 : 1;
}

try {
  main();
} catch (err) {
  console.error(`run-linker-case: ${err.message}`);
  process.exitCode = 2;
}
