import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadBase, gridView, cropForProvider, composeCandidate, verifyCandidate,
  deriveLand, acceptCandidate, maskPreview,
} from './ops.mjs';
import { readAtlas, writeJson } from './model.mjs';
import { setLock } from './lock.mjs';
import { newImage, cropImage, imageFromFile, writePngFile } from './image.mjs';
import { baseManifest, makeCampaign, writeAtlas, cleanupCampaigns } from './test-support.mjs';

after(cleanupCampaigns);

const W = 200;
const H = 160;
const SEA = [0x1c, 0x3a, 0x4a, 255];
const GREEN = [60, 130, 60, 255];
const RED = [220, 30, 30, 255];
const ISLAND = { x0: 60, y0: 40, x1: 140, y1: 120 };
/** Box around the island with some sea on each side. */
const BOX = { x0: 40, y0: 20, x1: 180, y1: 140 };

function fillRect(image, r, color) {
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) image.data.set(color, (y * image.width + x) * 4);
  }
}

/** A campaign with a 200x160 base (sea and a green island) and its land.png derived with the atlas sea. */
function campaignWithBase(manifestOverrides = {}) {
  const root = makeCampaign({});
  const dir = writeAtlas(root, {
    manifest: baseManifest({ canvas: { width: W, height: H }, ...manifestOverrides }),
    labels: null,
    pictures: [],
  });
  const base = newImage(W, H, SEA);
  fillRect(base, ISLAND, GREEN);
  writePngFile(path.join(dir, 'base.png'), base);
  const derived = deriveLand(root, { seaColor: '#1c3a4a', tolerance: 40 });
  assert.equal(derived.ok, true, derived.message);
  return { root, dir, basePath: path.join(dir, 'base.png'), landPath: path.join(dir, 'land.png') };
}

function writeCandidate(dir, name, image) {
  const file = path.join(dir, name);
  writePngFile(file, image);
  return file;
}

function baseImage(basePath) {
  return imageFromFile(basePath);
}

/** RGB of one pixel as a plain array. */
function rgbAt(image, x, y) {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

function pixelsDiffer(a, b, x, y) {
  const i = (y * a.width + x) * 4;
  return a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2];
}

test('loadBase reads the base and the land mask', () => {
  const { root } = campaignWithBase();
  const loaded = loadBase(root);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.base.width, W);
  assert.equal(loaded.land.width, W);
  assert.ok(loaded.land.data[80 * W + 100] === 1, 'island centre is land');
  assert.ok(loaded.land.data[10 * W + 10] === 0, 'corner is sea');
});

test('gridView and cropForProvider give the expected scale and size', () => {
  const { root } = campaignWithBase();
  const grid = gridView(root, BOX);
  assert.equal(grid.ok, true, grid.message);
  // longer side 140 -> 1100 / 140 is about 8, capped at 4
  assert.equal(grid.scale, 4);
  assert.deepEqual(grid.size, [560, 480]);
  const gridImage = imageFromFile(grid.out);
  assert.deepEqual([gridImage.width, gridImage.height], [560, 480]);

  const crop = cropForProvider(root, BOX);
  assert.equal(crop.ok, true, crop.message);
  // longer side 140 -> 3 gives 420 which is within 1100
  assert.equal(crop.scale, 3);
  assert.deepEqual(crop.size, [420, 360]);
  assert.equal(crop.formula, 'crop = (canvas - (x0,y0)) * scale');
  const cropImageFile = imageFromFile(crop.out);
  assert.deepEqual([cropImageFile.width, cropImageFile.height], [420, 360]);
});

test('cropForProvider drops to scale 1 when even scale 2 exceeds the side limit', () => {
  const root = makeCampaign({});
  const dir = writeAtlas(root, { manifest: baseManifest({ canvas: { width: 1000, height: 1000 } }), labels: null, pictures: [] });
  writePngFile(path.join(dir, 'base.png'), newImage(1000, 1000, SEA));
  const crop = cropForProvider(root, { x0: 0, y0: 0, x1: 600, y1: 100 });
  assert.equal(crop.ok, true, crop.message);
  assert.equal(crop.scale, 1);
});

test('bad boxes are refused with bad-box', () => {
  const { root } = campaignWithBase();
  assert.equal(gridView(root, { x0: 0, y0: 0, x1: 10, y1: 10 }).code, 'bad-box');
  assert.equal(cropForProvider(root, { x0: 0, y0: 0, x1: 300, y1: 100 }).code, 'bad-box');
});

test('composeCandidate in land mode changes only pixels inside the box', () => {
  const { root, dir, basePath } = campaignWithBase();
  // provider output: the box crop scaled by 2, with a red patch on the island
  const raw = resizeFor(BOX, 2);
  fillRect(raw, { x0: (90 - BOX.x0) * 2, y0: (60 - BOX.y0) * 2, x1: (110 - BOX.x0) * 2, y1: (80 - BOX.y0) * 2 }, RED);
  const rawPath = writeCandidate(dir, 'raw.png', raw);

  const result = composeCandidate(root, { rawPath, box: BOX, mode: 'land' });
  assert.equal(result.ok, true, result.message);
  const candidate = imageFromFile(result.out);
  const base = baseImage(basePath);
  assert.equal(candidate.width, W);
  assert.equal(candidate.height, H);

  let changed = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!pixelsDiffer(candidate, base, x, y)) continue;
      changed++;
      assert.ok(x >= BOX.x0 && x < BOX.x1 && y >= BOX.y0 && y < BOX.y1, `change at ${x},${y} is outside the box`);
    }
  }
  assert.ok(changed > 0, 'the red patch is composed');
});

test('composeCandidate restores the boxes given as restores', () => {
  const { root, dir, basePath } = campaignWithBase();
  const raw = resizeFor(BOX, 2);
  fillRect(raw, { x0: 100, y0: 80, x1: 140, y1: 120 }, RED);
  const rawPath = writeCandidate(dir, 'raw.png', raw);
  const restore = { x0: 85, y0: 55, x1: 115, y1: 85 };
  const result = composeCandidate(root, { rawPath, box: BOX, mode: 'land', restores: [restore], outPath: path.join(dir, 'c.png') });
  assert.equal(result.ok, true, result.message);
  const candidate = imageFromFile(result.out);
  const base = baseImage(basePath);
  for (let y = restore.y0; y < restore.y1; y++) {
    for (let x = restore.x0; x < restore.x1; x++) {
      assert.equal(pixelsDiffer(candidate, base, x, y), false, `restored pixel ${x},${y}`);
    }
  }
});

test('verifyCandidate of an unchanged candidate gives no gained and no lost land', () => {
  const { root, basePath, dir } = campaignWithBase();
  const result = verifyCandidate(root, { candidatePath: basePath, box: BOX, outPath: path.join(dir, 'verify.png') });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.gained, 0);
  assert.equal(result.lost, 0);
  assert.equal(result.pixelsOutsideBox, 0);
  assert.ok(fs.existsSync(result.out));
});

test('verifyCandidate reports gained land for a land block added in the sea', () => {
  const { root, dir } = campaignWithBase();
  const candidate = newImage(W, H, SEA);
  fillRect(candidate, ISLAND, GREEN);
  fillRect(candidate, { x0: 150, y0: 60, x1: 170, y1: 80 }, GREEN);
  const candidatePath = writeCandidate(dir, 'add.png', candidate);
  const result = verifyCandidate(root, { candidatePath, box: BOX, outPath: path.join(dir, 'v.png') });
  assert.equal(result.ok, true, result.message);
  assert.ok(result.gained > 0, 'gained land is reported');
  assert.equal(result.lost, 0);
  assert.equal(result.pixelsOutsideBox, 0);
});

test('acceptCandidate on a locked land refuses an addition unless extend is set', () => {
  const { root, dir, basePath, landPath } = campaignWithBase();
  lockLand(root);
  const candidatePath = addBlockCandidate(dir);
  const refused = acceptCandidate(root, { candidatePath, box: BOX });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'land-locked');
  const base = baseImage(basePath);
  assert.deepEqual(rgbAt(base, 160, 70), SEA.slice(0, 3), 'base untouched');
  assert.ok(fs.existsSync(landPath));
});

test('acceptCandidate with extend accepts a pure addition and rebuilds the land in the box', () => {
  const { root, dir, basePath, landPath } = campaignWithBase();
  lockLand(root);
  const candidatePath = addBlockCandidate(dir);
  const accepted = acceptCandidate(root, { candidatePath, box: BOX, extend: true });
  assert.equal(accepted.ok, true, accepted.message);
  assert.ok(accepted.gained > 0);
  const base = baseImage(basePath);
  assert.equal(pixelsDiffer(base, baseImage(candidatePath), 160, 70), false, 'base now carries the new block');
  // the land now holds the block: verifying the same candidate again finds no difference
  const again = verifyCandidate(root, { candidatePath, box: BOX, outPath: path.join(dir, 'again.png') });
  assert.equal(again.ok, true, again.message);
  assert.equal(again.gained, 0);
  assert.equal(again.lost, 0);
  const manifest = readAtlas(root).manifest;
  assert.match(manifest.base.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(manifest.base.sha256, 'a'.repeat(64));
  assert.ok(fs.existsSync(landPath));
});

test('acceptCandidate on a locked land refuses a candidate that removes land even with extend', () => {
  const { root, dir } = campaignWithBase();
  lockLand(root);
  const candidatePath = removeLandCandidate(dir);
  const refused = acceptCandidate(root, { candidatePath, box: BOX, extend: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'land-locked');
});

test('acceptCandidate with unlock accepts a candidate that removes land', () => {
  const { root, dir, basePath } = campaignWithBase();
  lockLand(root);
  const candidatePath = removeLandCandidate(dir);
  const accepted = acceptCandidate(root, { candidatePath, box: BOX, unlock: true });
  assert.equal(accepted.ok, true, accepted.message);
  assert.ok(accepted.lost > 0);
  const base = baseImage(basePath);
  assert.equal(pixelsDiffer(base, baseImage(candidatePath), 110, 70), false);
});

test('acceptCandidate refuses pixels changed outside the box', () => {
  const { root, dir, basePath } = campaignWithBase();
  const candidate = newImage(W, H, SEA);
  fillRect(candidate, ISLAND, GREEN);
  fillRect(candidate, { x0: 5, y0: 5, x1: 15, y1: 15 }, RED);
  const candidatePath = writeCandidate(dir, 'outside.png', candidate);
  const refused = acceptCandidate(root, { candidatePath, box: BOX });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'outside-box');
  assert.deepEqual(rgbAt(baseImage(basePath), 10, 10), SEA.slice(0, 3), 'base untouched');
});

test('deriveLand refuses when the land is locked and accepts with unlock', () => {
  const { root } = campaignWithBase();
  lockLand(root);
  const refused = deriveLand(root, { box: BOX });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'land-locked');
  const unlocked = deriveLand(root, { box: BOX, unlock: true });
  assert.equal(unlocked.ok, true, unlocked.message);
  assert.equal(unlocked.seaColor, '#1c3a4a');
  assert.equal(unlocked.tolerance, 40);
});

test('maskPreview writes the land as a black and white picture', () => {
  const { root, dir } = campaignWithBase();
  const preview = maskPreview(root, path.join(dir, 'mask.png'));
  assert.equal(preview.ok, true, preview.message);
  const image = imageFromFile(preview.out);
  assert.deepEqual(rgbAt(image, 100, 80), [255, 255, 255]);
  assert.deepEqual(rgbAt(image, 0, 0), [0, 0, 0]);
});

/** Locks the land of the atlas (the manifest keeps its hash). */
function lockLand(root) {
  const { manifest } = readAtlas(root);
  writeJson(path.join(root, 'Atlas', 'atlas.json'), setLock(manifest, ['land'], true));
}

/** The base with a green block of 20x20 added in the sea, inside the box. */
function addBlockCandidate(dir) {
  const candidate = newImage(W, H, SEA);
  fillRect(candidate, ISLAND, GREEN);
  fillRect(candidate, { x0: 150, y0: 60, x1: 170, y1: 80 }, GREEN);
  return writeCandidate(dir, 'add.png', candidate);
}

/** The base with a 20x20 lake cut in the middle of the island, inside the box. */
function removeLandCandidate(dir) {
  const candidate = newImage(W, H, SEA);
  fillRect(candidate, ISLAND, GREEN);
  fillRect(candidate, { x0: 100, y0: 60, x1: 120, y1: 80 }, SEA);
  return writeCandidate(dir, 'remove.png', candidate);
}

/** The box crop of the base, scaled up, as a provider would return it (a fresh image). */
function resizeFor(box, scale) {
  const base = newImage(W, H, SEA);
  fillRect(base, ISLAND, GREEN);
  const crop = cropImage(base, box.x0, box.y0, box.x1, box.y1);
  return resizeImageTo(crop, (box.x1 - box.x0) * scale, (box.y1 - box.y0) * scale);
}

function resizeImageTo(image, width, height) {
  const out = newImage(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const sy = Math.min(image.height - 1, Math.floor((y * image.height) / height));
      out.data.set(image.data.subarray((sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4), (y * width + x) * 4);
    }
  }
  return out;
}

const LAKE = { x0: 90, y0: 60, x1: 120, y1: 90 };
const LAKE_COLOR = [90, 120, 150, 255];

/** A campaign whose base holds the sea, the green island and a grey-blue lake inside it. No land yet. */
function campaignWithLake() {
  const root = makeCampaign({});
  const dir = writeAtlas(root, {
    manifest: baseManifest({ canvas: { width: W, height: H } }),
    labels: null,
    pictures: [],
  });
  const base = newImage(W, H, SEA);
  fillRect(base, ISLAND, GREEN);
  fillRect(base, LAKE, LAKE_COLOR);
  writePngFile(path.join(dir, 'base.png'), base);
  return { root, landPath: path.join(dir, 'land.png') };
}

/** Red value of one pixel of land.png: true when the pixel is land. */
function isLandAt(landPath, x, y) {
  return imageFromFile(landPath).data[(y * W + x) * 4] >= 128;
}

test('deriveLand with waterPoints stores the lake colour and the lake is water in land.png', () => {
  const { root, landPath } = campaignWithLake();
  const result = deriveLand(root, { waterPoints: [[105, 75]] });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.waters, [{ color: '#5a7896', tolerance: 30 }]);
  assert.equal(isLandAt(landPath, 105, 75), false, 'the lake is water');
  assert.equal(isLandAt(landPath, 70, 50), true, 'the island around it stays land');
  assert.equal(isLandAt(landPath, 5, 5), false, 'the sea stays sea');
  const sea = readAtlas(root).manifest.land.sea;
  assert.deepEqual(sea.waters, [{ color: '#5a7896', tolerance: 30 }]);
});

test('deriveLand: a second call keeps the stored waters and does not duplicate a colour', () => {
  const { root, landPath } = campaignWithLake();
  deriveLand(root, { waterPoints: [[105, 75]] });
  const again = deriveLand(root, { waterPoints: [[100, 80]] });
  assert.equal(again.ok, true, again.message);
  assert.equal(again.waters.length, 1, 'same colour, one entry');
  const plain = deriveLand(root, {});
  assert.equal(plain.ok, true, plain.message);
  assert.equal(readAtlas(root).manifest.land.sea.waters.length, 1);
  assert.equal(isLandAt(landPath, 105, 75), false, 'the lake is still water');
});

test('deriveLand with clearWaters empties the list and the lake becomes land again', () => {
  const { root, landPath } = campaignWithLake();
  deriveLand(root, { waterPoints: [[105, 75]] });
  const cleared = deriveLand(root, { clearWaters: true });
  assert.equal(cleared.ok, true, cleared.message);
  assert.deepEqual(cleared.waters, []);
  assert.equal(readAtlas(root).manifest.land.sea.waters, undefined);
  assert.equal(isLandAt(landPath, 105, 75), true, 'the lake is land again');
});

test('deriveLand refuses a water point outside the picture and changes nothing', () => {
  const { root, landPath } = campaignWithLake();
  const result = deriveLand(root, { waterPoints: [[500, 5]] });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'bad-water-point');
  assert.equal(readAtlas(root).manifest.land.sea.waters, undefined, 'nothing stored');
  assert.equal(fs.existsSync(landPath), false, 'no land written');
});
