import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newMask, dilate, erode, open, close, fillHoles, components, removeSmall, fillSmallHoles,
  unionMasks, subtractMasks, intersectMasks, invertMask, countOnes, cropMask, polygonMask,
  featherMask, seaColorFromBorder, landMaskFromImage, maskToImage, imageToMask, diffMasks,
  maskOutline, waterColorsFromPoints,
} from './mask.mjs';

/** A mask with the given rectangles [x0, y0, x1, y1) set to 1. */
function maskWith(width, height, rects) {
  const mask = newMask(width, height);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask.data[y * width + x] = 1;
  }
  return mask;
}

/** An RGBA image filled with one colour. */
function solidImage(width, height, [r, g, b]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = r;
    data[p * 4 + 1] = g;
    data[p * 4 + 2] = b;
    data[p * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** Paints a rectangle [x0, y0, x1, y1) of an RGBA image. */
function paint(image, [x0, y0, x1, y1], [r, g, b]) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  return image;
}

const at = (mask, x, y) => mask.data[y * mask.width + x];

test('newMask: size and fill', () => {
  assert.equal(countOnes(newMask(20, 20)), 0);
  assert.equal(countOnes(newMask(20, 20, 1)), 400);
});

test('dilate: a single pixel grows to a square of side 2r+1', () => {
  const dot = maskWith(20, 20, [[10, 10, 11, 11]]);
  assert.equal(countOnes(dilate(dot, 1)), 9);
  assert.equal(countOnes(dilate(dot, 2)), 25);
  assert.equal(countOnes(dilate(dot, 0)), 1);
});

test('erode: a 5x5 block shrinks by the radius on each side', () => {
  const block = maskWith(20, 20, [[5, 5, 10, 10]]);
  assert.equal(countOnes(block), 25);
  assert.equal(countOnes(erode(block, 1)), 9);
  assert.equal(countOnes(erode(block, 2)), 1);
  assert.equal(countOnes(erode(block, 3)), 0);
});

test('erode: pixels outside the image count as 0', () => {
  const edge = maskWith(20, 20, [[0, 0, 5, 5]]);
  assert.equal(countOnes(erode(edge, 1)), 9, 'columns and rows 0 are lost on the edge');
  assert.equal(at(erode(edge, 1), 0, 0), 0);
});

test('open: removes a speck and keeps a block', () => {
  const mask = maskWith(30, 30, [[2, 2, 3, 3], [10, 10, 17, 17]]);
  const opened = open(mask, 1);
  assert.equal(at(opened, 2, 2), 0, 'the speck is gone');
  assert.equal(countOnes(opened), 49, 'the 7x7 block survives');
});

test('close: fills a small gap inside a block', () => {
  const block = maskWith(30, 30, [[5, 5, 14, 14]]);
  block.data[9 * 30 + 9] = 0;
  const closed = close(block, 1);
  assert.equal(at(closed, 9, 9), 1);
  assert.equal(countOnes(closed), 81);
});

test('fillHoles: fills an enclosed hole', () => {
  const ring = maskWith(20, 20, [[5, 5, 15, 6], [5, 14, 15, 15], [5, 5, 6, 15], [14, 5, 15, 15]]);
  assert.equal(countOnes(ring), 36);
  const filled = fillHoles(ring);
  assert.equal(at(filled, 10, 10), 1);
  assert.equal(countOnes(filled), 100);
});

test('fillHoles: a bay open to the border stays open', () => {
  const ring = maskWith(20, 20, [[5, 5, 15, 6], [5, 14, 15, 15], [5, 5, 6, 15], [14, 5, 15, 15]]);
  // Cut a gap in the top side so the inside connects to the border.
  ring.data[5 * 20 + 9] = 0;
  ring.data[5 * 20 + 10] = 0;
  const filled = fillHoles(ring);
  assert.equal(at(filled, 10, 10), 0, 'the bay is not a hole');
  assert.equal(countOnes(filled), 34);
});

test('fillHoles: a large enclosed region does not overflow the stack', () => {
  const size = 1000;
  const ring = maskWith(size, size, [[2, 2, 998, 3], [2, 997, 998, 998], [2, 2, 3, 998], [997, 2, 998, 998]]);
  assert.equal(countOnes(fillHoles(ring)), 996 * 996);
});

test('components: two blobs, sizes and boxes', () => {
  const mask = maskWith(20, 20, [[1, 1, 4, 4], [10, 10, 12, 14]]);
  const result = components(mask);
  assert.equal(result.count, 2);
  assert.deepEqual(result.sizes, [0, 9, 8]);
  assert.deepEqual(result.boxes, [
    { x0: 1, y0: 1, x1: 4, y1: 4 },
    { x0: 10, y0: 10, x1: 12, y1: 14 },
  ]);
  assert.equal(result.labels[1 * 20 + 1], 1);
  assert.equal(result.labels[10 * 20 + 10], 2);
  assert.equal(result.labels[0], 0);
});

test('components: diagonal neighbours are separate under 4-connectivity', () => {
  const mask = maskWith(5, 5, [[0, 0, 1, 1], [1, 1, 2, 2]]);
  assert.equal(components(mask).count, 2);
});

test('removeSmall: thresholds', () => {
  const mask = maskWith(20, 20, [[1, 1, 4, 4], [10, 10, 12, 14]]);
  assert.equal(countOnes(removeSmall(mask, 9)), 9, 'the 8-pixel blob goes');
  assert.equal(countOnes(removeSmall(mask, 10)), 0, 'both go');
  assert.equal(countOnes(removeSmall(mask, 8)), 17, 'nothing goes');
});

test('fillSmallHoles: thresholds, and holes on the border are never filled', () => {
  const mask = maskWith(30, 30, [[5, 5, 20, 20]]);
  mask.data[6 * 30 + 6] = 0; // one-pixel hole
  for (let y = 9; y < 13; y++) for (let x = 9; x < 13; x++) mask.data[y * 30 + x] = 0; // 16 pixels
  const some = fillSmallHoles(mask, 5);
  assert.equal(at(some, 6, 6), 1, 'the small hole is filled');
  assert.equal(at(some, 10, 10), 0, 'the 16-pixel hole stays');
  const all = fillSmallHoles(mask, 17);
  assert.equal(at(all, 10, 10), 1);

  const notch = maskWith(10, 10, [[0, 0, 10, 2]]);
  assert.equal(countOnes(fillSmallHoles(notch, 100)), 20, 'nothing is enclosed');
});

test('boolean operations and crop', () => {
  const a = maskWith(4, 4, [[0, 0, 2, 2]]);
  const b = maskWith(4, 4, [[1, 0, 3, 2]]);
  assert.equal(countOnes(unionMasks(a, b)), 6);
  assert.equal(countOnes(intersectMasks(a, b)), 2);
  assert.equal(countOnes(subtractMasks(a, b)), 2);
  assert.equal(countOnes(invertMask(a)), 12);
  assert.throws(() => unionMasks(a, newMask(3, 4)), /differ in size/);

  const crop = cropMask(maskWith(10, 10, [[2, 2, 5, 5]]), 3, 3, 7, 7);
  assert.equal(crop.width, 4);
  assert.equal(crop.height, 4);
  assert.equal(countOnes(crop), 4, 'the 2x2 overlap');
  assert.equal(at(crop, 0, 0), 1);
});

test('polygonMask: a square has about its area', () => {
  const square = polygonMask(20, 20, [[2, 2], [12, 2], [12, 12], [2, 12]]);
  assert.ok(Math.abs(countOnes(square) - 100) <= 4, `got ${countOnes(square)}`);
  assert.equal(at(square, 5, 5), 1);
  assert.equal(at(square, 15, 5), 0);
});

test('polygonMask: fewer than three points give an empty mask', () => {
  assert.equal(countOnes(polygonMask(20, 20, [[1, 1], [10, 10]])), 0);
});

test('featherMask: values in [0,1], 1 deep inside, 0 far outside', () => {
  const blob = maskWith(100, 100, [[20, 20, 80, 80]]);
  const soft = featherMask(blob, 3);
  assert.equal(soft.length, 100 * 100);
  for (const value of soft) assert.ok(value >= 0 && value <= 1, `value ${value} out of range`);
  assert.ok(soft[50 * 100 + 50] > 0.999, 'deep inside');
  assert.equal(soft[0], 0, 'corner');
  assert.equal(soft[50 * 100 + 5], 0, 'far outside');
  const edge = soft[50 * 100 + 20];
  assert.ok(edge > 0 && edge < 1, 'the boundary is soft');
});

test('seaColorFromBorder: the frame colour wins over the centre', () => {
  const image = paint(solidImage(60, 60, [0, 200, 0]), [0, 0, 60, 60], [0, 200, 0]);
  paint(image, [0, 0, 60, 12], [0, 0, 200]);
  paint(image, [0, 48, 60, 60], [0, 0, 200]);
  paint(image, [0, 0, 12, 60], [0, 0, 200]);
  paint(image, [48, 0, 60, 60], [0, 0, 200]);
  const { color, tolerance } = seaColorFromBorder(image);
  assert.equal(tolerance, 40);
  [0, 1, 2].forEach((i) => assert.ok(Math.abs(color[i] - [0, 0, 200][i]) <= 8, `channel ${i}: ${color}`));
});

test('landMaskFromImage: one island, the speck removed, the lake filled', () => {
  const image = solidImage(120, 100, [0, 0, 255]);
  paint(image, [30, 30, 90, 70], [0, 200, 0]); // island 60x40
  paint(image, [5, 5, 7, 7], [0, 200, 0]); // 2x2 speck
  paint(image, [60, 50, 63, 53], [0, 0, 255]); // 3x3 lake inside the island
  const land = landMaskFromImage(image);
  const found = components(land);
  assert.equal(found.count, 1);
  assert.deepEqual(found.boxes[0], { x0: 30, y0: 30, x1: 90, y1: 70 });
  assert.equal(at(land, 5, 5), 0, 'speck removed');
  assert.equal(at(land, 61, 51), 1, 'lake filled');
  assert.equal(countOnes(land), 2400);
});

test('landMaskFromImage: an explicit sea colour is used', () => {
  const image = solidImage(120, 100, [10, 40, 90]);
  paint(image, [30, 30, 90, 70], [0, 200, 0]);
  const land = landMaskFromImage(image, { seaColor: [10, 40, 90] });
  assert.equal(countOnes(land), 2400);
});

test('maskToImage and imageToMask round trip', () => {
  const mask = maskWith(6, 4, [[1, 1, 3, 3]]);
  const image = maskToImage(mask);
  assert.equal(image.data[(1 * 6 + 1) * 4], 255);
  assert.equal(image.data[3], 255, 'alpha');
  assert.equal(image.data[0], 0, 'sea is black');
  assert.deepEqual(imageToMask(image).data, mask.data);
});

test('diffMasks: a gained block and a lost block with their boxes', () => {
  const before = maskWith(40, 30, [[0, 0, 6, 6]]);
  const after = maskWith(40, 30, [[10, 10, 16, 16], [18, 0, 20, 1], [18, 0, 19, 1]]);
  const diff = diffMasks(before, after);
  assert.equal(diff.lost, 36);
  assert.equal(diff.gained, 38);
  const gained = diff.blocks.filter((b) => b.kind === 'gained');
  const lost = diff.blocks.filter((b) => b.kind === 'lost');
  assert.equal(gained.length, 1);
  assert.equal(lost.length, 1);
  assert.deepEqual(
    { x0: gained[0].x0, y0: gained[0].y0, x1: gained[0].x1, y1: gained[0].y1, pixels: gained[0].pixels },
    { x0: 10, y0: 10, x1: 16, y1: 16, pixels: 36 },
  );
  assert.deepEqual(
    { x0: lost[0].x0, y0: lost[0].y0, x1: lost[0].x1, y1: lost[0].y1, pixels: lost[0].pixels },
    { x0: 0, y0: 0, x1: 6, y1: 6, pixels: 36 },
  );
});

test('diffMasks: small differences below minBlock are counted but not reported as blocks', () => {
  const before = newMask(20, 20);
  const after = maskWith(20, 20, [[0, 0, 2, 2]]);
  const diff = diffMasks(before, after);
  assert.equal(diff.gained, 4);
  assert.equal(diff.blocks.length, 0);
  assert.equal(diffMasks(before, after, 4).blocks.length, 1);
});

test('diffMasks: different sizes throw', () => {
  assert.throws(() => diffMasks(newMask(4, 4), newMask(4, 5)), /differ in size/);
});

test('maskOutline: the border of a block, not its interior', () => {
  const block = maskWith(10, 10, [[3, 3, 7, 7]]);
  const outline = maskOutline(block);
  assert.equal(countOnes(outline), 12);
  assert.equal(at(outline, 4, 4), 0);
  assert.equal(at(outline, 3, 3), 1);
});

test('performance: dilate and erode radius 3 on 2000x1500 under 3 seconds', () => {
  const mask = maskWith(2000, 1500, [[100, 100, 1900, 1400], [300, 300, 340, 340]]);
  const started = performance.now();
  const result = erode(dilate(mask, 3), 3);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 3000, `took ${Math.round(elapsed)} ms`);
  assert.equal(at(result, 1000, 700), 1);
});

/** Sea blue, land green, a grey-blue lake 40x40 inside the land, 3x3 dark speckles at sea colour. */
function lakeScene() {
  const sea = [28, 58, 128];
  const image = solidImage(200, 160, sea);
  paint(image, [40, 30, 160, 130], [60, 130, 60]); // island 120x100
  paint(image, [70, 60, 110, 100], [90, 120, 150]); // lake 40x40, far from the sea colour
  paint(image, [48, 38, 51, 41], sea); // 3x3 shadow speckle
  paint(image, [140, 110, 143, 113], sea); // second speckle
  return image;
}

test('landMaskFromImage: without extra water the grey-blue lake is land, speckles are filled', () => {
  const land = landMaskFromImage(lakeScene(), { seaColor: [28, 58, 128] });
  assert.equal(at(land, 90, 80), 1, 'lake is land');
  assert.equal(at(land, 49, 39), 1, 'speckle filled');
  assert.equal(at(land, 5, 5), 0, 'sea is sea');
});

test('landMaskFromImage: extra water keeps a big lake out of the land and fills the speckles', () => {
  const waterColors = [{ color: [90, 120, 150], tolerance: 30 }];
  const land = landMaskFromImage(lakeScene(), { seaColor: [28, 58, 128], waterColors });
  assert.equal(at(land, 90, 80), 0, 'lake is water');
  assert.equal(at(land, 49, 39), 1, 'speckle filled');
  assert.equal(at(land, 141, 111), 1, 'second speckle filled');
  assert.equal(at(land, 50, 35), 1, 'land around the lake stays land');
  assert.equal(components(land).count, 1);
  assert.equal(countOnes(land), 12000 - 1600);
});

test('landMaskFromImage: a small extra-water speck inside the land is filled, not kept as a hole', () => {
  const image = lakeScene();
  paint(image, [120, 40, 123, 43], [90, 120, 150]); // 3x3 water-coloured speck
  const waterColors = [{ color: [90, 120, 150], tolerance: 30 }];
  const land = landMaskFromImage(image, { seaColor: [28, 58, 128], waterColors });
  assert.equal(at(land, 121, 41), 1, 'small water speck filled');
  assert.equal(at(land, 90, 80), 0, 'lake still water');
});

test('landMaskFromImage: default speck thresholds scale with a big canvas', () => {
  const image = solidImage(1536, 1024, [28, 58, 128]);
  paint(image, [100, 100, 110, 120], [60, 130, 60]); // 10x20 = 200 px
  paint(image, [300, 300, 320, 320], [60, 130, 60]); // 20x20 = 400 px
  const land = landMaskFromImage(image, { seaColor: [28, 58, 128] });
  assert.equal(at(land, 105, 110), 0, '200 px island is below the scaled minimum of 315');
  assert.equal(at(land, 310, 310), 1, '400 px island is kept');
});

test('landMaskFromImage: the same 200 px island is kept on a small canvas', () => {
  const image = solidImage(200, 160, [28, 58, 128]);
  paint(image, [100, 100, 110, 120], [60, 130, 60]);
  const land = landMaskFromImage(image, { seaColor: [28, 58, 128] });
  assert.equal(at(land, 105, 110), 1);
});

test('waterColorsFromPoints: the 5x5 average around each point, clamped inside the picture', () => {
  const image = paint(solidImage(40, 30, [0, 0, 0]), [0, 0, 40, 30], [90, 120, 150]);
  paint(image, [0, 0, 1, 1], [200, 0, 0]);
  const [inside, corner, outside] = waterColorsFromPoints(image, [[20, 15], [0, 0], [500, -9]]);
  assert.deepEqual(inside, { color: [90, 120, 150], tolerance: 30 });
  assert.equal(corner.color[0] > 90, true, 'the corner average includes the red pixels');
  assert.deepEqual(outside.color, [90, 120, 150], 'a point outside is clamped to the picture');
  assert.equal(outside.tolerance, 30);
  assert.equal(waterColorsFromPoints(image, [[20, 15]], 12)[0].tolerance, 12);
});
