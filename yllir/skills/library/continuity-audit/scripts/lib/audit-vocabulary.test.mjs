import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadVocabulary, checkAttribute, checkValue } from './audit-vocabulary.mjs';

const vocab = loadVocabulary();

test('the default vocabulary file loads with its families and source types', () => {
  assert.deepEqual(
    vocab.families.map((f) => f.family),
    ['date', 'number', 'location', 'origin', 'status', 'relation'],
  );
  assert.deepEqual(vocab.sourceTypes, [
    'author-clarification',
    'source-claim',
    'editorial-summary',
    'hypothesis',
  ]);
});

test('loadVocabulary rejects a file with the wrong shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  try {
    const file = path.join(dir, 'vocab.yaml');
    fs.writeFileSync(file, 'families: 3\nsource_types: [a]\n');
    assert.throws(() => loadVocabulary(file), /families and source_types must be lists/);
    fs.writeFileSync(file, 'families:\n  - family: date\n    single: true\n    value: nope\n    names: any\nsource_types: [a]\n');
    assert.throws(() => loadVocabulary(file), /invalid family definition/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attribute: malformed attributes are rejected', () => {
  for (const attr of ['date', 'Date.founded', 'date.founded-', 'date..x', 'date.-x', '', 42]) {
    const result = checkAttribute(vocab, attr);
    assert.equal(result.ok, false, `expected ${JSON.stringify(attr)} to fail`);
    assert.ok(result.reason);
  }
});

test('attribute: unknown family is rejected', () => {
  const result = checkAttribute(vocab, 'mood.happy');
  assert.equal(result.ok, false);
  assert.match(result.reason, /family not in vocabulary: mood/);
});

test('attribute: name must be in the family list when the list is given', () => {
  const result = checkAttribute(vocab, 'date.bogus');
  assert.equal(result.ok, false);
  assert.match(result.reason, /name not allowed for family date/);
  assert.equal(checkAttribute(vocab, 'status.alive').ok, true);
  assert.equal(checkAttribute(vocab, 'status.dead').ok, false);
});

test('attribute: a family with names any accepts any kebab-case name', () => {
  for (const attr of ['number.hit-points', 'number.depth', 'number.age2']) {
    assert.equal(checkAttribute(vocab, attr).ok, true, attr);
  }
});

test('attribute: valid attributes return the family rules', () => {
  assert.deepEqual(checkAttribute(vocab, 'relation.parent-of'), {
    ok: true,
    family: 'relation',
    name: 'parent-of',
    single: false,
    valueKind: 'id',
  });
  assert.deepEqual(checkAttribute(vocab, 'date.founded'), {
    ok: true,
    family: 'date',
    name: 'founded',
    single: true,
    valueKind: 'date',
  });
});

test('value date needs at least one digit', () => {
  assert.equal(checkValue('date', '1820', new Set()).ok, true);
  assert.equal(checkValue('date', 'anno 3', new Set()).ok, true);
  assert.equal(checkValue('date', 'mille', new Set()).ok, false);
});

test('value number matches digits with an optional decimal point and sign', () => {
  for (const ok of ['45', '2.5', '-3', '0']) {
    assert.equal(checkValue('number', ok, new Set()).ok, true, ok);
  }
  for (const bad of ['2.', '.5', '1e3', 'molti', ' 45', '']) {
    assert.equal(checkValue('number', bad, new Set()).ok, false, JSON.stringify(bad));
  }
});

test('value id must be a known subject id', () => {
  const ids = new Set(['oria-valdes']);
  assert.equal(checkValue('id', 'oria-valdes', ids).ok, true);
  assert.equal(checkValue('id', 'lino', ids).ok, false);
  assert.equal(checkValue('id', 'oria-valdes', ['oria-valdes']).ok, true);
});

test('value ids splits on commas, trims, and rejects empty parts without requiring they exist', () => {
  assert.equal(checkValue('ids', 'morvalle', new Set()).ok, true);
  assert.equal(checkValue('ids', 'morvalle, Borgo Cenere', new Set()).ok, true);
  assert.equal(checkValue('ids', 'morvalle,,borgo', new Set()).ok, false);
  assert.equal(checkValue('ids', 'morvalle,', new Set()).ok, false);
  assert.equal(checkValue('ids', '', new Set()).ok, false);
});

test('value text must not be empty after trimming', () => {
  assert.equal(checkValue('text', 'vivo', new Set()).ok, true);
  assert.equal(checkValue('text', '   ', new Set()).ok, false);
});

test('value must be a string', () => {
  assert.equal(checkValue('text', 42, new Set()).ok, false);
});
