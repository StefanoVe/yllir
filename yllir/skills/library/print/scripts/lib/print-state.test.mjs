import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { rewritePrintState, setPrintState } from './print-state.mjs';
import { objectSheet, makeCampaign, removeCampaign, readText } from './fixtures.mjs';

const SHEET = '<!-- yllir\nid: x\ntemplate: item\nlocation: [p]\n-->\n# X\n';

test('print line: added after location when missing', () => {
  const r = rewritePrintState(SHEET, 'to-print');
  assert.equal(r.text, '<!-- yllir\nid: x\ntemplate: item\nlocation: [p]\nprint: to-print\n-->\n# X\n');
  assert.equal(r.changed, true);
});

test('print line: added after template when there is no location', () => {
  const r = rewritePrintState('<!-- yllir\nid: x\ntemplate: item\n-->\n# X\n', 'printed');
  assert.equal(r.text, '<!-- yllir\nid: x\ntemplate: item\nprint: printed\n-->\n# X\n');
});

test('print line: added after id when only id is present, first in the block otherwise', () => {
  assert.equal(rewritePrintState('<!-- yllir\nid: x\n-->\n# X', 'reprint').text, '<!-- yllir\nid: x\nprint: reprint\n-->\n# X');
  assert.equal(rewritePrintState('<!-- yllir\npersonal: true\n-->\n# X', 'reprint').text, '<!-- yllir\nprint: reprint\npersonal: true\n-->\n# X');
});

test('print line: an existing key is replaced in place, other lines untouched', () => {
  const text = SHEET.replace('location: [p]', 'location: [p]\nprint: to-print\npersonal: true');
  const r = rewritePrintState(text, 'printed');
  assert.equal(r.text, text.replace('print: to-print', 'print: printed'));
  assert.equal(r.changed, true);
  assert.equal(rewritePrintState(text, 'to-print').changed, false, 'same state is not a change');
});

test('print line: CRLF endings are kept', () => {
  const r = rewritePrintState('<!-- yllir\r\nid: x\r\nlocation: [p]\r\n-->\r\n# X\r\n', 'to-print');
  assert.equal(r.text, '<!-- yllir\r\nid: x\r\nlocation: [p]\r\nprint: to-print\r\n-->\r\n# X\r\n');
});

test('print line: the dashes form is updated in place too', () => {
  const r = rewritePrintState('---\nid: x\nprint: to-print\n---\n# X', 'printed');
  assert.equal(r.text, '---\nid: x\nprint: printed\n---\n# X');
});

test('print line: a sheet without a closed metadata block is refused', () => {
  assert.equal(rewritePrintState('# X\n', 'printed').code, 'no-metadata');
  assert.equal(rewritePrintState('<!-- yllir\nid: x\n# X\n', 'printed').code, 'metadata-not-closed');
});

test('print line: nothing else of the sheet changes', () => {
  const body = '<!-- yllir\nid: x\n-->\n# X\n\nTesto con print: dentro del corpo.\n';
  const r = rewritePrintState(body, 'to-print');
  assert.equal(r.text, '<!-- yllir\nid: x\nprint: to-print\n-->\n# X\n\nTesto con print: dentro del corpo.\n');
});

test('setPrintState: review first, then the write cycle saves the change as one version', async () => {
  const root = makeCampaign({
    sheets: { 'Oggetti/Lanterna.md': objectSheet({ id: 'lanterna', title: 'Lanterna', shortText: 'Breve.' }) },
  });
  try {
    const commitsBefore = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: root }).toString().trim();

    const first = await setPrintState(root, 'lanterna', 'to-print');
    assert.equal(first.ok, false);
    assert.equal(first.reviewRequired, true);
    assert.equal(first.errors[0].code, 'review-required');
    assert.equal(first.path, 'Oggetti/Lanterna.md');
    assert.equal(readText(root, 'Oggetti/Lanterna.md').includes('print:'), false, 'nothing saved before the review');
    assert.ok(fs.existsSync(path.join(root, '.campaign/drafts/Oggetti/Lanterna.md')), 'the draft is written');
    assert.ok(readText(root, '.campaign/drafts/Oggetti/Lanterna.md').includes('print: to-print'));

    // The test stands in for the batch reviewer, which the assistant launches in production.
    fs.mkdirSync(path.join(root, '.campaign/state/engine'), { recursive: true });
    fs.writeFileSync(path.join(root, '.campaign/state/engine/review.json'), '{"outcome":"APPLY"}\n');

    const second = await setPrintState(root, 'lanterna', 'to-print');
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.id, 'lanterna');
    assert.equal(second.state, 'to-print');
    assert.match(readText(root, 'Oggetti/Lanterna.md'), /^print: to-print$/m);
    const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: root }).toString().trim();
    assert.equal(subject, 'Print state: Lanterna -> to-print');
    const commitsAfter = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: root }).toString().trim();
    assert.equal(Number(commitsAfter), Number(commitsBefore) + 1);

    const same = await setPrintState(root, 'lanterna', 'to-print');
    assert.equal(same.ok, true);
    assert.equal(same.unchanged, true);
    const commitsSame = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: root }).toString().trim();
    assert.equal(commitsSame, commitsAfter, 'an unchanged state saves nothing');
  } finally {
    removeCampaign(root);
  }
});

test('setPrintState refuses an unknown state, an unknown id and a duplicate id without writing', async () => {
  const root = makeCampaign({
    sheets: {
      'Oggetti/A.md': objectSheet({ id: 'dup', title: 'A', shortText: 'a' }),
      'Oggetti/B.md': objectSheet({ id: 'dup', title: 'B', shortText: 'b' }),
    },
  });
  try {
    assert.equal((await setPrintState(root, 'dup', 'done')).errors[0].code, 'bad-state');
    assert.equal((await setPrintState(root, 'nessuno', 'to-print')).errors[0].code, 'not-found');
    assert.equal((await setPrintState(root, 'dup', 'to-print')).errors[0].code, 'duplicate-id');
    assert.equal(fs.existsSync(path.join(root, '.campaign/drafts')), false);
  } finally {
    removeCampaign(root);
  }
});
