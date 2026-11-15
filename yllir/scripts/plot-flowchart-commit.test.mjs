import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRepo } from './lib/versions.mjs';

// The plot-mapper's draft goes through the engine's write cycle (check, then commit) like any batch.
// The plot flowchart is not a sheet, a session or a scene: it is saved as it is, with no metadata
// block, no index entry and no link, and a later commit replaces it.

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, 'engine.mjs');
const FIXTURE = path.resolve(here, '../../testbench/fixtures/morvalle-legacy/campaign');
const FLOW = 'Trama/Mappa della trama.md';
const DRAFT = `.campaign/drafts/${FLOW}`;

// Italian campaign (the fixture): the file name and the title are in Italian.
// The label of s2c1 names the sheet "Lino Valdes": the linker must not link it.
const FLOWCHART = [
  '---',
  'type: plot-map',
  'generated: 2026-11-15',
  '---',
  '',
  '# Mappa della trama',
  '',
  '```mermaid',
  'flowchart TD',
  '  subgraph s1 ["La strada verso la valle"]',
  '    s1c1 ["La strada verso la valle"]',
  '  end',
  '  subgraph s2 ["Verso il pozzo"]',
  '    s2c1 ["Lino Valdes al pozzo"]',
  '  end',
  '  subgraph s3 ["L\'arrivo a Borgo Cenere"]',
  '    s3c1 ["L\'arrivo a Borgo Cenere"]',
  '  end',
  '  s1 --> s2',
  '  s2 -.-> s3',
  '  s1c1 -.-> s2c1',
  '  %% path: s1 = Trama/Sessione 1/Sessione 1.md',
  '  %% path: s1c1 = Trama/Sessione 1/Eventi/La strada verso la valle.md',
  '  %% path: s2 = Trama/Sessione 2/Sessione 2.md',
  '  %% path: s2c1 = Trama/Sessione 2/Eventi/Verso il pozzo.md',
  "  %% path: s3 = Trama/Sessione 3/Sessione 3.md",
  "  %% path: s3c1 = Trama/Sessione 3/Eventi/L'arrivo a Borgo Cenere.md",
  '```',
  '',
].join('\n');

// A second draft: the label of the first scene changes and the edge between sessions 2 and 3 becomes a dependency.
const FLOWCHART_2 = FLOWCHART
  .replace('    s1c1 ["La strada verso la valle"]', '    s1c1 ["La strada, di notte"]')
  .replace('  s2 -.-> s3', '  s2 --> s3');

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function makeCampaign(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-flow-commit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(FIXTURE, dir, { recursive: true, verbatimSymlinks: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Test Master']);
  git(dir, ['config', 'user.email', 'master@test.invalid']);
  ensureRepo(dir);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'fixture']);
  return dir;
}

/** Runs the CLI and returns the status and the parsed JSON (the output without its last line). */
function cli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  const match = /^exit: (\d+)\n$/.exec(result.stdout.slice(result.stdout.lastIndexOf('exit: ')));
  assert.ok(match, `last line must be exit: N, got: ${JSON.stringify(result.stdout.slice(-80))}`);
  assert.equal(Number(match[1]), result.status, 'exit line must match the process status');
  return { status: result.status, json: JSON.parse(result.stdout.replace(/exit: \d+\n$/, '')), stdout: result.stdout };
}

function writeDraft(dir, text) {
  const full = path.join(dir, DRAFT);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function checkAndCommit(dir, message) {
  const check = cli(['check', dir, '--files', FLOW]);
  assert.equal(check.status, 0, check.stdout);
  assert.equal(check.json.ok, true);
  assert.equal(check.json.reviewRequired, false, 'a plot flowchart adds no facts: no model review');
  const commit = cli(['commit', dir, '--files', FLOW, '--message', message]);
  assert.equal(commit.status, 0, commit.stdout);
  assert.equal(commit.json.ok, true);
  return commit;
}

test('check and commit save the plot flowchart as drafted: no metadata block, no link, no sheet', (t) => {
  const dir = makeCampaign(t);
  writeDraft(dir, FLOWCHART);
  checkAndCommit(dir, 'Mappa della trama aggiornata.');

  const saved = fs.readFileSync(path.join(dir, FLOW), 'utf8');
  assert.equal(saved, FLOWCHART, 'the file is written exactly as the agent drafted it');
  assert.equal(saved.includes('<!-- yllir'), false, 'no yllir metadata block');
  assert.equal(saved.includes(']('), false, 'the linker did not touch the mermaid block');
  assert.equal(fs.existsSync(path.join(dir, DRAFT)), false, 'the draft is removed after the commit');

  const subjects = fs.readFileSync(path.join(dir, '.campaign/cache/subjects.json'), 'utf8');
  assert.equal(subjects.includes('Mappa della trama'), false, 'not indexed as a sheet');
  assert.equal(subjects.includes(FLOW), false, 'not indexed under its path');

  const flow = cli(['plot-flowchart', dir]);
  assert.equal(flow.status, 0, flow.stdout);
  assert.deepEqual(flow.json, []);
});

test('a later commit of a changed draft replaces the plot flowchart and adds one version', (t) => {
  const dir = makeCampaign(t);
  writeDraft(dir, FLOWCHART);
  checkAndCommit(dir, 'Mappa della trama aggiornata.');
  const versionsBefore = git(dir, ['rev-list', '--count', 'HEAD']);

  writeDraft(dir, FLOWCHART_2);
  checkAndCommit(dir, 'Mappa della trama aggiornata.');

  assert.equal(fs.readFileSync(path.join(dir, FLOW), 'utf8'), FLOWCHART_2);
  assert.equal(fs.existsSync(path.join(dir, DRAFT)), false);
  assert.equal(Number(git(dir, ['rev-list', '--count', 'HEAD'])), Number(versionsBefore) + 1);
  assert.deepEqual(cli(['plot-flowchart', dir]).json, []);
});

test('a plot flowchart with a path to a missing file is saved, and plot-flowchart reports it with exit 1', (t) => {
  const dir = makeCampaign(t);
  const broken = FLOWCHART.replace('Trama/Sessione 2/Eventi/Verso il pozzo.md', 'Trama/Sessione 9/Eventi/Nessuno.md');
  writeDraft(dir, broken);
  checkAndCommit(dir, 'Mappa della trama aggiornata.');
  assert.equal(fs.readFileSync(path.join(dir, FLOW), 'utf8'), broken);

  const flow = cli(['plot-flowchart', dir]);
  assert.equal(flow.status, 1);
  assert.ok(flow.json.some((e) => e.code === 'plot-flowchart-bad-path'), JSON.stringify(flow.json));
});
