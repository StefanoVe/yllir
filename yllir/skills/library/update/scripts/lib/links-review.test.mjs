import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markChunkDone, prepareLinksReview, LINKS_REVIEW_STATE } from './links-review.mjs';

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

const TEODO = '# Teodo Marr\n\nUn testo.\n';
const MENTION = '# Nota\n\nIncontro con Teodo Marr oggi.\n';
const PLAIN = '# Nota\n\nUna nota senza nomi.\n';

/** Writes a temporary campaign, runs `fn` on it and removes it afterwards. */
function withCampaign(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-links-review-'));
  try {
    const all = {
      'campaign.yaml': CAMPAIGN,
      'People/Teodo Marr.md': `---\nid: teodo-marr\n---\n\n${TEODO}`,
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

/** Seven plot notes, each with one mention of the subject. */
function sevenNotes() {
  const files = {};
  for (let i = 1; i <= 7; i++) files[`Trama/Nota ${String(i).padStart(2, '0')}.md`] = MENTION;
  return files;
}

const stateFile = (root) => path.join(root, LINKS_REVIEW_STATE);

test('no proposals: the pass is complete with no chunks', () => {
  withCampaign({ 'Trama/Nota.md': PLAIN }, (root) => {
    const result = prepareLinksReview(root);
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.chunks, []);
    assert.equal(result.pending, 0);
  });
});

test('proposals across seven files make two chunks, of six and one', () => {
  withCampaign(sevenNotes(), (root) => {
    const result = prepareLinksReview(root);
    assert.equal(result.status, 'pending');
    assert.equal(result.pending, 2);
    assert.equal(result.chunks.length, 2);
    assert.deepEqual(
      result.chunks.map((chunk) => [chunk.id, chunk.files.length, chunk.status]),
      [['c1', 6, 'pending'], ['c2', 1, 'pending']],
    );
    assert.deepEqual(result.chunks[0].files, [
      'Trama/Nota 01.md', 'Trama/Nota 02.md', 'Trama/Nota 03.md',
      'Trama/Nota 04.md', 'Trama/Nota 05.md', 'Trama/Nota 06.md',
    ]);
    assert.deepEqual(result.chunks[1].files, ['Trama/Nota 07.md']);
    assert.equal(fs.existsSync(stateFile(root)), true);
  });
});

test('persist false writes no state file', () => {
  withCampaign(sevenNotes(), (root) => {
    const result = prepareLinksReview(root, { persist: false });
    assert.equal(result.chunks.length, 2);
    assert.equal(fs.existsSync(stateFile(root)), false);
  });
});

test('markChunkDone completes the chunks one by one and saves the state', () => {
  withCampaign(sevenNotes(), (root) => {
    prepareLinksReview(root);
    const first = markChunkDone(root, 'c1');
    assert.equal(first.status, 'pending');
    assert.equal(first.pending, 1);
    const saved = JSON.parse(fs.readFileSync(stateFile(root), 'utf8'));
    assert.equal(saved.chunks[0].status, 'done');
    assert.equal(saved.chunks[1].status, 'pending');

    const second = markChunkDone(root, 'c2');
    assert.equal(second.status, 'complete');
    assert.equal(second.pending, 0);
    assert.equal(JSON.parse(fs.readFileSync(stateFile(root), 'utf8')).status, 'complete');
  });
});

test('markChunkDone with an unknown id fails and changes nothing', () => {
  withCampaign(sevenNotes(), (root) => {
    prepareLinksReview(root);
    const before = fs.readFileSync(stateFile(root), 'utf8');
    const result = markChunkDone(root, 'c9');
    assert.equal(result.status, 'failed');
    assert.equal(result.errors[0].code, 'unknown-chunk');
    assert.equal(fs.readFileSync(stateFile(root), 'utf8'), before);
  });
});

test('markChunkDone before a preparation fails', () => {
  withCampaign(sevenNotes(), (root) => {
    const result = markChunkDone(root, 'c1');
    assert.equal(result.status, 'failed');
    assert.equal(result.errors[0].code, 'no-links-review');
  });
});

test('an existing state file is kept as it is', () => {
  withCampaign(sevenNotes(), (root) => {
    const custom = {
      status: 'pending',
      chunks: [{ id: 'c9', files: ['Trama/Nota 03.md'], status: 'done' }, { id: 'c10', files: ['Trama/Nota 04.md'], status: 'pending' }],
    };
    fs.mkdirSync(path.dirname(stateFile(root)), { recursive: true });
    const text = `${JSON.stringify(custom, null, 2)}\n`;
    fs.writeFileSync(stateFile(root), text);

    const result = prepareLinksReview(root);
    assert.deepEqual(result.chunks.map((chunk) => chunk.id), ['c9', 'c10']);
    assert.equal(result.status, 'pending');
    assert.equal(result.pending, 1);
    assert.equal(fs.readFileSync(stateFile(root), 'utf8'), text);
  });
});

test('a state file whose chunks are all done is complete', () => {
  withCampaign(sevenNotes(), (root) => {
    fs.mkdirSync(path.dirname(stateFile(root)), { recursive: true });
    fs.writeFileSync(stateFile(root), JSON.stringify({ status: 'pending', chunks: [{ id: 'c1', files: ['Trama/Nota 01.md'], status: 'done' }] }));
    const result = prepareLinksReview(root);
    assert.equal(result.status, 'complete');
    assert.equal(result.pending, 0);
  });
});
