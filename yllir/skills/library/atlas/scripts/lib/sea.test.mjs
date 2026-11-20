// Tests of sea.mjs. Run: node --test yllir/skills/library/atlas/scripts/lib/sea.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sampleSea, setSea, seaFileOf } from './sea.mjs';
import { makeSeamless } from './sea-tile.mjs';
import { newImage, writePngFile, imageFromFile, cropImage } from './image.mjs';
import { cleanupCampaigns, makeCampaign, writeAtlas, baseManifest, emptyLabels } from './test-support.mjs';

after(cleanupCampaigns);

const W = 200;
const H = 150;

/** An atlas with a base and a land mask; `isLand(x, y)` gives the land. */
function atlasWith(isLand) {
  const root = makeCampaign({});
  writeAtlas(root, { manifest: baseManifest({ canvas: { width: W, height: H } }), labels: emptyLabels(), pictures: [] });
  const dir = path.join(root, 'Atlas');
  writePngFile(path.join(dir, 'base.png'), newImage(W, H, [60, 120, 150, 255]));
  const land = newImage(W, H, [0, 0, 0, 255]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (isLand(x, y)) land.data[(y * W + x) * 4] = 255;
  }
  writePngFile(path.join(dir, 'land.png'), land);
  return root;
}

/** A deterministic noisy picture of the given size, written as a PNG outside the atlas folder. */
function candidateFile(root, name, width, height, seed = 7) {
  const image = newImage(width, height, [0, 0, 0, 255]);
  let s = seed;
  for (let i = 0; i < image.data.length; i++) {
    if (i % 4 === 3) continue;
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    image.data[i] = (s >>> 16) & 0xff;
  }
  const file = path.join(root, name);
  writePngFile(file, image);
  return file;
}

test('sampleSea writes the central square of the largest open sea as a PNG', () => {
  // Land on the left 100 columns: the sea is 100 wide and 150 high, so the largest sea square is 100.
  const root = atlasWith((x) => x < 100);
  const out = path.join(root, 'sample.png');
  const result = sampleSea(root, out);
  assert.equal(result.side, 100);
  assert.equal(result.size, '100x100');
  const picture = imageFromFile(out);
  assert.equal(picture.width, 100);
  assert.equal(picture.height, 100);
});

test('sampleSea takes at most 512 pixels a side', () => {
  const root = atlasWith(() => false); // all sea: the largest square is the whole 150-pixel height
  const result = sampleSea(root, path.join(root, 'sample.png'));
  assert.equal(result.side, 150);
  assert.equal(result.size, '150x150');
});

test('sampleSea with no open sea throws code no-open-sea and writes nothing', () => {
  // A sea strip of 20 columns: smaller than the 32 needed.
  const root = atlasWith((x) => x < 180);
  const out = path.join(root, 'sample.png');
  assert.throws(() => sampleSea(root, out), (err) => err.code === 'no-open-sea');
  assert.equal(fs.existsSync(out), false);
  const allLand = atlasWith(() => true);
  assert.throws(() => sampleSea(allLand, path.join(allLand, 'sample.png')), (err) => err.code === 'no-open-sea');
});

test('setSea writes a seamless sea.png in the atlas folder, from the centre square of the candidate', () => {
  const root = atlasWith(() => true);
  const candidate = candidateFile(root, 'candidate.png', 200, 150);
  const result = setSea(root, candidate);
  assert.equal(result.size, '150x150');
  assert.equal(result.file, 'Atlas/sea.png');
  const written = imageFromFile(seaFileOf(path.join(root, 'Atlas')));
  assert.equal(written.width, 150);
  assert.equal(written.height, 150);

  // Same bytes as the centre square made seamless: the stored tile is periodic.
  const source = imageFromFile(candidate);
  const centre = cropImage(source, 25, 0, 175, 150);
  assert.deepEqual([...written.data], [...makeSeamless(centre).data]);
});

test('setSea replaces an existing sea.png and touches no other file', () => {
  const root = atlasWith(() => true);
  const dir = path.join(root, 'Atlas');
  writePngFile(path.join(dir, 'sea.png'), newImage(128, 128, [1, 2, 3, 255]));
  const before = fs.readFileSync(path.join(dir, 'base.png'));
  setSea(root, candidateFile(root, 'candidate.png', 128, 128));
  assert.equal(imageFromFile(path.join(dir, 'sea.png')).width, 128);
  assert.equal(fs.readFileSync(path.join(dir, 'base.png')).equals(before), true);
});

test('setSea rejects a picture smaller than 128 pixels with bad-sea-size and writes nothing', () => {
  const root = atlasWith(() => true);
  const candidate = candidateFile(root, 'small.png', 64, 64);
  assert.throws(() => setSea(root, candidate), (err) => err.code === 'bad-sea-size');
  assert.equal(fs.existsSync(seaFileOf(path.join(root, 'Atlas'))), false);
});

test('setSea rejects a file that is not a PNG with code not-png', () => {
  const root = atlasWith(() => true);
  const file = path.join(root, 'sea.txt');
  fs.writeFileSync(file, 'this is text, not a picture');
  assert.throws(() => setSea(root, file), (err) => err.code === 'not-png');
  assert.equal(fs.existsSync(seaFileOf(path.join(root, 'Atlas'))), false);
});
