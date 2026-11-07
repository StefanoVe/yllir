import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { plotMap } from './plot-map.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', 'plot-map.mjs');
const FIXTURE = path.resolve(HERE, '..', '..', '..', 'testbench', 'fixtures', 'morvalle', 'campaign');

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '  - id: cronaca',
  '    folder: Cronaca',
  '    type: chronicle',
  '  - id: luoghi',
  '    folder: Mondo',
  '    type: places',
  '',
].join('\n');

/** Creates a temporary campaign with the given files (relative path -> content). */
function makeCampaign(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-plot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const all = { 'campaign.yaml': CAMPAIGN, ...files };
  for (const [rel, content] of Object.entries(all)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/** A plot document; `dependsOn` undefined omits the field. */
function plot(id, dependsOn) {
  const deps = dependsOn === undefined ? '' : `depends_on: [${dependsOn.join(', ')}]\n`;
  return `---\nid: ${id}\n${deps}---\n\n# ${id}\n\nTesto.\n`;
}

/** A chronicle page; `played` undefined omits the field. */
function chronicle(id, played) {
  const line = played === undefined ? '' : `played: [${played.join(', ')}]\n`;
  return `---\nid: ${id}\n${line}---\n\n# Cronaca\n\nTesto.\n`;
}

function statuses(result) {
  return Object.fromEntries(
    result.sessions.map((s) => [s.id, s.played ? 'played' : s.ready ? 'ready' : 'waiting']),
  );
}

function codes(result) {
  return result.errors.map((e) => e.code);
}

test('chain of three with the first played: 1 played, 2 ready, 3 waiting', (t) => {
  const root = makeCampaign(t, {
    'Trama/Arco/Sessione 1.md': plot('s-01', []),
    'Trama/Arco/Sessione 2.md': plot('s-02', ['s-01']),
    'Trama/Arco/Sessione 3.md': plot('s-03', ['s-02']),
    'Cronaca/2026-01-01.md': chronicle('c-1', ['s-01']),
  });
  const result = plotMap(root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(statuses(result), { 's-01': 'played', 's-02': 'ready', 's-03': 'waiting' });
  assert.deepEqual(
    result.sessions.map((s) => s.id),
    ['s-01', 's-02', 's-03'],
  );
  assert.equal(result.sessions[1].arc, 'Arco');
  assert.equal(result.sessions[1].name, 'Sessione 2');
  assert.deepEqual(result.sessions[1].depends_on, ['s-01']);
  assert.deepEqual(result.sessions[1].location, []);
});

test('missing depends_on is an error and counts as no prerequisites', (t) => {
  const root = makeCampaign(t, {
    'Trama/a.md': plot('a', undefined),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['missing-depends-on']);
  assert.equal(result.errors[0].file, 'Trama/a.md');
  assert.equal(statuses(result).a, 'ready');
});

test('unknown dependency is reported and the session waits', (t) => {
  const root = makeCampaign(t, {
    'Trama/a.md': plot('a', ['nope']),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['unknown-dependency']);
  assert.equal(statuses(result).a, 'waiting');
});

test('a cycle is reported once and its members are not ready', (t) => {
  const root = makeCampaign(t, {
    'Trama/a.md': plot('a', ['b']),
    'Trama/b.md': plot('b', ['c']),
    'Trama/c.md': plot('c', ['a']),
    'Trama/d.md': plot('d', ['a']),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['cycle']);
  assert.match(result.errors[0].message, /a, b, c/);
  assert.equal(result.errors[0].file, 'Trama/a.md');
  assert.deepEqual(statuses(result), { a: 'waiting', b: 'waiting', c: 'waiting', d: 'waiting' });
});

test('a self dependency is a cycle', (t) => {
  const root = makeCampaign(t, {
    'Trama/a.md': plot('a', ['a']),
  });
  assert.deepEqual(codes(plotMap(root)), ['cycle']);
});

test('duplicate plot id keeps the first file and reports the second', (t) => {
  const root = makeCampaign(t, {
    'Trama/a.md': plot('same', []),
    'Trama/b.md': plot('same', []),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['duplicate-id']);
  assert.equal(result.errors[0].file, 'Trama/b.md');
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].file, 'Trama/a.md');
});

test('chronicle page without played is an error', (t) => {
  const root = makeCampaign(t, {
    'Trama/a.md': plot('a', []),
    'Cronaca/c.md': chronicle('c-1', undefined),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['missing-played']);
  assert.equal(result.errors[0].file, 'Cronaca/c.md');
});

test('played id that is not a plot document is an error', (t) => {
  const root = makeCampaign(t, {
    'Trama/a.md': plot('a', []),
    'Cronaca/c.md': chronicle('c-1', ['ghost']),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['unknown-played-id']);
  assert.equal(result.errors[0].file, 'Cronaca/c.md');
});

test('played before a prerequisite is an error', (t) => {
  const root = makeCampaign(t, {
    'Trama/a.md': plot('a', []),
    'Trama/b.md': plot('b', ['a']),
    'Cronaca/c.md': chronicle('c-1', ['b']),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['played-before-prerequisite']);
  assert.equal(result.errors[0].file, 'Trama/b.md');
  assert.deepEqual(statuses(result), { a: 'ready', b: 'played' });
});

test('arcs list sessions in order and give the next number', (t) => {
  const root = makeCampaign(t, {
    'Trama/Intro.md': plot('intro', []),
    'Trama/Arco A/Sessione 1.md': plot('a-1', []),
    'Trama/Arco A/Sessione 3.md': plot('a-3', ['a-1']),
    'Trama/Arco B/Incontro.md': plot('b-x', []),
    'Cronaca/c.md': chronicle('c-1', ['a-1']),
  });
  const result = plotMap(root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.arcs, [
    { arc: '', sessions: ['intro'], next_number: 1 },
    { arc: 'Arco A', sessions: ['a-1', 'a-3'], next_number: 4 },
    { arc: 'Arco B', sessions: ['b-x'], next_number: 1 },
  ]);
  assert.deepEqual(
    result.sessions.map((s) => s.id),
    ['intro', 'a-1', 'a-3', 'b-x'],
  );
});

test('the same campaign gives the same result every time', (t) => {
  const root = makeCampaign(t, {
    'Trama/a.md': plot('a', ['b']),
    'Trama/b.md': plot('b', ['c']),
    'Trama/c.md': plot('c', ['a']),
    'Trama/d.md': plot('d', ['zzz']),
    'Cronaca/c.md': chronicle('c-1', ['c', 'nope']),
  });
  const first = JSON.stringify(plotMap(root));
  const second = JSON.stringify(plotMap(root));
  assert.equal(first, second);
});

test('morvalle fixture: 01 played, 02 ready, 03 waiting, no errors', () => {
  const result = plotMap(FIXTURE);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(statuses(result), {
    'la-cenere-che-canta-01': 'played',
    'la-cenere-che-canta-02': 'ready',
    'la-cenere-che-canta-03': 'waiting',
  });
});

test('CLI prints the session lines and the summary, exit 0 without errors', () => {
  const run = spawnSync(process.execPath, [SCRIPT, FIXTURE], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(
    run.stdout,
    [
      'la-cenere-che-canta-01 played deps: -',
      'la-cenere-che-canta-02 ready deps: la-cenere-che-canta-01',
      'la-cenere-che-canta-03 waiting deps: la-cenere-che-canta-02',
      'sessions: 3, played: 1, ready: 1, errors: 0',
      '',
    ].join('\n'),
  );
});

test('CLI exits 1 on errors and 2 on usage errors', (t) => {
  const root = makeCampaign(t, { 'Trama/a.md': plot('a', ['nope']) });
  const withErrors = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
  assert.equal(withErrors.status, 1);
  assert.match(withErrors.stdout, /error unknown-dependency Trama\/a\.md/);

  const usage = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});

test('CLI --out writes the JSON result', (t) => {
  const root = makeCampaign(t, { 'Trama/a.md': plot('a', []) });
  const out = path.join(root, '.campaign', 'cache', 'plot-map.json');
  const run = spawnSync(process.execPath, [SCRIPT, root, '--out', out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const text = fs.readFileSync(out, 'utf8');
  assert.equal(text, `${JSON.stringify(plotMap(root), null, 2)}\n`);
});
