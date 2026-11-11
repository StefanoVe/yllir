import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicBody, isPublicDocument, publicText } from './public-text.mjs';

const CONFIG = {
  campaign: { seed: 'Mondo/seed.md' },
  structure: [
    { id: 'personaggi', folder: 'Personaggi', type: 'player-facing' },
    { id: 'giocatori', folder: 'Giocatori', type: 'master-only' },
  ],
};

test('publicBody drops a comment metadata block and the master-only part', () => {
  const text = '<!-- yllir\nkind: subject\n-->\n# Title\nPublic line.\n<!-- master -->\nSECRET-TOKEN';
  const body = publicBody(text);
  assert.ok(body.includes('Public line.'));
  assert.ok(!body.includes('SECRET-TOKEN'));
  assert.ok(!body.includes('kind: subject'));
});

test('publicBody drops a dashes frontmatter and the master-only part', () => {
  const text = '---\nkind: x\n---\n# Title\nPublic line.\n<!-- master -->\nSECRET-TOKEN';
  const body = publicBody(text);
  assert.ok(body.includes('Public line.'));
  assert.ok(!body.includes('SECRET-TOKEN'));
  assert.ok(!body.includes('kind: x'));
});

test('publicBody returns the whole body when there is no master marker', () => {
  const text = '# Title\nPlain text.\n';
  assert.equal(publicBody(text), text);
});

test('isPublicDocument: seed, master-only folders, internal folder and ordinary paths', () => {
  assert.equal(isPublicDocument('Mondo/seed.md', CONFIG), false);
  assert.equal(isPublicDocument('Giocatori/Lino.md', CONFIG), false);
  assert.equal(isPublicDocument('Giocatori\\Lino.md', CONFIG), false);
  assert.equal(isPublicDocument('Personaggi/Oria.md', CONFIG), true);
  assert.equal(isPublicDocument('.campaign/x.md', CONFIG), false);
});

test('isPublicDocument does not throw on an empty config', () => {
  assert.equal(isPublicDocument('A/b.md', {}), true);
  assert.equal(isPublicDocument('A/b.md', null), true);
});

test('publicText returns null for the seed', () => {
  assert.equal(publicText('# Seed\nText', 'Mondo/seed.md', CONFIG), null);
});

test('publicText returns the trimmed public body for a public document', () => {
  const text = '<!-- yllir\nkind: subject\n-->\n# Title\nPublic line.\n<!-- master -->\nSECRET-TOKEN';
  const result = publicText(text, 'Personaggi/Oria.md', CONFIG);
  assert.equal(result, '# Title\nPublic line.');
});
