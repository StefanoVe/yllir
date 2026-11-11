import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderSessionMap, writeSessionMaps } from './session-map.mjs';

// Inputs are built by hand, in the shape that plotMap returns.
function session(overrides = {}) {
  return {
    id: 'faro',
    file: 'Trama/Il faro/Il faro.md',
    arc: '',
    name: 'Il faro',
    depends_on: [],
    location: [],
    played: false,
    ready: false,
    events: [],
    ...overrides,
  };
}

function event(id, name, depends_on = [], file = `Trama/Il faro/Eventi/${name}.md`) {
  return { id, file, name, depends_on, location: [] };
}

const THREE_EVENTS = session({
  depends_on: ['ponte'],
  location: ['porto', 'scogliera'],
  arc: 'Ombre',
  events: [
    event('arrivo', 'Arrivo', []),
    event('scoperta', 'Scoperta del diario', ['arrivo']),
    event('fuga', 'Fuga', ['arrivo', 'scoperta']),
  ],
});

test('renders metadata block, mermaid graph, and the three sections for 3 events and 2 edges', () => {
  const text = renderSessionMap(THREE_EVENTS);
  const expected = [
    '<!-- yllir',
    'id: faro',
    'depends_on: [ponte]',
    'provenance: generated',
    'location: [porto, scogliera]',
    'arc: "Ombre"',
    'generated: true',
    '-->',
    '',
    '> Generated file. Do not edit by hand: it is rebuilt from the files in Eventi/.',
    '',
    '```mermaid',
    'flowchart TD',
    '  e1["Arrivo"]',
    '  e2["Scoperta del diario"]',
    '  e3["Fuga"]',
    '  e1 --> e2',
    '  e1 --> e3',
    '  e2 --> e3',
    '```',
    '',
    '## Events',
    '',
    '- [Arrivo](Eventi/Arrivo.md)',
    '- [Scoperta del diario](Eventi/Scoperta%20del%20diario.md)',
    '- [Fuga](Eventi/Fuga.md)',
    '',
    '## Entry points',
    '',
    '- Arrivo',
    '',
    '## Exits',
    '',
    '- Fuga',
    '',
  ].join('\n');
  assert.equal(text, expected);
});

test('omits arc when empty and writes [] for empty lists', () => {
  const text = renderSessionMap(session());
  assert.match(text, /^<!-- yllir\nid: faro\ndepends_on: \[\]\nprovenance: generated\nlocation: \[\]\ngenerated: true\n-->\n/);
  assert.doesNotMatch(text, /arc:/);
});

test('without events there is no mermaid block and every list says none', () => {
  const text = renderSessionMap(session({ depends_on: ['x'] }));
  assert.doesNotMatch(text, /mermaid/);
  assert.equal(
    text.slice(text.indexOf('## Events')),
    '## Events\n\n- none\n\n## Entry points\n\n- none\n\n## Exits\n\n- none\n',
  );
});

test('quotes inside event names become single quotes in the mermaid labels only', () => {
  const text = renderSessionMap(
    session({
      events: [event('dialogo', 'Il "capo" parla', []), event('seguito', 'Seguito', ['dialogo'])],
    }),
  );
  assert.match(text, /  e1\["Il 'capo' parla"\]\n/);
  assert.match(text, /  e2\["Seguito"\]\n/);
  assert.match(text, /  e1 --> e2\n/);
  assert.match(text, /^- \[Il "capo" parla\]\(Eventi\/Il%20"capo"%20parla\.md\)$/m);
});

test('a dependency on an event outside the session gives no edge and does not crash', () => {
  const text = renderSessionMap(
    session({
      events: [event('a', 'Alfa', ['esterno'])],
    }),
  );
  assert.doesNotMatch(text, /^  e\d+ --> e\d+$/m);
  assert.match(text, /## Entry points\n\n- Alfa\n/);
  assert.match(text, /## Exits\n\n- Alfa\n/);
});

test('writeSessionMaps writes once, then reports unchanged on the second run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-map-'));
  try {
    const folder = path.join(root, 'Trama', 'Il faro');
    fs.mkdirSync(folder, { recursive: true });
    fs.mkdirSync(path.join(folder, 'Eventi'));
    const sessions = [THREE_EVENTS];

    const first = writeSessionMaps(root, sessions);
    assert.deepEqual(first, { written: ['Trama/Il faro/Il faro.md'], unchanged: [] });
    const target = path.join(folder, 'Il faro.md');
    assert.equal(fs.readFileSync(target, 'utf8'), renderSessionMap(THREE_EVENTS));

    const second = writeSessionMaps(root, sessions);
    assert.deepEqual(second, { written: [], unchanged: ['Trama/Il faro/Il faro.md'] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a hand-edited main file is overwritten with the generated text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-map-'));
  try {
    const folder = path.join(root, 'Trama', 'Il faro');
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, 'Il faro.md');
    fs.writeFileSync(target, 'Manually written text\n');

    const result = writeSessionMaps(root, [THREE_EVENTS]);
    assert.deepEqual(result, { written: ['Trama/Il faro/Il faro.md'], unchanged: [] });
    assert.equal(fs.readFileSync(target, 'utf8'), renderSessionMap(THREE_EVENTS));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps the provenance of the existing main file and places it right after depends_on', () => {
  const text = renderSessionMap(session({ depends_on: ['ponte'], provenance: 'master', events: [event('a', 'Alfa')] }));
  assert.match(text, /^<!-- yllir\nid: faro\ndepends_on: \[ponte\]\nprovenance: master\nlocation: \[\]\ngenerated: true\n-->\n/);
});

test('keeps played and generated provenance as read', () => {
  for (const value of ['played', 'generated']) {
    const text = renderSessionMap(session({ provenance: value }));
    assert.match(text, new RegExp(`^<!-- yllir\\nid: faro\\ndepends_on: \\[\\]\\nprovenance: ${value}\\n`));
  }
});

test('a missing or invalid provenance becomes generated', () => {
  for (const value of [undefined, null, '', 'invented', 'Master']) {
    const text = renderSessionMap(session({ provenance: value }));
    assert.match(text, /^<!-- yllir\nid: faro\ndepends_on: \[\]\nprovenance: generated\n/);
    assert.equal(text.match(/^provenance:/gm).length, 1);
  }
});

test('writeSessionMaps keeps master provenance of the existing main file on regeneration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-map-'));
  try {
    const folder = path.join(root, 'Trama', 'Il faro');
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, 'Il faro.md');
    const sessions = [session({ provenance: 'master', events: [event('a', 'Alfa')] })];

    writeSessionMaps(root, sessions);
    assert.match(fs.readFileSync(target, 'utf8'), /^<!-- yllir\nid: faro\ndepends_on: \[\]\nprovenance: master\n/);

    const again = writeSessionMaps(root, sessions);
    assert.deepEqual(again, { written: [], unchanged: ['Trama/Il faro/Il faro.md'] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
