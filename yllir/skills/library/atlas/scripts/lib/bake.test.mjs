import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePng } from '../../../../../scripts/lib/png.mjs';
import {
  BAKE_INPUT, bakeFileName, bakeStatus, imageInfo, layersHash, webpSize,
} from './bake.mjs';

const terrain = { layer: 'terrain', constraints: [{ kind: 'landmass' }], features: [{ id: 'land-main', type: 'land' }] };
const places = { layer: 'places', constraints: [], features: [{ id: 'north', place: 'north', at: [5, 5] }] };
const streets = { layer: 'streets', constraints: [], features: [{ id: 'main-street', polyline: [[1, 1], [9, 9]] }] };
const labels = { layer: 'labels', constraints: [], features: [{ target: 'places/north', text: 'North' }] };

/** A WebP file of the given header: VP8X canvas size, or VP8L with the same size, or VP8 lossy. */
function webpBytes(kind, width, height) {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write(kind, 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  if (kind === 'VP8X') {
    buf.writeUIntLE(width - 1, 24, 3);
    buf.writeUIntLE(height - 1, 27, 3);
  } else if (kind === 'VP8L') {
    buf[20] = 0x2f;
    buf.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  } else {
    buf[23] = 0x9d;
    buf[24] = 0x01;
    buf[25] = 0x2a;
    buf.writeUInt16LE(width, 26);
    buf.writeUInt16LE(height, 28);
  }
  return buf;
}

test('BAKE_INPUT is the campaign cache path of the players render', () => {
  assert.equal(BAKE_INPUT, '.campaign/cache/atlas/bake/input.png');
});

test('layersHash is a 64 hex digest and does not depend on the key order of the layers', () => {
  const a = layersHash({ terrain, places });
  const b = layersHash({ places, terrain });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);
});

test('layersHash changes with a feature or a constraint of a layer', () => {
  const base = layersHash({ terrain, places });
  const moved = { ...terrain, features: [{ id: 'land-main', type: 'land', extra: 1 }] };
  assert.notEqual(layersHash({ terrain: moved, places }), base);
  const constrained = { ...terrain, constraints: [] };
  assert.notEqual(layersHash({ terrain: constrained, places }), base);
});

test('layersHash ignores keys of a layer file other than features and constraints', () => {
  const base = layersHash({ terrain, places });
  assert.equal(layersHash({ terrain: { ...terrain, note: 'changed' }, places }), base);
});

test('a layer that does not exist adds nothing, so an absent layer is not the same as an empty one', () => {
  assert.equal(layersHash({ terrain }), layersHash({ terrain, streets: undefined }));
  assert.notEqual(layersHash({ terrain }), layersHash({ terrain, streets: { layer: 'streets', constraints: [], features: [] } }));
  assert.equal(layersHash({}), layersHash());
});

test('the labels and the places are not hashed: a label or a place feature changes nothing, so the bake stays current', () => {
  const base = layersHash({ terrain, streets });
  assert.equal(layersHash({ terrain, streets, labels }), base);
  assert.equal(layersHash({ terrain, streets, places }), base);
  assert.equal(layersHash({ terrain, streets, places: { ...places, features: [{ id: 'south', place: 'south', at: [9, 9] }] } }), base);
  assert.equal(layersHash({ terrain, streets, labels: { ...labels, features: [] } }), base);
  assert.equal(layersHash({ terrain, streets, labels, places }), base);
});

test('a street or a terrain feature changes the hash: the bake is stale', () => {
  const base = layersHash({ terrain, streets });
  const moved = { ...streets, features: [{ id: 'main-street', polyline: [[1, 1], [8, 9]] }] };
  assert.notEqual(layersHash({ terrain, streets: moved }), base);
  const reshaped = { ...terrain, features: [{ id: 'land-main', type: 'land', extra: 1 }] };
  assert.notEqual(layersHash({ terrain: reshaped, streets }), base);
});

test('a layer of another name than LAYERS is not hashed', () => {
  assert.equal(layersHash({ terrain, notALayer: { features: [1] } }), layersHash({ terrain }));
});

test('bakeStatus is none without a bake, current when the hash matches, stale otherwise', () => {
  const layers = { terrain, places };
  const hash = layersHash(layers);
  assert.equal(bakeStatus({ schema: 1 }, layers), 'none');
  assert.equal(bakeStatus(undefined, layers), 'none');
  assert.equal(bakeStatus({ bake: { layersHash: hash } }, layers), 'current');
  assert.equal(bakeStatus({ bake: { layersHash: '0'.repeat(64) } }, layers), 'stale');
  assert.equal(bakeStatus({ bake: { layersHash: hash } }, { terrain, streets }), 'stale');
  assert.equal(bakeStatus({ bake: { layersHash: hash } }, { terrain, places, labels }), 'current');
});

test('imageInfo reads the kind and the size of a PNG from its header', () => {
  const info = imageInfo(encodePng(3, 2, new Uint8Array(3 * 2 * 3)));
  assert.deepEqual(info, { ext: 'png', size: { width: 3, height: 2 } });
});

test('webpSize reads the canvas of the extended, lossless and lossy formats', () => {
  assert.deepEqual(webpSize(webpBytes('VP8X', 40, 20)), { width: 40, height: 20 });
  assert.deepEqual(webpSize(webpBytes('VP8L', 300, 150)), { width: 300, height: 150 });
  assert.deepEqual(webpSize(webpBytes('VP8 ', 64, 32)), { width: 64, height: 32 });
});

test('webpSize is null for a short buffer, an unknown chunk or a missing signature', () => {
  assert.equal(webpSize(Buffer.alloc(10)), null);
  const unknown = webpBytes('VP8X', 4, 4);
  unknown.write('ABCD', 12, 'ascii');
  assert.equal(webpSize(unknown), null);
  const badL = webpBytes('VP8L', 4, 4);
  badL[20] = 0;
  assert.equal(webpSize(badL), null);
  const badLossy = webpBytes('VP8 ', 4, 4);
  badLossy[24] = 0;
  assert.equal(webpSize(badLossy), null);
});

test('imageInfo accepts a WebP and rejects any other bytes', () => {
  assert.deepEqual(imageInfo(webpBytes('VP8X', 8, 4)), { ext: 'webp', size: { width: 8, height: 4 } });
  assert.equal(imageInfo(Buffer.from('plain text file, not an image at all')), null);
  assert.equal(imageInfo(Buffer.from('%PDF-1.4 something longer than twelve')), null);
});

test('bakeFileName is bake-<first 8 hex of the SHA-256>.<extension>, and null for a non-image', () => {
  const png = encodePng(2, 2, new Uint8Array(2 * 2 * 3));
  assert.match(bakeFileName(png), /^bake-[0-9a-f]{8}\.png$/);
  assert.equal(bakeFileName(png), bakeFileName(Buffer.from(png)));
  assert.match(bakeFileName(webpBytes('VP8X', 8, 4)), /^bake-[0-9a-f]{8}\.webp$/);
  assert.equal(bakeFileName(Buffer.from('not an image, just text')), null);
});
