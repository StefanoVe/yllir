import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForm, slugify, headingAnchor } from './normalize.mjs';

test('normalizeForm examples', () => {
  assert.equal(normalizeForm('Torre dell’Àscia'), "torre dell'ascia");
  assert.equal(normalizeForm('  Pozzo   di Nàrem '), 'pozzo di narem');
});

test('normalizeForm apostrophe variants', () => {
  assert.equal(normalizeForm('l’acqua'), "l'acqua"); // right single quotation mark
  assert.equal(normalizeForm('l‘acqua'), "l'acqua"); // left single quotation mark
  assert.equal(normalizeForm('lʼacqua'), "l'acqua"); // modifier letter apostrophe
  assert.equal(normalizeForm('l´acqua'), "l'acqua"); // acute accent
  assert.equal(normalizeForm('l`acqua'), "l'acqua"); // grave accent
});

test('normalizeForm dash variants', () => {
  assert.equal(normalizeForm('a‐b‑c‒d–e—f―g'), 'a-b-c-d-e-f-g');
});

test('normalizeForm collapses whitespace', () => {
  assert.equal(normalizeForm('a \t\n  b'), 'a b');
});

test('slugify examples', () => {
  assert.equal(slugify('Torre dell’Àscia'), 'torre-dell-ascia');
  assert.equal(slugify('Borgo Cenere 2'), 'borgo-cenere-2');
});

test('slugify handles dash and apostrophe variants and edge characters', () => {
  assert.equal(slugify('Porta—Nord'), 'porta-nord');
  assert.equal(slugify('l’Ombra'), 'l-ombra');
  assert.equal(slugify('  --Hello, World!--  '), 'hello-world');
});

test('headingAnchor examples', () => {
  assert.equal(headingAnchor('Indicazioni per il master'), 'indicazioni-per-il-master');
  assert.equal(headingAnchor('Città d’Ombra'), 'città-dombra');
  assert.equal(headingAnchor('Master'), 'master');
});

test('headingAnchor does not collapse spaces or keep punctuation', () => {
  assert.equal(headingAnchor(' A  B - C_d! '), 'a--b---c_d');
});
