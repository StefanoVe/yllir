import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workNote } from './work-note.mjs';

function campaignWithNote(text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-work-note-'));
  if (text !== null) {
    fs.mkdirSync(path.join(root, '.campaign', 'state'), { recursive: true });
    fs.writeFileSync(path.join(root, '.campaign', 'state', 'work-note.md'), text);
  }
  return root;
}

test('returns the text of the note line', () => {
  const root = campaignWithNote('# Work in progress\nupdated: 2026-11-10T10:00:00.000Z\nlast saved: none\nfiles: a.md\nnote: Rivedere Teodo.\n');
  assert.equal(workNote(root), 'Rivedere Teodo.');
});

test('a note line of none, an empty note or a missing file gives none', () => {
  assert.equal(workNote(campaignWithNote('note: none\n')), 'none');
  assert.equal(workNote(campaignWithNote('note:   \n')), 'none');
  assert.equal(workNote(campaignWithNote(null)), 'none');
});

test('a file without a note line gives none', () => {
  assert.equal(workNote(campaignWithNote('# Work in progress\nfiles: a.md\n')), 'none');
});
