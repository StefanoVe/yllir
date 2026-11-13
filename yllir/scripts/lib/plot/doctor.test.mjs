import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unreachableNodes, forgottenCharacters } from './doctor.mjs';

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '  - id: cronaca',
  '    folder: Cronaca',
  '    type: chronicle',
  '  - id: personaggi',
  '    folder: Personaggi',
  '    type: subjects',
  '  - id: luoghi',
  '    folder: Mondo',
  '    type: places',
  '',
].join('\n');

/** Creates a temporary campaign with the given files (relative path -> content). */
function makeCampaign(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-doctor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const all = { 'campaign.yaml': CAMPAIGN, 'Cronaca/cronaca.md': chronicle([]), ...files };
  for (const [rel, content] of Object.entries(all)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/** A session main file in its own folder. */
function session(id, dependsOn) {
  return `---\nid: ${id}\ndepends_on: [${dependsOn.join(', ')}]\narc: Arco\n---\n\n# ${id}\n\nTesto.\n`;
}

/** An event file in the Eventi folder of its session. */
function event(id, sessionId, dependsOn, extra = '') {
  return `---\nid: ${id}\nsession: ${sessionId}\ndepends_on: [${dependsOn.join(', ')}]\n${extra}---\n\n# ${id}\n\nTesto.\n`;
}

/** A chronicle page listing the played sessions. */
function chronicle(played, body = '') {
  return `---\nid: cronaca-1\nplayed: [${played.join(', ')}]\nprovenance: played\n---\n\n# Cronaca\n\n${body}\n`;
}

/** A character sheet. */
function character(id, extra = '') {
  return `---\nid: ${id}\nkind: character\nprovenance: master\n${extra}---\n\n# ${id}\n\nTesto.\n`;
}

/** Shorthand for a plain document in a folder with no metadata beyond the id. */
function place(id, body) {
  return `---\nid: ${id}\nkind: place\nprovenance: master\n---\n\n# ${id}\n\n${body}\n`;
}

test('a missing dependency is listed with the missing id', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': session('a', ['ghost']),
  });
  assert.deepEqual(unreachableNodes(root), [
    { id: 'a', file: 'Trama/a/a.md', kind: 'session', reason: 'missing-dependency', via: ['ghost'] },
  ]);
});

test('a missing event dependency is listed as an event', (t) => {
  const root = makeCampaign(t, {
    'Trama/s1/s1.md': session('s1', []),
    'Trama/s1/Eventi/e1.md': event('e1', 's1', ['ghost-event']),
  });
  assert.deepEqual(unreachableNodes(root), [
    { id: 'e1', file: 'Trama/s1/Eventi/e1.md', kind: 'event', reason: 'missing-dependency', via: ['ghost-event'] },
  ]);
});

test('a two-node cycle lists both nodes with the cycle as via', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': session('a', ['b']),
    'Trama/b/b.md': session('b', ['a']),
  });
  assert.deepEqual(unreachableNodes(root), [
    { id: 'a', file: 'Trama/a/a.md', kind: 'session', reason: 'cycle', via: ['a', 'b'] },
    { id: 'b', file: 'Trama/b/b.md', kind: 'session', reason: 'cycle', via: ['a', 'b'] },
  ]);
});

test('a node that depends on the cycle is unreachable through the cycle', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': session('a', ['b']),
    'Trama/b/b.md': session('b', ['a']),
    'Trama/c/c.md': session('c', ['b']),
  });
  const result = unreachableNodes(root);
  assert.deepEqual(
    result.map((r) => [r.id, r.reason, r.via]),
    [
      ['a', 'cycle', ['a', 'b']],
      ['b', 'cycle', ['a', 'b']],
      ['c', 'depends-on-unreachable', ['b']],
    ],
  );
});

test('a played node with a missing dependency is not listed', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': session('a', ['ghost']),
    'Cronaca/cronaca.md': chronicle(['a']),
  });
  assert.deepEqual(unreachableNodes(root), []);
});

test('a clean plot has no unreachable nodes', (t) => {
  const root = makeCampaign(t, {
    'Trama/a/a.md': session('a', []),
    'Trama/b/b.md': session('b', ['a']),
    'Trama/b/Eventi/e1.md': event('e1', 'b', []),
    'Trama/b/Eventi/e2.md': event('e2', 'b', ['e1']),
  });
  assert.deepEqual(unreachableNodes(root), []);
});

test('a character named in an event is not forgotten', (t) => {
  const root = makeCampaign(t, {
    'Trama/s1/s1.md': session('s1', []),
    'Trama/s1/Eventi/e1.md': event('e1', 's1', [], 'characters: [teodo]\n'),
    'Personaggi/teodo.md': character('teodo'),
  });
  assert.deepEqual(forgottenCharacters(root), []);
});

test('a character linked from a chronicle page is not forgotten', (t) => {
  const root = makeCampaign(t, {
    'Cronaca/2026-01-01.md': chronicle([], 'Incontro con [Teodo](../Personaggi/teodo.md).'),
    'Personaggi/teodo.md': character('teodo'),
  });
  assert.deepEqual(forgottenCharacters(root), []);
});

test('a character referenced only from a place sheet is forgotten', (t) => {
  const root = makeCampaign(t, {
    'Mondo/borgo.md': place('borgo', 'Qui vive [Teodo](../Personaggi/teodo.md).'),
    'Personaggi/teodo.md': character('teodo'),
  });
  assert.deepEqual(forgottenCharacters(root), [
    { id: 'teodo', title: 'teodo', file: 'Personaggi/teodo.md', sketch: false },
  ]);
});

test('a sketch character that nothing mentions is forgotten with sketch true', (t) => {
  const root = makeCampaign(t, {
    'Personaggi/schizzo.md': character('schizzo', 'sketch: true\n'),
  });
  assert.deepEqual(forgottenCharacters(root), [
    { id: 'schizzo', title: 'schizzo', file: 'Personaggi/schizzo.md', sketch: true },
  ]);
});
