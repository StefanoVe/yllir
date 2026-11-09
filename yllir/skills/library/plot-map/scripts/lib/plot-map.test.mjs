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
const FIXTURE = path.resolve(HERE, '..', '..', '..', '..', '..', '..', 'testbench', 'fixtures', 'morvalle', 'campaign');

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

/** A session main file; `dependsOn` undefined omits the field, `arc` undefined omits it too. */
function plot(id, dependsOn, arc) {
  const deps = dependsOn === undefined ? '' : `depends_on: [${dependsOn.join(', ')}]\n`;
  const arcLine = arc === undefined ? '' : `arc: ${arc}\n`;
  return `---\nid: ${id}\n${deps}${arcLine}---\n\n# ${id}\n\nTesto.\n`;
}

/** An event file; `session`, `dependsOn` and `location` undefined omit the field. */
function event(id, session, dependsOn, location) {
  const sess = session === undefined ? '' : `session: ${session}\n`;
  const deps = dependsOn === undefined ? '' : `depends_on: [${dependsOn.join(', ')}]\n`;
  const loc = location === undefined ? '' : `location: [${location.join(', ')}]\n`;
  return `---\nid: ${id}\n${sess}${deps}${loc}---\n\n# ${id}\n\nTesto.\n`;
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
    'Trama/Sessione 1/Sessione 1.md': plot('s-01', [], 'Arco'),
    'Trama/Sessione 2/Sessione 2.md': plot('s-02', ['s-01'], 'Arco'),
    'Trama/Sessione 3/Sessione 3.md': plot('s-03', ['s-02'], 'Arco'),
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
  assert.equal(result.sessions[1].file, 'Trama/Sessione 2/Sessione 2.md');
  assert.deepEqual(result.sessions[1].depends_on, ['s-01']);
  assert.deepEqual(result.sessions[1].location, []);
  assert.deepEqual(result.sessions[1].events, []);
});

test('missing depends_on is an error and counts as no prerequisites', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': plot('a', undefined),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['missing-depends-on']);
  assert.equal(result.errors[0].file, 'Trama/a/a.md');
  assert.equal(statuses(result).a, 'ready');
});

test('unknown dependency is reported and the session waits', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': plot('a', ['nope']),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['unknown-dependency']);
  assert.equal(statuses(result).a, 'waiting');
});

test('a cycle is reported once and its members are not ready', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': plot('a', ['b']),
    'Trama/b/b.md': plot('b', ['c']),
    'Trama/c/c.md': plot('c', ['a']),
    'Trama/d/d.md': plot('d', ['a']),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['cycle']);
  assert.match(result.errors[0].message, /a, b, c/);
  assert.equal(result.errors[0].file, 'Trama/a/a.md');
  assert.deepEqual(statuses(result), { a: 'waiting', b: 'waiting', c: 'waiting', d: 'waiting' });
});

test('a self dependency is a cycle', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': plot('a', ['a']),
  });
  assert.deepEqual(codes(plotMap(root)), ['cycle']);
});

test('duplicate plot id keeps the first file and reports the second', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': plot('same', []),
    'Trama/b/b.md': plot('same', []),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['duplicate-id']);
  assert.equal(result.errors[0].file, 'Trama/b/b.md');
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].file, 'Trama/a/a.md');
});

test('chronicle page without played is an error', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': plot('a', []),
    'Cronaca/c.md': chronicle('c-1', undefined),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['missing-played']);
  assert.equal(result.errors[0].file, 'Cronaca/c.md');
});

test('played id that is not a plot document is an error', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': plot('a', []),
    'Cronaca/c.md': chronicle('c-1', ['ghost']),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['unknown-played-id']);
  assert.equal(result.errors[0].file, 'Cronaca/c.md');
});

test('played before a prerequisite is an error', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': plot('a', []),
    'Trama/b/b.md': plot('b', ['a']),
    'Cronaca/c.md': chronicle('c-1', ['b']),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['played-before-prerequisite']);
  assert.equal(result.errors[0].file, 'Trama/b/b.md');
  assert.deepEqual(statuses(result), { a: 'ready', b: 'played' });
});

test('a session file directly in the category folder is a legacy file, not a session', (t) => {
  const root = makeCampaign(t, {
    'Trama/vecchia.md': plot('old', []),
    'Trama/a/a.md': plot('a', []),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['legacy-session-layout']);
  assert.deepEqual(result.errors[0], {
    code: 'legacy-session-layout',
    file: 'Trama/vecchia.md',
    message: 'session file is not in its own folder; run the update',
  });
  assert.deepEqual(
    result.sessions.map((s) => s.id),
    ['a'],
  );
});

test('a file whose name differs from its folder is a legacy file', (t) => {
  const root = makeCampaign(t, {
    'Trama/Arco/Sessione 1.md': plot('s-1', []),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['legacy-session-layout']);
  assert.equal(result.sessions.length, 0);
});

test('arc comes from the metadata, not from the folder', (t) => {
  const root = makeCampaign(t, {
    'Trama/Arco A/Arco A.md': plot('no-arc', []),
    'Trama/Sessione 1/Sessione 1.md': plot('with-arc', [], 'Atto II'),
  });
  const result = plotMap(root);
  assert.deepEqual(result.errors, []);
  const arcOf = Object.fromEntries(result.sessions.map((s) => [s.id, s.arc]));
  assert.deepEqual(arcOf, { 'no-arc': '', 'with-arc': 'Atto II' });
});

test('arcs list sessions in order and give the next number', (t) => {
  const root = makeCampaign(t, {
    'Trama/Intro/Intro.md': plot('intro', []),
    'Trama/Sessione 1/Sessione 1.md': plot('a-1', [], 'Arco A'),
    'Trama/Sessione 3/Sessione 3.md': plot('a-3', ['a-1'], 'Arco A'),
    'Trama/Incontro/Incontro.md': plot('b-x', [], 'Arco B'),
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

test('a non-string arc is an error and the session has no arc', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': `---\nid: a\ndepends_on: []\narc: [x, y]\n---\n\n# a\n`,
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['invalid-arc']);
  assert.equal(result.sessions[0].arc, '');
});

test('event files are listed under their session in topological order', (t) => {
  const root = makeCampaign(t, {
    'Trama/S1/S1.md': plot('s-1', []),
    'Trama/S1/Eventi/c.md': event('c', 's-1', ['b'], ['Porto']),
    'Trama/S1/Eventi/b.md': event('b', 's-1', ['a']),
    'Trama/S1/Eventi/a.md': event('a', 's-1', []),
    'Trama/S1/Eventi/z.md': event('z', 's-1', []),
  });
  const result = plotMap(root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.sessions[0].events.map((e) => e.id),
    ['a', 'b', 'c', 'z'],
  );
  assert.deepEqual(result.sessions[0].events[2], {
    id: 'c',
    file: 'Trama/S1/Eventi/c.md',
    name: 'c',
    depends_on: ['b'],
    location: ['Porto'],
  });
});

test('events in an Events folder belong to their session too', (t) => {
  const root = makeCampaign(t, {
    'Trama/S1/S1.md': plot('s-1', []),
    'Trama/S1/Events/e.md': event('e', 's-1', []),
  });
  const result = plotMap(root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.sessions[0].events.map((e) => e.id),
    ['e'],
  );
});

test('event whose session field names another session is an error and is not listed', (t) => {
  const root = makeCampaign(t, {
    'Trama/S1/S1.md': plot('s-1', []),
    'Trama/S2/S2.md': plot('s-2', []),
    'Trama/S1/Eventi/e.md': event('e', 's-2', []),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['event-session-mismatch']);
  assert.equal(result.errors[0].file, 'Trama/S1/Eventi/e.md');
  assert.deepEqual(result.sessions.map((s) => s.events), [[], []]);
});

test('event in a folder without a valid session file is a session mismatch', (t) => {
  const root = makeCampaign(t, {
    'Trama/S9/Eventi/e.md': event('e', 's-9', []),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['event-session-mismatch']);
  assert.equal(result.sessions.length, 0);
});

test('event without a session field is an error and is not listed', (t) => {
  const root = makeCampaign(t, {
    'Trama/S1/S1.md': plot('s-1', []),
    'Trama/S1/Eventi/e.md': event('e', undefined, []),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['event-missing-session']);
  assert.deepEqual(result.sessions[0].events, []);
});

test('event without id or depends_on is an error', (t) => {
  const root = makeCampaign(t, {
    'Trama/S1/S1.md': plot('s-1', []),
    'Trama/S1/Eventi/no-id.md': `---\nsession: s-1\ndepends_on: []\n---\n\n# x\n`,
    'Trama/S1/Eventi/no-deps.md': event('nd', 's-1', undefined),
    'Trama/S1/Eventi/bad-deps.md': `---\nid: bd\nsession: s-1\ndepends_on: yes\n---\n\n# x\n`,
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), [
    'event-invalid-depends-on',
    'event-missing-depends-on',
    'event-missing-id',
  ]);
  assert.deepEqual(
    result.sessions[0].events.map((e) => e.id),
    ['bd', 'nd'],
  );
});

test('duplicate event id across sessions keeps the first file', (t) => {
  const root = makeCampaign(t, {
    'Trama/S1/S1.md': plot('s-1', []),
    'Trama/S2/S2.md': plot('s-2', []),
    'Trama/S1/Eventi/x.md': event('same', 's-1', []),
    'Trama/S2/Events/y.md': event('same', 's-2', []),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['event-duplicate-id']);
  assert.equal(result.errors[0].file, 'Trama/S2/Events/y.md');
  assert.deepEqual(result.sessions.map((s) => s.events.map((e) => e.id)), [['same'], []]);
  assert.equal(result.sessions[0].events[0].file, 'Trama/S1/Eventi/x.md');
});

test('event depending on something that is not an event is an error', (t) => {
  const root = makeCampaign(t, {
    'Trama/S1/S1.md': plot('s-1', []),
    'Trama/S1/Eventi/e.md': event('e', 's-1', ['ghost']),
    'Trama/S1/Eventi/f.md': event('f', 's-1', ['s-1']),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['event-unknown-dependency', 'event-unknown-dependency']);
  assert.equal(result.errors[0].file, 'Trama/S1/Eventi/e.md');
  assert.equal(result.errors[1].file, 'Trama/S1/Eventi/f.md');
  assert.deepEqual(
    result.sessions[0].events.map((e) => e.id),
    ['e', 'f'],
  );
});

test('event cycle is reported once at the lowest file and its events go last', (t) => {
  const root = makeCampaign(t, {
    'Trama/S1/S1.md': plot('s-1', []),
    'Trama/S1/Eventi/p.md': event('p', 's-1', ['q']),
    'Trama/S1/Eventi/q.md': event('q', 's-1', ['p']),
    'Trama/S1/Eventi/r.md': event('r', 's-1', []),
  });
  const result = plotMap(root);
  assert.deepEqual(codes(result), ['event-cycle']);
  assert.equal(result.errors[0].file, 'Trama/S1/Eventi/p.md');
  assert.match(result.errors[0].message, /p, q/);
  assert.deepEqual(
    result.sessions[0].events.map((e) => e.id),
    ['r', 'p', 'q'],
  );
});

test('event self dependency is an event cycle', (t) => {
  const root = makeCampaign(t, {
    'Trama/S1/S1.md': plot('s-1', []),
    'Trama/S1/Eventi/e.md': event('e', 's-1', ['e']),
  });
  assert.deepEqual(codes(plotMap(root)), ['event-cycle']);
});

test('the same campaign gives the same result every time', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': plot('a', ['b']),
    'Trama/b/b.md': plot('b', ['c']),
    'Trama/c/c.md': plot('c', ['a']),
    'Trama/d/d.md': plot('d', ['zzz']),
    'Trama/d/Eventi/e.md': event('e', 'd', ['nope']),
    'Cronaca/c.md': chronicle('c-1', ['c', 'nope']),
  });
  const first = JSON.stringify(plotMap(root));
  const second = JSON.stringify(plotMap(root));
  assert.equal(first, second);
});

test('morvalle fixture in the session layout: 01 played, 02 ready, 03 waiting, no errors', () => {
  const result = plotMap(FIXTURE);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(statuses(result), {
    'la-cenere-che-canta-01': 'played',
    'la-cenere-che-canta-02': 'ready',
    'la-cenere-che-canta-03': 'waiting',
  });
  assert.deepEqual(result.arcs, [
    {
      arc: 'La cenere che canta',
      sessions: ['la-cenere-che-canta-01', 'la-cenere-che-canta-02', 'la-cenere-che-canta-03'],
      next_number: 4,
    },
  ]);
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
      'exit: 0',
      '',
    ].join('\n'),
  );
});

test('CLI exits 1 on errors and 2 on usage errors', (t) => {
  const root = makeCampaign(t, { 'Trama/a/a.md': plot('a', ['nope']) });
  const withErrors = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
  assert.equal(withErrors.status, 1);
  assert.match(withErrors.stdout, /error unknown-dependency Trama\/a\/a\.md/);

  const usage = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});

test('CLI --out writes the JSON result', (t) => {
  const root = makeCampaign(t, { 'Trama/a/a.md': plot('a', []) });
  const out = path.join(root, '.campaign', 'cache', 'plot-map.json');
  const run = spawnSync(process.execPath, [SCRIPT, root, '--out', out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const text = fs.readFileSync(out, 'utf8');
  assert.equal(text, `${JSON.stringify(plotMap(root), null, 2)}\n`);
});
