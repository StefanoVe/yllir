// Sea texture helpers for the atlas: the largest all-sea square of a land mask, and the seamless
// version of a picture of the sea. Pure: no file access, no randomness, no mutation.
// Images are { width, height, data } (RGBA bytes); masks are { width, height, data } with 1 = land.

import { newImage } from './image.mjs';

/**
 * Largest square of sea pixels (mask value 0), by the dynamic programme
 * dp = 0 on land, else 1 + min(up, left, up-left). The first square of the largest side in
 * row-major order wins. Returns its top-left corner and side (side 0 when there is no sea).
 * @returns {{ side: number, x0: number, y0: number }}
 */
export function largestSeaSquare(landMask) {
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
  if (best === 0) return { side: 0, x0: 0, y0: 0 };
  return { side: best, x0: bestX - best + 1, y0: bestY - best + 1 };
}

/**
 * A picture of the sea that tiles seamlessly in both directions, by the classic offset cross-fade:
 * O(x,y) = T(x,y)*w + T((x+floor(W/2))%W, (y+floor(H/2))%H)*(1-w), with w = wx*wy,
 * wx = sin(pi*x/W)^2 and wy = sin(pi*y/H)^2. The output has the size of the input; alpha is 255.
 * @param {{width: number, height: number, data: Uint8ClampedArray}} image RGBA picture, not modified
 * @returns {{width: number, height: number, data: Uint8ClampedArray}} a new picture
 */
export function makeSeamless(image) {
  const { width: W, height: H, data } = image;
  const out = newImage(W, H);
  const offsetX = Math.floor(W / 2);
  const offsetY = Math.floor(H / 2);
  for (let y = 0; y < H; y++) {
    const wy = Math.sin((Math.PI * y) / H) ** 2;
    const oy = (y + offsetY) % H;
    for (let x = 0; x < W; x++) {
      const wx = Math.sin((Math.PI * x) / W) ** 2;
      const w = wx * wy;
      const ox = (x + offsetX) % W;
      const a = (y * W + x) * 4;
      const b = (oy * W + ox) * 4;
      for (let c = 0; c < 3; c++) {
        out.data[a + c] = Math.round(data[a + c] * w + data[b + c] * (1 - w));
      }
      out.data[a + 3] = 255;
    }
  }
  return out;
}
