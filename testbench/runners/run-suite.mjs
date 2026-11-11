#!/usr/bin/env node
// Runs every testbench case through its runner, in parallel, and prints one table.
// Each job is one child process: node <runner> <caseDir> --agent <a> --runs 1.
// The child appends its own record to testbench/results; this script only reads
// the JSON line the child prints and summarises it.
//
// Usage: node testbench/runners/run-suite.mjs [--agent claude] [--runs N]
//          [--parallel N] [--with-audit] [--only <substring>] [--model <m>]
// Defaults: --agent claude, --runs 1 (quick), --parallel 8. The audit kind is skipped
// unless --with-audit is given (each audit run takes 10+ minutes).
// Exit codes: 0 every job passes; 1 some job fails or errors; 2 usage error or no cases.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RUNNERS_DIR = import.meta.dirname;
const CASES_ROOT = path.resolve(RUNNERS_DIR, '..', 'cases');
const KIND_RUNNERS = new Map([
  ['new-campaign', 'run-new-campaign-case.mjs'],
  ['entry', 'run-entry-case.mjs'],
  ['linker', 'run-linker-case.mjs'],
  ['audit', 'run-audit-case.mjs'],
]);
const AGENT_SETS = new Map([['claude', ['claude']]]);
const AGENT_ORDER = ['claude'];
const REASON_WIDTH = 160;
const USAGE =
  'usage: node testbench/runners/run-suite.mjs [--agent claude] [--runs N] [--parallel N] [--with-audit] [--only <substring>] [--model <m>]';

class UsageError extends Error {}

function sortedDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * The jobs for every case under casesRoot: one per (case, agent, run index), in case
 * order, then agent order, then run order. A case is a folder casesRoot/<kind>/<name>
 * holding case.yaml; kinds without a runner are ignored. The audit kind is skipped
 * unless withAudit is true. only, when given, keeps the cases whose "<kind>/<name>"
 * contains that substring.
 */
export function planJobs({ casesRoot = CASES_ROOT, agents = ['claude'], runs = 1, withAudit = false, only = null } = {}) {
  const cases = [];
  for (const kind of sortedDirs(casesRoot)) {
    const runner = KIND_RUNNERS.get(kind);
    if (runner === undefined) continue;
    if (kind === 'audit' && !withAudit) continue;
    for (const name of sortedDirs(path.join(casesRoot, kind))) {
      const caseDir = path.join(casesRoot, kind, name);
      if (!fs.existsSync(path.join(caseDir, 'case.yaml'))) continue;
      if (only !== null && only !== undefined && !`${kind}/${name}`.includes(only)) continue;
      cases.push({ kind, name, caseDir, runner: path.join(RUNNERS_DIR, runner) });
    }
  }
  const jobs = [];
  for (const testCase of cases) {
    for (const agent of agents) {
      for (let run = 1; run <= runs; run++) jobs.push({ ...testCase, agent, run });
    }
  }
  return jobs;
}

/** The arguments of the child process for a job. */
export function childArgs(job, { model = null } = {}) {
  const args = [job.runner, job.caseDir, '--agent', job.agent, '--runs', '1'];
  if (model !== null) args.push('--model', model);
  return args;
}

function firstLine(text) {
  return text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
}

/** The last line of stdout that is a JSON object with a case field, or null. */
function lastRecord(stdout) {
  let found = null;
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj !== null && typeof obj === 'object' && 'case' in obj) found = obj;
  }
  return found;
}

function errorResult(job, reason, stderrLine = '') {
  return { job, pass: false, failures: [], error: stderrLine === '' ? reason : `${reason}: ${stderrLine}` };
}

/**
 * Turns the outcome of one child process into a job result:
 * { job, pass, failures, error }. error is null unless the job counts as an ERROR:
 * an exit code other than 0 or 1, or no record line on stdout.
 */
export function interpretChild(job, { code, stdout = '', stderr = '' }) {
  const stderrLine = firstLine(stderr);
  if (code !== 0 && code !== 1) return errorResult(job, `exit code ${code}`, stderrLine);
  const record = lastRecord(stdout);
  if (record === null) return errorResult(job, 'no result line on stdout', stderrLine);
  if (typeof record.pass !== 'boolean') return errorResult(job, 'result line has no boolean pass', stderrLine);
  const failures = Array.isArray(record.failures) ? record.failures.map(String) : [];
  return { job, pass: record.pass, failures, error: null };
}

/** Runs one job as a child process and resolves to its job result. Never rejects. */
export function runJob(job, { model = null, spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(process.execPath, childArgs(job, { model }), { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve(errorResult(job, `spawn failed: ${err.message}`));
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => resolve(errorResult(job, `spawn failed: ${err.message}`, firstLine(stderr))));
    child.on('close', (code) => resolve(interpretChild(job, { code, stdout, stderr })));
  });
}

/** Runs worker over items with at most limit calls in flight. Results keep the item order. */
export async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

/**
 * Counts job results per (case, agent). Each row: { case, agent, pass, fail, error, n }
 * where fail excludes errors and n counts every job. Rows are sorted by case, then agent.
 * totals maps each agent that has jobs to { pass, n }. failures lists every job that did
 * not pass, with its reason (the error, else the failure messages joined).
 */
export function summarize(jobResults) {
  const byKey = new Map();
  const totals = new Map();
  const failures = [];
  for (const result of jobResults) {
    const { job } = result;
    const caseName = `${job.kind}/${job.name}`;
    const key = `${caseName}\u0000${job.agent}`;
    if (!byKey.has(key)) byKey.set(key, { case: caseName, agent: job.agent, pass: 0, fail: 0, error: 0, n: 0 });
    const row = byKey.get(key);
    const total = totals.get(job.agent) ?? { pass: 0, n: 0 };
    row.n++;
    total.n++;
    if (result.error !== null) {
      row.error++;
    } else if (result.pass) {
      row.pass++;
      total.pass++;
    } else {
      row.fail++;
    }
    totals.set(job.agent, total);
    if (result.error !== null || !result.pass) {
      const reason = result.error ?? result.failures.join('; ');
      failures.push({ case: caseName, agent: job.agent, run: job.run, reason });
    }
  }
  const rows = [...byKey.values()].sort((a, b) =>
    a.case !== b.case ? (a.case < b.case ? -1 : 1) : AGENT_ORDER.indexOf(a.agent) - AGENT_ORDER.indexOf(b.agent),
  );
  const allPassed = jobResults.every((result) => result.error === null && result.pass);
  return { rows, totals, failures, allPassed };
}

/** The printed report: the table, the TOTAL line and the failure reasons. */
export function formatReport(summary) {
  const lines = [];
  const caseWidth = Math.max('case'.length, ...summary.rows.map((r) => r.case.length));
  const agentWidth = Math.max('agent'.length, ...summary.rows.map((r) => r.agent.length));
  lines.push(`${'case'.padEnd(caseWidth)}  ${'agent'.padEnd(agentWidth)}  pass`);
  for (const row of summary.rows) {
    const errPart = row.error > 0 ? `  ERR ${row.error}` : '';
    lines.push(`${row.case.padEnd(caseWidth)}  ${row.agent.padEnd(agentWidth)}  ${row.pass}/${row.n}${errPart}`);
  }
  const agents = AGENT_ORDER.filter((agent) => summary.totals.has(agent));
  const totalParts = agents.map((agent) => {
    const total = summary.totals.get(agent);
    return `${agent} ${total.pass}/${total.n}`;
  });
  lines.push('');
  lines.push(`TOTAL ${totalParts.join('  ')}`);
  if (summary.failures.length > 0) {
    lines.push('');
    lines.push('failures:');
    for (const failure of summary.failures) {
      lines.push(`  ${failure.case} ${failure.agent} run ${failure.run}: ${failure.reason.slice(0, REASON_WIDTH)}`);
    }
  }
  return lines.join('\n');
}

function positiveInt(name, value) {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) throw new UsageError(`${name} needs a positive integer`);
  return Number(value);
}

/** Parses the command line. Throws UsageError on anything it does not accept. */
export function parseArgs(argv) {
  const opts = { agent: 'claude', runs: 1, parallel: 8, withAudit: false, only: null, model: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      return next;
    };
    if (arg === '--agent') {
      opts.agent = value();
      if (opts.agent === 'codex') throw new UsageError('codex is no longer a test agent: use --agent claude');
      if (!AGENT_SETS.has(opts.agent)) throw new UsageError('--agent must be claude');
    } else if (arg === '--runs') {
      opts.runs = positiveInt('--runs', value());
    } else if (arg === '--parallel') {
      opts.parallel = positiveInt('--parallel', value());
    } else if (arg === '--with-audit') {
      opts.withAudit = true;
    } else if (arg === '--only') {
      opts.only = value();
    } else if (arg === '--model') {
      opts.model = value();
    } else if (arg.startsWith('--')) {
      throw new UsageError(`unknown option ${arg}`);
    } else {
      throw new UsageError(`unexpected argument ${arg}`);
    }
  }
  return opts;
}

async function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`run-suite: ${err.message}\n${USAGE}`);
    return 2;
  }
  const agents = AGENT_SETS.get(opts.agent);
  const jobs = planJobs({ casesRoot: CASES_ROOT, agents, runs: opts.runs, withAudit: opts.withAudit, only: opts.only });
  if (jobs.length === 0) {
    console.error('run-suite: no cases match');
    return 2;
  }
  console.error(`run-suite: ${jobs.length} job(s), up to ${opts.parallel} at a time`);
  const results = await runPool(jobs, opts.parallel, (job) => runJob(job, { model: opts.model }));
  const summary = summarize(results);
  console.log(formatReport(summary));
  return summary.allPassed ? 0 : 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`run-suite: ${err.message}`);
      process.exitCode = 2;
    },
  );
}
