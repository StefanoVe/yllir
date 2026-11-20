import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageInfo, MAX_IMAGE_BYTES } from './image-info.mjs';

function png(width, height) {
  const header = Buffer.alloc(25);
  header.writeUInt32BE(13, 0);
  header.write('IHDR', 4, 'ascii');
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), header]);
}

function webpVp8x(width, height) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

function webpVp8l(width, height) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write('VP8L', 12, 'ascii');
  b[20] = 0x2f;
  b.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  return b;
}

function jpeg(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.alloc(11);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(8, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

test('a PNG gives its format and size from the IHDR header', () => {
  assert.deepEqual(imageInfo(png(1448, 1286)), { format: 'png', width: 1448, height: 1286 });
});

test('a WebP gives its size in the extended, lossless and lossy headers', () => {
  assert.deepEqual(imageInfo(webpVp8x(800, 600)), { format: 'webp', width: 800, height: 600 });
  assert.deepEqual(imageInfo(webpVp8l(1024, 512)), { format: 'webp', width: 1024, height: 512 });
  const lossy = Buffer.alloc(30);
  lossy.write('RIFF', 0, 'ascii');
  lossy.write('WEBP', 8, 'ascii');
  lossy.write('VP8 ', 12, 'ascii');
  lossy[23] = 0x9d; lossy[24] = 0x01; lossy[25] = 0x2a;
  lossy.writeUInt16LE(320, 26);
  lossy.writeUInt16LE(240, 28);
  assert.deepEqual(imageInfo(lossy), { format: 'webp', width: 320, height: 240 });
});

test('a JPEG gives its size from the start-of-frame segment after the other segments', () => {
  assert.deepEqual(imageInfo(jpeg(640, 480)), { format: 'jpeg', width: 640, height: 480 });
});

test('other content, truncated files and unreadable headers give null', () => {
  assert.equal(imageInfo(Buffer.from('GIF89a-not-supported-here')), null);
  assert.equal(imageInfo(Buffer.from('plain text file with no picture in it')), null);
  assert.equal(imageInfo(png(10, 10).subarray(0, 20)), null);
  assert.equal(imageInfo(webpVp8x(10, 10).subarray(0, 20)), null);
  assert.equal(imageInfo(jpeg(10, 10).subarray(0, 12)), null);
  assert.equal(imageInfo(null), null);
  assert.equal(imageInfo(undefined), null);
});

test('the size limit is 12 MiB', () => {
  assert.equal(MAX_IMAGE_BYTES, 12 * 1024 * 1024);
});
