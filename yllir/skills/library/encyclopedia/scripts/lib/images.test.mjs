import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareImage, findMetadata } from './images.mjs';
import { makeJpeg, makePng } from './test-support.mjs';

const kinds = (bytes, format) => findMetadata(bytes, format);

test('JPEG loses its APP1 (EXIF), APP13 (IPTC) and COM segments and keeps the rest', () => {
  const dirty = makeJpeg([
    [0xe0, 'JFIF\0'],
    [0xe1, 'Exif\0\0GPS-LOCATION'],
    [0xed, 'Photoshop 3.0\0IPTC'],
    [0xfe, 'a comment'],
  ]);
  assert.deepEqual(kinds(dirty, 'jpeg').sort(), ['comment', 'exif-xmp', 'iptc']);
  const clean = prepareImage(dirty, 'jpg');
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.removed, ['comment', 'exif-xmp', 'iptc']);
  assert.deepEqual(kinds(clean.bytes, 'jpeg'), []);
  assert.equal(clean.bytes.includes(Buffer.from('GPS-LOCATION')), false);
  // The JFIF segment and the scan data stay byte for byte.
  assert.equal(clean.bytes.includes(Buffer.from('JFIF')), true);
  assert.equal(clean.bytes.subarray(-4).equals(Buffer.from([0x12, 0x34, 0xff, 0xd9])), true);
});

test('a clean JPEG is copied unchanged', () => {
  const clean = makeJpeg([[0xe0, 'JFIF\0']]);
  const result = prepareImage(clean, 'jpeg');
  assert.equal(result.ok, true);
  assert.deepEqual(result.removed, []);
  assert.equal(result.bytes.equals(clean), true);
});

test('PNG loses tEXt, iTXt, zTXt and eXIf chunks and keeps the image chunks', () => {
  const dirty = makePng([
    ['tEXt', 'Author\0Photographer'],
    ['iTXt', 'XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>'],
    ['zTXt', 'Comment\0\0xx'],
    ['eXIf', 'II*\0GPS'],
  ]);
  assert.deepEqual(kinds(dirty, 'png').sort(), ['exif', 'text', 'text', 'text']);
  const clean = prepareImage(dirty, 'png');
  assert.equal(clean.ok, true);
  assert.deepEqual(kinds(clean.bytes, 'png'), []);
  assert.equal(clean.bytes.includes(Buffer.from('Photographer')), false);
  assert.equal(clean.bytes.includes(Buffer.from('IDAT')), true);
  assert.equal(clean.bytes.includes(Buffer.from('IEND')), true);
});

test('a broken picture is refused as not readable', () => {
  assert.deepEqual(prepareImage(Buffer.from('not a picture'), 'png'), { ok: false, reason: 'not-readable' });
  assert.deepEqual(prepareImage(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]), 'jpg'), { ok: false, reason: 'not-readable' });
});

test('WebP and GIF are never rewritten: a copy with metadata is refused', () => {
  const webpWithExif = Buffer.concat([
    Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'),
    Buffer.from('EXIF'), Buffer.from([4, 0, 0, 0]), Buffer.from('abcd'),
  ]);
  assert.deepEqual(prepareImage(webpWithExif, 'webp'), { ok: false, reason: 'metadata-not-removable' });

  const gifPlain = Buffer.concat([
    Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0x00, 0, 0]),
    Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2]), Buffer.from([1, 0x44, 0]), Buffer.from([0x3b]),
  ]);
  assert.deepEqual(findMetadata(gifPlain, 'gif'), []);
  assert.equal(prepareImage(gifPlain, 'gif').ok, true);

  const gifComment = Buffer.concat([
    Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0x00, 0, 0]),
    Buffer.from([0x21, 0xfe, 3]), Buffer.from('hey'), Buffer.from([0]), Buffer.from([0x3b]),
  ]);
  assert.deepEqual(findMetadata(gifComment, 'gif'), ['comment']);
  assert.deepEqual(prepareImage(gifComment, 'gif'), { ok: false, reason: 'metadata-not-removable' });
});

test('unsupported extensions are refused', () => {
  assert.deepEqual(prepareImage(Buffer.from('x'), 'bmp'), { ok: false, reason: 'unsupported' });
});
