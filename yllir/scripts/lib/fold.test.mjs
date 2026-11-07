import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldText, foldForm } from './fold.mjs';

test('ASCII input without double spaces folds to lower case', () => {
  for (const s of ['Oria Valdes', 'abc DEF 123', 'Torre-Alta', 'x']) {
    assert.equal(foldText(s).folded, s.toLowerCase());
  }
});

test('foldForm examples', () => {
  assert.equal(foldForm('Pozzo di Nàrem'), 'pozzo di narem');
  assert.equal(foldForm('Torre dell’Ascia'), "torre dell'ascia");
  assert.equal(foldForm('  Oria  Valdes  '), 'oria valdes');
});

test('apostrophe and dash variants', () => {
  assert.equal(foldText('l‘acqua ʼx´y`z').folded, "l'acqua 'x'y'z");
  assert.equal(foldText('a–b—c').folded, 'a-b-c');
});

test('whitespace runs collapse to one space and edges are trimmed', () => {
  assert.equal(foldText('a   b').folded, 'a b');
  assert.equal(foldText('  a \t\n b  ').folded, 'a b');
  assert.equal(foldText('   ').folded, '');
});

test('empty input', () => {
  assert.deepEqual(foldText(''), { folded: '', map: [] });
});

test('map points back to the original characters', () => {
  const { folded, map } = foldText('Nàrem x');
  assert.equal(folded, 'narem x');
  assert.equal(map.length, folded.length);
  assert.equal(folded[2], 'r');
  assert.equal(map[2], 2);
  assert.equal(map[6], 6);
});

test('map follows collapsed whitespace and dropped trailing space', () => {
  const s = 'ab   cd  ';
  const { folded, map } = foldText(s);
  assert.equal(folded, 'ab cd');
  assert.equal(map[2], 2); // the single space comes from the first space of the run
  assert.equal(map[3], 5); // 'c'
  assert.equal(map[4], 6); // 'd'
});

test('map of a curly apostrophe points to the curly apostrophe', () => {
  const s = 'dell’Ascia';
  const { folded, map } = foldText(s);
  assert.equal(folded, "dell'ascia");
  assert.equal(map[4], 4);
});
