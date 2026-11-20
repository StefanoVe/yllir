// Seamless sea tile for the atlas: the largest all-sea square of a base picture, mirrored into a
// 2S x 2S tile whose opposite edges match. Pure: no file access, no randomness, no mutation.
// Images are { width, height, data } (RGBA bytes); masks are { width, height, data } with 1 = land.

import { newImage, cropImage, pasteImage } from './image.mjs';

/** Copy of an image flipped horizontally, vertically or both. The input is not touched. */
function flipImage(image, horizontal, vertical) {
  const { width, height, data } = image;
  const out = newImage(width, height);
  for (let y = 0; y < height; y++) {
    const sy = vertical ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const sx = horizontal ? width - 1 - x : x;
      const s = (sy * width + sx) * 4;
      const d = (y * width + x) * 4;
      out.data.set(data.subarray(s, s + 4), d);
    }
  }
  return out;
}

/**
 * Largest square of sea pixels (mask value 0), by the dynamic programme
 * dp = 0 on land, else 1 + min(up, left, up-left). The first square of the largest side in
 * row-major order wins. Returns its top-left corner and side (side 0 when there is no sea).
 */
function largestSeaSquare(landMask) {
  const { width, height, data } = landMask;
  const dp = new Int32Array(width * height);
  let best = 0;
  let bestX = 0;
  let bestY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (data[p]) continue; // land: dp stays 0
      const value = x === 0 || y === 0
        ? 1
        : 1 + Math.min(dp[p - width], dp[p - 1], dp[p - width - 1]);
      dp[p] = value;
      if (value > best) {
        best = value;
        bestX = x;
        bestY = y;
      }
    }
  }
  return { side: best, x0: bestX - best + 1, y0: bestY - best + 1 };
}

/**
 * Seamless tile of the sea of a base picture.
 * The largest all-sea square is found; when it is larger than options.maxSide, the centred
 * maxSide square of it is used. The tile is 2S x 2S: the crop, its horizontal flip, its vertical
 * flip and its both-ways flip, in the four quadrants, so opposite edges match.
 * @param {{width: number, height: number, data: Uint8ClampedArray}} image RGBA picture
 * @param {{width: number, height: number, data: Uint8Array}} landMask same size, 1 = land, 0 = sea
 * @param {{minSide?: number, maxSide?: number}} [options] defaults 32 and 256
 * @returns {{width: number, height: number, data: Uint8ClampedArray} | null} null when the largest
 *   sea square is smaller than minSide
 */
export function seaTileFromBase(image, landMask, options = {}) {
  const minSide = options.minSide ?? 32;
  const maxSide = options.maxSide ?? 256;
  if (!(maxSide >= 1)) throw new Error('maxSide must be at least 1');
  if (landMask.width !== image.width || landMask.height !== image.height) {
    throw new Error(`land mask and image differ in size: ${landMask.width}x${landMask.height} and ${image.width}x${image.height}`);
  }

  const found = largestSeaSquare(landMask);
  if (found.side === 0 || found.side < minSide) return null;

  const side = Math.min(found.side, maxSide);
  const inset = Math.floor((found.side - side) / 2);
  const sx = found.x0 + inset;
  const sy = found.y0 + inset;
  const crop = cropImage(image, sx, sy, sx + side, sy + side);

  const tile = newImage(2 * side, 2 * side);
  pasteImage(tile, crop, 0, 0);
  pasteImage(tile, flipImage(crop, true, false), side, 0);
  pasteImage(tile, flipImage(crop, false, true), 0, side);
  pasteImage(tile, flipImage(crop, true, true), side, side);
  return tile;
}
