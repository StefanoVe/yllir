import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePng } from '../../../../../scripts/lib/png.mjs';
import {
  canvasForReference, dataUriOf, referenceGridSvg, referenceImageInfo, referenceOverlaySvg,
} from './reference.mjs';

/** A minimal JPEG: SOI, an APP0 segment, and a SOF0 segment with the given size (no scan data). */
function minimalJpeg(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof0 = Buffer.from([
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0, Buffer.from([0xff, 0xd9])]);
}

function countOf(text, pattern) {
  return text.split(pattern).length - 1;
}

const CANVAS = { width: 1000, height: 500 };

test('referenceImageInfo reads the size of a JPEG from its SOF segment', () => {
  const info = referenceImageInfo(minimalJpeg(400, 300));
  assert.deepEqual(info, { ext: 'jpg', size: { width: 400, height: 300 }, mime: 'image/jpeg' });
});

test('referenceImageInfo returns null size for a JPEG whose marker walk fails', () => {
  const truncated = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.equal(referenceImageInfo(truncated).size, null);
});

test('referenceImageInfo reads a PNG made with encodePng as 3x2', () => {
  const png = encodePng(3, 2, new Uint8Array(3 * 2 * 3));
  assert.deepEqual(referenceImageInfo(png), { ext: 'png', size: { width: 3, height: 2 }, mime: 'image/png' });
});

test('referenceImageInfo returns null for bytes that are none of PNG, JPEG or WebP', () => {
  assert.equal(referenceImageInfo(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])), null);
  assert.equal(referenceImageInfo(Buffer.alloc(0)), null);
});

test('canvasForReference keeps the aspect ratio with the longer side at longSide', () => {
  assert.deepEqual(canvasForReference({ width: 1000, height: 500 }, 4000), { width: 4000, height: 2000 });
  assert.deepEqual(canvasForReference({ width: 500, height: 1000 }, 4000), { width: 2000, height: 4000 });
  assert.deepEqual(canvasForReference({ width: 300, height: 300 }, 2400), { width: 2400, height: 2400 });
});

test('canvasForReference never makes the shorter side below 100', () => {
  assert.deepEqual(canvasForReference({ width: 10000, height: 10 }, 2400), { width: 2400, height: 100 });
});

test('canvasForReference throws RangeError for invalid input', () => {
  assert.throws(() => canvasForReference({ width: 0, height: 500 }, 4000), RangeError);
  assert.throws(() => canvasForReference({ width: 10.5, height: 500 }, 4000), RangeError);
  assert.throws(() => canvasForReference({ width: -3, height: 500 }, 4000), RangeError);
  assert.throws(() => canvasForReference({ width: 100, height: 100 }, 0), RangeError);
  assert.throws(() => canvasForReference({ width: 100, height: 100 }, 2.5), RangeError);
  assert.throws(() => canvasForReference(null, 4000), RangeError);
});

test('referenceGridSvg has one picture, the viewBox of the canvas and a grid with the labels 0 and the last multiple', () => {
  const svg = referenceGridSvg({ canvas: CANVAS, imageHref: 'data:image/png;base64,AAAA', step: 200 });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('viewBox="0 0 1000 500"'));
  assert.ok(svg.includes('width="1000" height="500"'));
  assert.equal(countOf(svg, '<image '), 1);
  assert.ok(svg.includes('preserveAspectRatio="none"'));
  assert.ok(svg.includes('>0</text>'), 'label 0 is present');
  assert.ok(svg.includes('>1000</text>'), 'label of the last vertical line inside the canvas is present');
  assert.ok(svg.includes('>400</text>'), 'label of the last horizontal line inside the canvas is present');
  // Six x labels (0 to 1000) and two y labels (200 and 400; 0 is the corner, labelled once).
  assert.equal(countOf(svg, '<text '), 8);
  assert.ok(svg.includes('font-family="Cinzel"'));
  assert.ok(svg.includes('paint-order="stroke"'));
});

test('referenceGridSvg draws a thicker line every four steps', () => {
  const svg = referenceGridSvg({ canvas: CANVAS, imageHref: 'data:image/png;base64,AAAA', step: 200 });
  assert.ok(svg.includes('opacity="0.7"'));
  assert.ok(svg.includes('opacity="0.45"'));
});

test('referenceGridSvg uses 250 as the default step above 3000 wide', () => {
  const svg = referenceGridSvg({ canvas: { width: 4000, height: 2000 }, imageHref: 'data:image/png;base64,AAAA' });
  assert.ok(svg.includes('>250</text>'));
  assert.ok(svg.includes('>4000</text>'));
  assert.ok(!svg.includes('>200</text>'));
});

test('referenceOverlaySvg draws the drawing between the picture and the grid, at the given opacity', () => {
  const svg = referenceOverlaySvg({
    canvas: CANVAS,
    imageHref: 'data:image/png;base64,AAAA',
    drawingHref: 'data:image/png;base64,BBBB',
    step: 200,
  });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('viewBox="0 0 1000 500"'));
  assert.equal(countOf(svg, '<image '), 2);
  assert.ok(svg.includes('opacity="0.55"'));
  assert.ok(svg.indexOf('BBBB') > svg.indexOf('AAAA'), 'the drawing is after the picture');
  assert.ok(svg.indexOf('BBBB') < svg.indexOf('<line'), 'the drawing is before the grid');
  const custom = referenceOverlaySvg({
    canvas: CANVAS, imageHref: 'data:image/png;base64,AAAA', drawingHref: 'data:image/png;base64,BBBB', opacity: 0.3,
  });
  assert.ok(custom.includes('opacity="0.3"'));
});

test('referenceOverlaySvg and referenceGridSvg throw RangeError for a bad canvas', () => {
  assert.throws(() => referenceGridSvg({ canvas: { width: 0, height: 10 }, imageHref: 'x' }), RangeError);
  assert.throws(() => referenceOverlaySvg({ canvas: { width: 10, height: 1.5 }, imageHref: 'x', drawingHref: 'y' }), RangeError);
});

test('the hrefs are escaped for XML attributes', () => {
  const svg = referenceGridSvg({ canvas: CANVAS, imageHref: 'a&b"c<d>' });
  assert.ok(svg.includes('href="a&amp;b&quot;c&lt;d&gt;"'));
  assert.ok(!svg.includes('href="a&b'));
});

test('dataUriOf builds a base64 data URI with the given mime', () => {
  assert.equal(dataUriOf(Buffer.from('hi'), 'image/png'), 'data:image/png;base64,aGk=');
});
