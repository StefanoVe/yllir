import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markChunkDone, prepareProseStyle, PROSE_STYLE_STATE } from './prose-style.mjs';

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: people',
  '    folder: People',
  '    type: subjects',
  '  - id: plot',
  '    folder: Trama',
  '    type: plot',
  '',
].join('\n');

const TEODO_SHEET = '---\nid: teodo-marr\n---\n\n# Teodo Marr\n\nUn testo.\n';
const GENERATED_TEODO = '---\nid: nota\nprovenance: generated\n---\n\n# Nota\n\nIncontro con Teodo oggi.\n';
const MASTER_TEODO = '---\nid: nota\nprovenance: master\n---\n\n# Nota\n\nIncontro con Teodo oggi.\n';
const PLAIN = '# Nota\n\nUna nota senza nomi.\n';

/** Writes a temporary campaign, runs `fn` on it and removes it afterwards. */
function withCampaign(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-prose-style-'));
  try {
    const all = {
      'campaign.yaml': CAMPAIGN,
      'People/Teodo Marr.md': TEODO_SHEET,
      ...files,
    };
    for (const [rel, content] of Object.entries(all)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** The 1-based line number of a text in a file. */
function lineOf(text, needle) {
  const index = text.split('\n').findIndex((line) => line === needle);
  assert.notEqual(index, -1, `no line ${needle}`);
  return index + 1;
}

const stateFile = (root) => path.join(root, PROSE_STYLE_STATE);

test('a generated sheet that says a short name is planned with that short name', () => {
  withCampaign({ 'Trama/Nota.md': GENERATED_TEODO }, (root) => {
    const result = prepareProseStyle(root);
    assert.equal(result.status, 'pending');
    assert.equal(result.pending, 1);
    assert.equal(result.chunks.length, 1);
    const chunk = result.chunks[0];
    assert.deepEqual(chunk.files, ['Trama/Nota.md']);
    assert.equal(chunk.status, 'pending');
    const item = chunk.items['Trama/Nota.md'];
    assert.equal(item.shortNames.length, 1);
    assert.equal(item.shortNames[0].word, 'Teodo');
    assert.equal(item.shortNames[0].line, 8);
    assert.deepEqual(item.shortNames[0].subjects, [{ id: 'teodo-marr', title: 'Teodo Marr' }]);
    assert.deepEqual(item.spoken, []);
    assert.equal(fs.existsSync(stateFile(root)), true);
  });
});

test('a master sheet with the same text is not planned', () => {
  withCampaign({ 'Trama/Nota.md': MASTER_TEODO }, (root) => {
    const result = prepareProseStyle(root);
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.chunks, []);
  });
});

test('a generated sheet with a read-aloud italic paragraph is planned with its line in spoken', () => {
  const text = '---\nid: molo\nprovenance: generated\n---\n\n# Molo\n\nUn molo di pietra.\n\n_La nebbia sale dal molo prima dell\'alba._\n';
  withCampaign({ 'Trama/Molo.md': text }, (root) => {
    const result = prepareProseStyle(root);
    assert.equal(result.status, 'pending');
    const item = result.chunks[0].items['Trama/Molo.md'];
    assert.deepEqual(item.shortNames, []);
    assert.deepEqual(item.spoken, [lineOf(text, "_La nebbia sale dal molo prima dell'alba._")]);
  });
});

test('direct speech is a spoken line; a line in the master block is never in spoken', () => {
  const text = [
    '---',
    'id: torre',
    'provenance: generated',
    '---',
    '',
    '# Torre',
    '',
    '_Il vento entra dalla finestra._',
    '',
    '«Venite dentro», dice il custode.',
    '',
    '<!-- master -->',
    '## Master',
    '',
    '_Segreto del custode._',
    '<!-- /master -->',
    '',
  ].join('\n');
  withCampaign({ 'Trama/Torre.md': text }, (root) => {
    const result = prepareProseStyle(root);
    const item = result.chunks[0].items['Trama/Torre.md'];
    assert.deepEqual(item.spoken, [lineOf(text, '_Il vento entra dalla finestra._'), lineOf(text, '«Venite dentro», dice il custode.')]);
    assert.equal(item.spoken.includes(lineOf(text, '_Segreto del custode._')), false);
  });
});

test('a generated sheet with only a master-block italic line is not planned', () => {
  const text = '---\nid: torre\nprovenance: generated\n---\n\n# Torre\n\nUn testo neutro.\n\n<!-- master -->\n## Master\n\n_Segreto del custode._\n<!-- /master -->\n';
  withCampaign({ 'Trama/Torre.md': text }, (root) => {
    const result = prepareProseStyle(root);
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.chunks, []);
  });
});

test('no candidates: the pass is complete with no chunks', () => {
  withCampaign({ 'Trama/Nota.md': PLAIN }, (root) => {
    const result = prepareProseStyle(root);
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.chunks, []);
    assert.equal(result.pending, 0);
  });
});

test('five planned files make two chunks, of four and one', () => {
  const files = {};
  for (let i = 1; i <= 5; i++) files[`Trama/Nota ${i}.md`] = GENERATED_TEODO;
  withCampaign(files, (root) => {
    const result = prepareProseStyle(root);
    assert.deepEqual(result.chunks.map((chunk) => [chunk.id, chunk.files.length]), [['c1', 4], ['c2', 1]]);
    assert.equal(result.pending, 2);
  });
});

test('persist false writes no state file', () => {
  withCampaign({ 'Trama/Nota.md': GENERATED_TEODO }, (root) => {
    const result = prepareProseStyle(root, { persist: false });
    assert.equal(result.chunks.length, 1);
    assert.equal(fs.existsSync(stateFile(root)), false);
  });
});

test('markChunkDone completes the chunks and saves the state', () => {
  const files = {};
  for (let i = 1; i <= 5; i++) files[`Trama/Nota ${i}.md`] = GENERATED_TEODO;
  withCampaign(files, (root) => {
    prepareProseStyle(root);
    const first = markChunkDone(root, 'c1');
    assert.equal(first.status, 'pending');
    assert.equal(first.pending, 1);
    const second = markChunkDone(root, 'c2');
    assert.equal(second.status, 'complete');
    assert.equal(second.pending, 0);
    assert.equal(JSON.parse(fs.readFileSync(stateFile(root), 'utf8')).status, 'complete');
  });
});

test('markChunkDone with an unknown id fails and changes nothing', () => {
  withCampaign({ 'Trama/Nota.md': GENERATED_TEODO }, (root) => {
    prepareProseStyle(root);
    const before = fs.readFileSync(stateFile(root), 'utf8');
    const result = markChunkDone(root, 'c9');
    assert.equal(result.status, 'failed');
    assert.equal(result.errors[0].code, 'unknown-chunk');
    assert.equal(fs.readFileSync(stateFile(root), 'utf8'), before);
  });
});

test('markChunkDone before a preparation fails', () => {
  withCampaign({ 'Trama/Nota.md': GENERATED_TEODO }, (root) => {
    const result = markChunkDone(root, 'c1');
    assert.equal(result.status, 'failed');
    assert.equal(result.errors[0].code, 'no-prose-style');
  });
});

test('an existing state file is kept as it is', () => {
  withCampaign({ 'Trama/Nota.md': GENERATED_TEODO }, (root) => {
    const custom = {
      status: 'pending',
      chunks: [{ id: 'c9', files: ['Trama/Nota.md'], status: 'done' }, { id: 'c10', files: ['Trama/Altra.md'], status: 'pending' }],
    };
    fs.mkdirSync(path.dirname(stateFile(root)), { recursive: true });
    const text = `${JSON.stringify(custom, null, 2)}\n`;
    fs.writeFileSync(stateFile(root), text);

    const result = prepareProseStyle(root);
    assert.deepEqual(result.chunks.map((chunk) => chunk.id), ['c9', 'c10']);
    assert.equal(result.status, 'pending');
    assert.equal(result.pending, 1);
    assert.equal(fs.readFileSync(stateFile(root), 'utf8'), text);
  });
});
