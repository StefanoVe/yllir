import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from '../../vendor/print-libs.mjs';
import { renderCardPng, wrapPixels, textWidth, FACE_WIDTH, FACE_HEIGHT } from './node-card.mjs';
import { glyphFor, hasGlyph, GLYPH_WIDTH, GLYPH_HEIGHT } from './pixel-font.mjs';

test('the face is 1500 x 2100 pixels (5 x 7 inch at 300 dpi) with the border in ink', () => {
  const { png, truncated } = renderCardPng({ id: 'lanterna-da-bordo', title: 'Lanterna da bordo', text: 'Breve.' });
  const decoded = PNG.sync.read(png);
  assert.equal(decoded.width, FACE_WIDTH);
  assert.equal(decoded.height, FACE_HEIGHT);
  assert.equal(truncated, false);
  const at = (x, y) => decoded.data[(y * decoded.width + x) * 4];
  assert.equal(at(70, 1000), 24, 'border pixel is ink');
  assert.equal(at(700, 700), 255, 'the paper is white');
});

test('the face is deterministic for the same card', () => {
  const card = { id: 'a', title: 'Titolo', text: 'Testo del fronte.' };
  assert.deepEqual(renderCardPng(card).png, renderCardPng(card).png);
});

test('a very long text is cut with an ellipsis and reported', () => {
  const { truncated } = renderCardPng({ id: 'lungo', title: 'Lungo', text: 'parola lunga '.repeat(600) });
  assert.equal(truncated, true);
});

test('pixel wrapping keeps every line inside the width', () => {
  const lines = wrapPixels('uno due tre quattro cinque sei sette otto nove dieci', 300, 4);
  assert.ok(lines.every((line) => textWidth(line, 4) <= 300));
  assert.equal(lines.join(' ').replace(/\s+/g, ' '), 'uno due tre quattro cinque sei sette otto nove dieci');
  const split = wrapPixels('supercalifragilistichespiralidoso', 100, 4);
  assert.ok(split.every((line) => textWidth(line, 4) <= 100));
});

test('glyphs: seven rows of five pixels; lowercase folds to capitals; unknown characters fall back', () => {
  for (const ch of 'ABCXYZ0123456789.,:;!?\'"-()/&+') {
    const rows = glyphFor(ch);
    assert.equal(rows.length, GLYPH_HEIGHT, ch);
    assert.ok(rows.every((row) => row.length === GLYPH_WIDTH && /^[01]+$/.test(row)), ch);
    assert.equal(hasGlyph(ch), true, ch);
  }
  assert.deepEqual(glyphFor('a'), glyphFor('A'));
  assert.equal(hasGlyph('€'), false);
  assert.deepEqual(glyphFor('€'), glyphFor('?'));
});
