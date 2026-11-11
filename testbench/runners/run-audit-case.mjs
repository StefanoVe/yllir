#!/usr/bin/env node
// Runs one continuity-audit case end to end: copies the fixture campaign into a
// temporary git repository, runs the audit skill with `claude -p`, grades what it left in .campaign/state/audit/ against the
// answer key, and appends one JSON line per run to testbench/results/<case>.jsonl.
//
// Usage: node testbench/runners/run-audit-case.mjs <caseDir> [--runs N] [--model haiku] [--keep] [--agent claude]
//        node testbench/runners/run-audit-case.mjs <caseDir> --grade-only <copyPath>
// --grade-only grades an existing copy (kept with --keep) without running the agent,
// prints the record and does not append it to the results file.
// Exit codes: 0 every run passes; 1 some run fails; 2 the case or key cannot be used.

import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT,
  appendResult,
  changedFiles,
  instructionsHash,
  listFiles,
  loadYamlMapping,
  locateSnippet,
  parseCommonArgs,
  prepareCopy,
  printSummary,
  recordHeader,
  removeCopy,
  runAgent,
} from './lib/case-common.mjs';

const USAGE =
  'usage: node testbench/runners/run-audit-case.mjs <caseDir> [--runs N] [--model haiku] [--keep] [--agent claude] [--grade-only <copyPath>]';
const AGENT_TIMEOUT_MS = 1800000;
const AUDIT_DIR = path.join('.campaign', 'state', 'audit');

function loadCase(caseDir) {
  const data = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  for (const field of ['case', 'fixture', 'skill', 'prompt']) {
    if (typeof data[field] !== 'string') throw new Error(`case.yaml: ${field} missing`);
  }
  return data;
}

function loadKey(fixtureDir) {
  const data = loadYamlMapping(path.join(fixtureDir, 'key.yaml'));
  for (const field of ['contradictions', 'non_issues', 'excluded']) {
    if (!Array.isArray(data[field])) throw new Error(`key.yaml: ${field} must be a list`);
  }
  if (data.acceptable_findings === undefined) data.acceptable_findings = [];
  if (!Array.isArray(data.acceptable_findings)) throw new Error('key.yaml: acceptable_findings must be a list');
  return data;
}

/** The files that define the audit under test: skill folder (no tests), audit agents, scripts. */
function auditInstructionFiles() {
  const agentsDir = path.join(REPO_ROOT, 'yllir', 'agents');
  const agents = fs
    .readdirSync(agentsDir)
    .filter((name) => /^audit-.*\.md$/.test(name))
    .map((name) => path.join(agentsDir, name));
  return [
    ...new Set([
      ...listFiles(path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'continuity-audit')),
      ...agents,
      ...listFiles(path.join(REPO_ROOT, 'yllir', 'scripts'), { scriptsOnly: true }),
    ]),
  ];
}

/** Reads a file, or returns null when it is missing. */
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Parses a JSON file, or returns null when it is missing or unparsable. */
function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Normalises a campaign-relative path: Unicode NFC, forward slashes, no leading ./. */
function normPath(file) {
  return String(file).normalize('NFC').replace(/\\/g, '/').replace(/^\.\//, '');
}

/** The document part of a locator `<document>:<line>`. */
function documentOf(locator) {
  const text = String(locator);
  const colon = text.lastIndexOf(':');
  return normPath(colon < 0 ? text : text.slice(0, colon));
}

/** True when the report entry has a locator in the given document (any line). */
function touches(entry, file) {
  if (typeof file !== 'string') return false;
  const locators = Array.isArray(entry.locators) ? entry.locators : [];
  return locators.some((locator) => documentOf(locator) === normPath(file));
}

/** True when the entry is a problem that the key contradiction describes (rule A3). */
function matchesContradiction(entry, contradiction) {
  return (
    entry.category !== 'perspective' &&
    touches(entry, contradiction.a?.file) &&
    touches(entry, contradiction.b?.file)
  );
}

/** Line of each key snippet in the original fixture, as `<file>:<line>` or null. */
function keyLocators(key, fixtureCampaign) {
  const located = {};
  const unlocated = [];
  for (const item of [...key.contradictions, ...key.non_issues, ...key.excluded]) {
    if (item === null || typeof item !== 'object') continue;
    const entry = {};
    for (const side of ['a', 'b']) {
      const ref = item[side];
      if (ref === null || typeof ref !== 'object') continue;
      const text = readText(path.join(fixtureCampaign, ref.file));
      const line = text === null ? null : locateSnippet(text, ref.snippet);
      entry[side] = line === null ? null : `${ref.file}:${line}`;
      if (line === null) unlocated.push(`${item.id}.${side}`);
    }
    located[item.id] = entry;
  }
  return { located, unlocated };
}

function factsSummary(facts) {
  if (facts === null) return null;
  const coverage = Array.isArray(facts.coverage) ? facts.coverage : [];
  const byStatus = {};
  for (const entry of coverage) byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
  return {
    complete: facts.complete ?? null,
    documents: coverage.length,
    by_status: byStatus,
    facts: Array.isArray(facts.facts) ? facts.facts.length : null,
    discarded: Array.isArray(facts.discarded) ? facts.discarded.length : null,
  };
}

function valuesText(values) {
  return Array.isArray(values) ? values.map(String).join(' vs ') : String(values);
}

/**
 * Grades the audit files left in a copy. Checks A1 to A8 as defined in the brief;
 * A7 (false alarms) is informational and does not enter pass.
 */
function gradeCopy({ key, fixtureCampaign, copy }) {
  const failures = [];
  const total = key.contradictions.length;
  const located = keyLocators(key, fixtureCampaign);
  const report = readJson(path.join(copy, AUDIT_DIR, 'report.json'));
  const candidatesDoc = readJson(path.join(copy, AUDIT_DIR, 'candidates.json'));
  const judgments = readJson(path.join(copy, AUDIT_DIR, 'judgments.json'));
  const factsDoc = readJson(path.join(copy, AUDIT_DIR, 'facts.json'));
  const base = {
    key_locators: located.located,
    key_unlocated: located.unlocated,
    candidates_stats: candidatesDoc && candidatesDoc.stats ? candidatesDoc.stats : null,
    coverage: factsSummary(factsDoc),
  };

  if (report === null) {
    const checks = { A1: false, A2: false, A3: `0/${total}`, A4: false, A5: false, A6: false, A8: false };
    const missed = key.contradictions.map((c) => c.id);
    for (const id of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A8']) failures.push(`${id} no report.json`);
    return {
      ...base,
      checks,
      pass: false,
      failures,
      missed,
      metrics: { recall: `0/${total}` },
      false_alarms: null,
      acceptable: null,
    };
  }

  const problems = Array.isArray(report.problems) ? report.problems : [];
  const perspective = Array.isArray(report.perspective) ? report.perspective : [];
  const judged = [...problems, ...perspective];

  // A1 docs-untouched: nothing changed outside .campaign/.
  const outside = changedFiles(copy).filter((file) => !file.startsWith('.campaign/'));
  const a1 = outside.length === 0;
  if (!a1) failures.push(`A1 changed outside .campaign/: ${outside.join(', ')}`);

  // A2 status.
  const a2 = report.status === 'COMPLETE';
  if (!a2) failures.push(`A2 status is ${report.status}`);

  // A3 recall: one problem with a locator in each of the two files of the contradiction.
  const missed = [];
  let found = 0;
  for (const c of key.contradictions) {
    if (problems.some((entry) => matchesContradiction(entry, c))) found += 1;
    else missed.push(c.id);
  }
  const a3 = found === total;
  if (!a3) failures.push(`A3 recall ${found}/${total} missed ${missed.join(',')}`);

  // A4 perspective: no problem holds both documents of a perspective non-issue.
  const a4Bad = key.non_issues
    .filter((n) => n && n.kind !== 'hypothesis' && n.a && n.b)
    .filter((n) => problems.some((e) => touches(e, n.a.file) && touches(e, n.b.file)))
    .map((n) => n.id);
  const a4 = a4Bad.length === 0;
  if (!a4) failures.push(`A4 perspective reported as problem: ${a4Bad.join(',')}`);

  // A5 hypothesis: no entry at all cites the notes file of a hypothesis.
  const a5Bad = key.non_issues
    .filter((n) => n && n.kind === 'hypothesis' && n.a)
    .filter((n) => judged.some((e) => touches(e, n.a.file)))
    .map((n) => n.id);
  const a5 = a5Bad.length === 0;
  if (!a5) failures.push(`A5 hypothesis cited: ${a5Bad.join(',')}`);

  // A6 exclusion: no entry holds both documents of a recorded exclusion.
  const a6Bad = key.excluded
    .filter((x) => x && x.a && x.b)
    .filter((x) => judged.some((e) => touches(e, x.a.file) && touches(e, x.b.file)))
    .map((x) => x.id);
  const a6 = a6Bad.length === 0;
  if (!a6) failures.push(`A6 exclusion reported: ${a6Bad.join(',')}`);

  // A7 false alarms (informational). A problem that matches an acceptable finding
  // (same file-pair rule as A3) is not a false alarm: it is counted as acceptable.
  const unmatched = problems.filter((e) => !key.contradictions.some((c) => matchesContradiction(e, c)));
  const acceptableItems = unmatched.filter((e) => key.acceptable_findings.some((y) => matchesContradiction(e, y)));
  const falseAlarms = unmatched.filter((e) => !acceptableItems.includes(e));
  const falseAlarmLines = falseAlarms.map(
    (e) => `${e.subject} ${e.attribute}: ${valuesText(e.values)} (${(e.locators ?? []).join(', ')})`,
  );
  const acceptable = acceptableItems.length;

  // A8 judge independence: one judgment per candidate.
  let a8 = false;
  const candidates = candidatesDoc && Array.isArray(candidatesDoc.candidates) ? candidatesDoc.candidates : null;
  if (!Array.isArray(judgments)) {
    failures.push('A8 judgments.json missing or not a JSON array');
  } else if (candidates === null) {
    failures.push('A8 candidates.json missing');
  } else {
    const want = candidates.map((c) => c.cid);
    const got = judgments.map((j) => (j && typeof j === 'object' ? j.cid : undefined));
    const gotSet = new Set(got);
    a8 =
      got.length === want.length &&
      gotSet.size === got.length &&
      want.every((cid) => gotSet.has(cid));
    if (!a8) failures.push(`A8 ${got.length} judgments for ${want.length} candidates`);
  }

  const checks = { A1: a1, A2: a2, A3: `${found}/${total}`, A4: a4, A5: a5, A6: a6, A8: a8 };
  const pass = a1 && a2 && a3 && a4 && a5 && a6 && a8;
  return {
    ...base,
    checks,
    pass,
    failures,
    missed,
    metrics: { recall: `${found}/${total}` },
    false_alarms: { count: falseAlarmLines.length, lines: falseAlarmLines },
    acceptable,
  };
}

/** Builds the JSONL record of one run from the grading result. */
function makeRecord({ caseName, run, date, header, hash, permissionMode, agentFailure, agent, graded, copy }) {
  const failures = [...(agentFailure ? [`agent error: ${agentFailure}`] : []), ...graded.failures];
  const record = {
    case: caseName,
    run,
    date,
    ...header,
    instructions_hash: hash,
    permission_mode: permissionMode ?? null,
    pass: graded.pass && !agentFailure,
    checks: graded.checks,
    failures,
    report: agent ? agent.report : null,
    cost_usd: agent ? agent.cost_usd : null,
    duration_ms: agent ? agent.duration_ms : null,
    num_turns: agent ? agent.num_turns : null,
    denied: agent?.denied ?? [],
    tool_calls: agent?.tool_calls ?? null,
    metrics: graded.metrics,
    missed: graded.missed,
    false_alarms: graded.false_alarms,
    acceptable: graded.acceptable,
    candidates_stats: graded.candidates_stats,
    coverage: graded.coverage,
    key_locators: graded.key_locators,
    key_unlocated: graded.key_unlocated,
  };
  if (copy !== undefined) record.copy = copy;
  return record;
}

/** The record without the long report text, for the console. */
function consoleView(record) {
  const { report, ...rest } = record;
  return rest;
}

function main() {
  const opts = parseCommonArgs(process.argv.slice(2), USAGE, { valueOptions: ['--grade-only'] });
  const caseData = loadCase(opts.caseDir);
  const fixtureDir = path.join(REPO_ROOT, 'testbench', 'fixtures', caseData.fixture);
  const fixtureCampaign = path.join(fixtureDir, 'campaign');
  const key = loadKey(fixtureDir);
  const hash = instructionsHash(auditInstructionFiles());
  const gradeOnly = opts.values['--grade-only'];
  const header = recordHeader({ agent: opts.agent, modelLabel: opts.modelLabel });

  if (gradeOnly !== undefined) {
    const copy = path.resolve(gradeOnly);
    if (!fs.existsSync(path.join(copy, '.campaign'))) throw new Error(`--grade-only: no .campaign folder in ${copy}`);
    const graded = gradeCopy({ key, fixtureCampaign, copy });
    const record = makeRecord({
      caseName: caseData.case,
      run: 1,
      date: new Date().toISOString(),
      header,
      hash,
      agentFailure: null,
      permissionMode: null,
      agent: { report: readText(path.join(copy, AUDIT_DIR, 'report.txt')), cost_usd: null, duration_ms: null, num_turns: null },
      graded,
      copy,
    });
    record.grade_only = true;
    console.log(JSON.stringify(consoleView(record)));
    process.exitCode = printSummary([record], opts.modelLabel, hash, opts.agent) === 1 ? 0 : 1;
    return;
  }

  const summaries = [];
  for (let i = 1; i <= opts.runs; i++) {
    const campaign = prepareCopy(fixtureDir);
    const date = new Date().toISOString();
    let record;
    try {
      const agent = runAgent({
        agent: opts.agent,
        cwd: campaign,
        prompt: caseData.prompt,
        model: opts.model,
        modelGiven: opts.modelGiven,
        timeoutMs: AGENT_TIMEOUT_MS,
      });
      // The copy is graded even when the agent failed: a partial audit still shows what happened.
      const graded = gradeCopy({ key, fixtureCampaign, copy: campaign });
      record = makeRecord({
        caseName: caseData.case,
        run: i,
        date,
        header,
        hash,
        permissionMode: agent.permission_mode,
        agentFailure: agent.ok ? null : agent.error,
        agent: agent.ok ? agent : null,
        graded,
        copy: opts.keep ? campaign : undefined,
      });
    } finally {
      if (opts.keep) {
        console.log(`kept run ${i}: ${campaign}`);
      } else {
        removeCopy(campaign);
      }
    }
    appendResult(caseData.case, record);
    console.log(JSON.stringify(consoleView(record)));
    summaries.push(record);
  }

  const passed = printSummary(summaries, opts.modelLabel, hash, opts.agent);
  process.exitCode = passed === summaries.length ? 0 : 1;
}

try {
  main();
} catch (err) {
  console.error(`run-audit-case: ${err.message}`);
  process.exitCode = 2;
}
