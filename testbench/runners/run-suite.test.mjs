// Tests for run-suite.mjs. No agent is run: cases live in a temporary folder and
// child processes are replaced by a fake spawn.
// Run: node --test testbench/runners/run-suite.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  parseArgs,
  planJobs,
  interpretChild,
  runJob,
  runPool,
  summarize,
  formatReport,
  childArgs,
  skippedWorldCases,
} from './run-suite.mjs';

function makeCases(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-suite-test-'));
  for (const [rel, yaml] of Object.entries(layout)) {
    const dir = path.join(root, rel);
    fs.mkdirSync(dir, { recursive: true });
    if (yaml !== null) fs.writeFileSync(path.join(dir, 'case.yaml'), yaml);
  }
  return root;
}

const LAYOUT = {
  'new-campaign/all-answers': 'case: x\n',
  'entry/after-proceed': 'case: x\n',
  'audit/full': 'case: x\n',
  'entry/no-yaml': null,
  'misc/stray': 'case: x\n',
};

test('planJobs skips the audit kind by default and includes it with withAudit', () => {
  const root = makeCases(LAYOUT);
  const without = planJobs({ casesRoot: root });
  assert.ok(!without.some((job) => job.kind === 'audit'));
  assert.equal(without.length, 2);
  const withAudit = planJobs({ casesRoot: root, withAudit: true });
  assert.ok(withAudit.some((job) => job.kind === 'audit' && job.name === 'full'));
  assert.equal(withAudit.length, 3);
});

test('planJobs ignores folders without case.yaml and kinds without a runner', () => {
  const root = makeCases(LAYOUT);
  const jobs = planJobs({ casesRoot: root, withAudit: true });
  assert.ok(!jobs.some((job) => job.name === 'no-yaml'));
  assert.ok(!jobs.some((job) => job.kind === 'misc'));
});

test('planJobs gives each job its case, runner, agent and run index', () => {
  const root = makeCases({ 'entry/after-proceed': 'case: x\n' });
  const [job] = planJobs({ casesRoot: root });
  assert.equal(job.kind, 'entry');
  assert.equal(job.name, 'after-proceed');
  assert.equal(job.caseDir, path.join(root, 'entry', 'after-proceed'));
  assert.equal(path.basename(job.runner), 'run-entry-case.mjs');
  assert.ok(path.isAbsolute(job.runner));
  assert.equal(job.agent, 'claude');
  assert.equal(job.run, 1);
});

test('planJobs multiplies by agents and runs', () => {
  const root = makeCases({ 'entry/a': 'case: x\n', 'new-campaign/b': 'case: x\n' });
  const jobs = planJobs({ casesRoot: root, agents: ['claude'], runs: 3 });
  assert.equal(jobs.length, 2 * 1 * 3);
  const claudeRuns = jobs.filter((job) => job.agent === 'claude' && job.name === 'a').map((job) => job.run);
  assert.deepEqual(claudeRuns, [1, 2, 3]);
});

test('planJobs honours only as a substring of kind/name', () => {
  const root = makeCases(LAYOUT);
  const newOnly = planJobs({ casesRoot: root, only: 'new-campaign' });
  assert.deepEqual(newOnly.map((job) => `${job.kind}/${job.name}`), ['new-campaign/all-answers']);
  const entryOne = planJobs({ casesRoot: root, only: 'entry/after' });
  assert.deepEqual(entryOne.map((job) => `${job.kind}/${job.name}`), ['entry/after-proceed']);
  assert.equal(planJobs({ casesRoot: root, only: 'nothing-matches' }).length, 0);
});

test('childArgs passes the case, agent, one run and the model when given', () => {
  const job = { runner: '/r/run-entry-case.mjs', caseDir: '/c/entry/x', agent: 'claude', run: 2 };
  assert.deepEqual(childArgs(job), ['/r/run-entry-case.mjs', '/c/entry/x', '--agent', 'claude', '--runs', '1']);
  assert.deepEqual(childArgs(job, { model: 'haiku' }).slice(-2), ['--model', 'haiku']);
});

test('parseArgs reads the options and rejects bad values', () => {
  const opts = parseArgs(['--agent', 'claude', '--runs', '3', '--parallel', '4', '--with-audit', '--with-world', '--only', 'entry', '--model', 'haiku']);
  assert.deepEqual(opts, { agent: 'claude', runs: 3, parallel: 4, withAudit: true, withWorld: true, only: 'entry', model: 'haiku' });
  assert.equal(parseArgs([]).withWorld, false);
  assert.equal(parseArgs([]).agent, 'claude');
  assert.throws(() => parseArgs(['--agent', 'bogus']), /--agent must be claude/);
  assert.throws(() => parseArgs(['--agent', 'codex']), /codex is no longer a test agent/);
  assert.throws(() => parseArgs(['--agent', 'both']), /--agent must be claude/);
  assert.throws(() => parseArgs(['--runs', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--parallel']), /needs a value/);
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
  assert.throws(() => parseArgs(['stray']), /unexpected argument/);
});

test('interpretChild reads pass and failures from the record line', () => {
  const job = { kind: 'entry', name: 'a', agent: 'claude', run: 1 };
  const pass = interpretChild(job, { code: 0, stdout: 'noise\n{"case":"a","pass":true,"failures":[]}\n' });
  assert.deepEqual(pass, { job, pass: true, failures: [], error: null });
  const fail = interpretChild(job, { code: 1, stdout: '{"case":"a","pass":false,"failures":["T1 missed"]}\n' });
  assert.equal(fail.pass, false);
  assert.equal(fail.error, null);
  assert.deepEqual(fail.failures, ['T1 missed']);
});

test('interpretChild counts an unexpected exit code or a missing record as an error', () => {
  const job = { kind: 'entry', name: 'a', agent: 'claude', run: 1 };
  const crashed = interpretChild(job, { code: 2, stdout: '', stderr: 'boom first\nboom second\n' });
  assert.equal(crashed.pass, false);
  assert.equal(crashed.error, 'exit code 2: boom first');
  const silent = interpretChild(job, { code: 0, stdout: 'no json here\n', stderr: '' });
  assert.equal(silent.error, 'no result line on stdout');
  const killed = interpretChild(job, { code: null, stdout: '', stderr: '' });
  assert.equal(killed.error, 'exit code null');
});

test('runJob resolves a fake child that prints a record', async () => {
  const fakeSpawn = (cmd, args) => {
    assert.equal(cmd, process.execPath);
    assert.ok(args.includes('--runs'));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};
    queueMicrotask(() => {
      child.stdout.emit('data', '{"case":"entry/x","pass":true,"failures":[]}\n');
      child.emit('close', 0);
    });
    return child;
  };
  const job = { kind: 'entry', name: 'x', caseDir: '/c', runner: '/r.mjs', agent: 'claude', run: 1 };
  const result = await runJob(job, { spawnFn: fakeSpawn });
  assert.equal(result.pass, true);
  assert.equal(result.error, null);
});

test('runJob turns a spawn that throws into an error result', async () => {
  const job = { kind: 'entry', name: 'x', caseDir: '/c', runner: '/r.mjs', agent: 'claude', run: 1 };
  const result = await runJob(job, { spawnFn: () => { throw new Error('no node'); } });
  assert.equal(result.pass, false);
  assert.match(result.error, /spawn failed: no node/);
});

test('runPool never runs more than the limit at once and keeps order', async () => {
  let active = 0;
  let peak = 0;
  const items = [1, 2, 3, 4, 5, 6, 7];
  const out = await runPool(items, 3, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5 * (n % 3)));
    active--;
    return n * 10;
  });
  assert.ok(peak <= 3, `peak ${peak}`);
  assert.ok(peak >= 2, `peak ${peak}`);
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70]);
});

function jobResult(kind, name, agent, run, outcome) {
  return {
    job: { kind, name, agent, run },
    pass: outcome.pass ?? false,
    failures: outcome.failures ?? [],
    error: outcome.error ?? null,
  };
}

test('summarize counts pass, fail and error per case and agent', () => {
  const results = [
    jobResult('entry', 'a', 'claude', 1, { pass: true }),
    jobResult('entry', 'a', 'claude', 2, { pass: false, failures: ['T1 missed'] }),
    jobResult('entry', 'a', 'claude', 3, { error: 'exit code 2: crash' }),
    jobResult('new-campaign', 'b', 'claude', 1, { pass: true }),
  ];
  const summary = summarize(results);
  assert.deepEqual(summary.rows, [
    { case: 'entry/a', agent: 'claude', pass: 1, fail: 1, error: 1, n: 3 },
    { case: 'new-campaign/b', agent: 'claude', pass: 1, fail: 0, error: 0, n: 1 },
  ]);
  assert.deepEqual(summary.totals.get('claude'), { pass: 2, n: 4 });
  assert.equal(summary.allPassed, false);
  assert.deepEqual(summary.failures, [
    { case: 'entry/a', agent: 'claude', run: 2, reason: 'T1 missed' },
    { case: 'entry/a', agent: 'claude', run: 3, reason: 'exit code 2: crash' },
  ]);
});

test('summarize reports allPassed only when every job passed', () => {
  assert.equal(summarize([jobResult('entry', 'a', 'claude', 1, { pass: true })]).allPassed, true);
  assert.equal(summarize([jobResult('entry', 'a', 'claude', 1, { pass: true, error: 'x' })]).allPassed, false);
});

test('formatReport prints the table, the total and truncated failure reasons', () => {
  const long = 'x'.repeat(300);
  const text = formatReport(summarize([
    jobResult('entry', 'a', 'claude', 1, { pass: true }),
    jobResult('entry', 'a', 'claude', 2, { error: long }),
  ]));
  assert.match(text, /entry\/a\s+claude\s+1\/2\s+ERR 1/);
  assert.match(text, /TOTAL claude 1\/2/);
  const reason = text.split('\n').find((line) => line.includes('run 2:'));
  assert.equal(reason.slice(reason.indexOf('run 2: ') + 'run 2: '.length).length, 160);
});

test('planJobs registers the world kind with run-world-case.mjs, when withWorld is set', () => {
  const root = makeCases({ 'world/region': 'case: world-region\n', 'world/creature': 'case: world-creature\n' });
  const jobs = planJobs({ casesRoot: root, withWorld: true });
  assert.deepEqual(
    jobs.map((job) => `${job.kind}/${job.name}`),
    ['world/creature', 'world/region'],
  );
  assert.ok(jobs.every((job) => job.runner.endsWith('run-world-case.mjs')));
  const [region] = planJobs({ casesRoot: root, withWorld: true, only: 'region' });
  assert.deepEqual(childArgs(region, { model: 'haiku' }).slice(1), [region.caseDir, '--agent', 'claude', '--runs', '1', '--model', 'haiku']);
});

test('planJobs excludes world cases by default, in quick mode and in release mode', () => {
  const root = makeCases({
    'world/region': 'case: world-region\n',
    'entry/a': 'case: x\n',
    'audit/full': 'case: x\n',
  });
  const quick = planJobs({ casesRoot: root });
  assert.deepEqual(quick.map((job) => `${job.kind}/${job.name}`), ['entry/a']);
  const release = planJobs({ casesRoot: root, runs: 3, withAudit: true });
  assert.ok(!release.some((job) => job.kind === 'world'));
  assert.deepEqual([...new Set(release.map((job) => `${job.kind}/${job.name}`))].sort(), ['audit/full', 'entry/a']);
});

test('planJobs includes world cases with withWorld, alongside the others', () => {
  const root = makeCases({ 'world/region': 'case: world-region\n', 'entry/a': 'case: x\n' });
  const jobs = planJobs({ casesRoot: root, withWorld: true, runs: 2 });
  assert.equal(jobs.filter((job) => job.kind === 'world').length, 2);
  assert.equal(jobs.filter((job) => job.kind === 'entry').length, 2);
  const onlyWorld = planJobs({ casesRoot: root, withWorld: true, only: 'world/' });
  assert.deepEqual(onlyWorld.map((job) => `${job.kind}/${job.name}`), ['world/region']);
});

test('skippedWorldCases names the world cases that --only asks for without --with-world', () => {
  const root = makeCases({ 'world/region': 'case: world-region\n', 'world/creature': 'case: world-creature\n', 'entry/a': 'case: x\n' });
  assert.deepEqual(skippedWorldCases({ casesRoot: root, only: 'world/' }), ['world/creature', 'world/region']);
  assert.deepEqual(skippedWorldCases({ casesRoot: root, only: 'region' }), ['world/region']);
  assert.deepEqual(skippedWorldCases({ casesRoot: root, only: 'entry/' }), []);
  assert.deepEqual(skippedWorldCases({ casesRoot: root, only: null }), []);
  assert.deepEqual(skippedWorldCases({ casesRoot: root, only: 'world/', withWorld: true }), []);
});
