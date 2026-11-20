// Binary masks of the atlas. Pure functions, no file access, no dependencies.
// A mask is { width, height, data } with data a Uint8Array of 0/1, row-major, origin top-left.
// An image is { width, height, data } with data a Uint8ClampedArray of RGBA (4 bytes per pixel).
// Flood fills and labelling use explicit stacks, never recursion.
// Boxes are { x0, y0, x1, y1 } with x1 and y1 exclusive (width = x1 - x0).

/** Frame width, in pixels, sampled to estimate the sea colour. */
const FRAME = 12;
/** Quantization step of each channel when counting the colours of the frame. */
const COLOR_STEP = 8;
/** Default distance, in RGB units, within which a pixel is sea. */
const SEA_TOLERANCE = 40;

/** A mask of the given size, filled with 0 or 1. */
export function newMask(width, height, fill = 0) {
  const data = new Uint8Array(width * height);
  if (fill) data.fill(1);
  return { width, height, data };
}

function assertSameSize(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`masks differ in size: ${a.width}x${a.height} and ${b.width}x${b.height}`);
  }
}

function radiusOf(radius) {
  return Math.max(0, Math.floor(radius) || 0);
}

/**
 * One separable pass of a square morphology along rows or columns, with running sums.
 * dilate: a pixel is 1 when any pixel of its window is 1.
 * erode: a pixel is 1 when every pixel of its window is 1; pixels outside the mask count as
 * `outside` (0 or 1).
 */
function slidePass(src, width, height, radius, horizontal, erodeMode, outside) {
  const dst = new Uint8Array(src.length);
  const len = horizontal ? width : height;
  const lines = horizontal ? height : width;
  const stride = horizontal ? 1 : width;
  const prefix = new Int32Array(len + 1);
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * width : line;
    prefix[0] = 0;
    for (let i = 0; i < len; i++) prefix[i + 1] = prefix[i] + src[base + i * stride];
    for (let i = 0; i < len; i++) {
      const lo = Math.max(0, i - radius);
      const hi = Math.min(len, i + radius + 1);
      const ones = prefix[hi] - prefix[lo];
      let value;
      if (!erodeMode) {
        value = ones > 0 ? 1 : 0;
      } else if (outside === 1) {
        // Outside pixels count as 1: every in-bounds pixel of the window must be 1.
        value = ones === hi - lo ? 1 : 0;
      } else {
        // Outside pixels count as 0: the whole window must be inside and all 1.
        value = ones === 2 * radius + 1 ? 1 : 0;
      }
      dst[base + i * stride] = value;
    }
  }
  return dst;
}

function morph(mask, radius, erodeMode, outside = 0) {
  const r = radiusOf(radius);
  const { width, height } = mask;
  if (r === 0) return { width, height, data: mask.data.slice() };
  const horizontal = slidePass(mask.data, width, height, r, true, erodeMode, outside);
  const data = slidePass(horizontal, width, height, r, false, erodeMode, outside);
  return { width, height, data };
}

/** Square dilation of side 2*radius+1. */
export function dilate(mask, radius) {
  return morph(mask, radius, false);
}

/** Square erosion of side 2*radius+1; pixels outside the image count as 0. */
export function erode(mask, radius) {
  return morph(mask, radius, true, 0);
}

/** Erosion then dilation: removes specks and thin spurs, keeps shapes. */
export function open(mask, radius) {
  return dilate(erode(mask, radius), radius);
}

/**
 * Dilation then erosion: fills gaps and narrow notches. The erosion treats pixels outside
 * the image as 1, so land that touches the image edge keeps its edge.
 */
export function close(mask, radius) {
  return morph(dilate(mask, radius), radius, true, 1);
}

/**
 * Labels the regions of pixels equal to `value` (4-connectivity, iterative).
 * labels: Int32Array, 0 outside the regions, 1..count inside.
 * sizes: sizes[label] (sizes[0] is 0).
 * boxes: boxes[label - 1].
 * touchesBorder: touchesBorder[label] is true when a pixel of the region lies on the image edge.
 */
function labelRegions(mask, value) {
  const { width: w, height: h, data } = mask;
  const n = w * h;
  const labels = new Int32Array(n);
  const stack = new Int32Array(n);
  const sizes = [0];
  const boxes = [];
  const touchesBorder = [false];
  let count = 0;
  for (let start = 0; start < n; start++) {
    if (data[start] !== value || labels[start] !== 0) continue;
    count += 1;
    const label = count;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    let size = 0;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    let border = false;
    while (top > 0) {
      const p = stack[--top];
      size += 1;
      const x = p % w;
      const y = (p - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && data[p - 1] === value && labels[p - 1] === 0) {
        labels[p - 1] = label;
        stack[top++] = p - 1;
      }
      if (x < w - 1 && data[p + 1] === value && labels[p + 1] === 0) {
        labels[p + 1] = label;
        stack[top++] = p + 1;
      }
      if (y > 0 && data[p - w] === value && labels[p - w] === 0) {
        labels[p - w] = label;
        stack[top++] = p - w;
      }
      if (y < h - 1 && data[p + w] === value && labels[p + w] === 0) {
        labels[p + w] = label;
        stack[top++] = p + w;
      }
    }
    sizes.push(size);
    boxes.push({ x0, y0, x1: x1 + 1, y1: y1 + 1 });
    touchesBorder.push(border);
  }
  return { labels, count, sizes, boxes, touchesBorder };
}

/**
 * Connected components of the 1-pixels (4-connectivity).
 * @returns {{labels: Int32Array, count: number, sizes: number[], boxes: object[]}}
 *   labels 0 for background, 1..count otherwise; sizes[label] (sizes[0] = 0);
 *   boxes[label - 1] with exclusive x1 and y1.
 */
export function components(mask) {
  const { labels, count, sizes, boxes } = labelRegions(mask, 1);
  return { labels, count, sizes, boxes };
}

/** Fills the 0-regions (4-connectivity) that do not touch the image border and satisfy `shouldFill(size)`. */
function fillZeroRegions(mask, shouldFill) {
  const { labels, sizes, touchesBorder, count } = labelRegions(mask, 0);
  const out = mask.data.slice();
  const fill = new Uint8Array(count + 1);
  for (let label = 1; label <= count; label++) {
    fill[label] = !touchesBorder[label] && shouldFill(sizes[label]) ? 1 : 0;
  }
  for (let p = 0; p < labels.length; p++) {
    if (labels[p] !== 0 && fill[labels[p]]) out[p] = 1;
  }
  return { width: mask.width, height: mask.height, data: out };
}

/** Sets to 1 every 0-region that does not touch the mask border (holes in the land). */
export function fillHoles(mask) {
  return fillZeroRegions(mask, () => true);
}

/** Removes the 1-components with fewer than minPixels pixels. */
export function removeSmall(mask, minPixels) {
  const { labels, sizes, count } = labelRegions(mask, 1);
  const data = new Uint8Array(labels.length);
  const keep = new Uint8Array(count + 1);
  for (let label = 1; label <= count; label++) keep[label] = sizes[label] >= minPixels ? 1 : 0;
  for (let p = 0; p < labels.length; p++) {
    if (labels[p] !== 0 && keep[labels[p]]) data[p] = 1;
  }
  return { width: mask.width, height: mask.height, data };
}

/** Fills the 0-regions that do not touch the border and have fewer than maxPixels pixels. */
export function fillSmallHoles(mask, maxPixels) {
  return fillZeroRegions(mask, (size) => size < maxPixels);
}

/** Pixels that are 1 in a or in b. */
export function unionMasks(a, b) {
  assertSameSize(a, b);
  const data = new Uint8Array(a.data.length);
  for (let p = 0; p < data.length; p++) data[p] = a.data[p] | b.data[p];
  return { width: a.width, height: a.height, data };
}

/** Pixels that are 1 in a and 0 in b. */
export function subtractMasks(a, b) {
  assertSameSize(a, b);
  const data = new Uint8Array(a.data.length);
  for (let p = 0; p < data.length; p++) data[p] = a.data[p] & (1 - b.data[p]);
  return { width: a.width, height: a.height, data };
}

/** Pixels that are 1 in both a and b. */
export function intersectMasks(a, b) {
  assertSameSize(a, b);
  const data = new Uint8Array(a.data.length);
  for (let p = 0; p < data.length; p++) data[p] = a.data[p] & b.data[p];
  return { width: a.width, height: a.height, data };
}

/** Swaps 0 and 1. */
export function invertMask(a) {
  const data = new Uint8Array(a.data.length);
  for (let p = 0; p < data.length; p++) data[p] = 1 - a.data[p];
  return { width: a.width, height: a.height, data };
}

/** Number of 1-pixels. */
export function countOnes(mask) {
  let total = 0;
  for (let p = 0; p < mask.data.length; p++) total += mask.data[p];
  return total;
}

/** The part of the mask inside [x0, x1) x [y0, y1); pixels outside the source are 0. */
export function cropMask(mask, x0, y0, x1, y1) {
  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= mask.height) continue;
    for (let x = 0; x < width; x++) {
      const sx = x0 + x;
      if (sx < 0 || sx >= mask.width) continue;
      data[y * width + x] = mask.data[sy * mask.width + sx];
    }
  }
  return { width, height, data };
}

/**
 * Mask of a polygon, even-odd scanline fill. A pixel is inside when its centre (x + 0.5, y + 0.5)
 * is inside the polygon. Fewer than three usable points give an empty mask.
 * @param {number[][]} points [[x, y], ...] in pixels
 */
export function polygonMask(width, height, points) {
  const mask = newMask(width, height);
  const usable = Array.isArray(points)
    ? points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    : [];
  if (usable.length < 3) return mask;
  const crossings = [];
  for (let y = 0; y < height; y++) {
    const yc = y + 0.5;
    crossings.length = 0;
    for (let i = 0, j = usable.length - 1; i < usable.length; j = i++) {
      const [ax, ay] = usable[j];
      const [bx, by] = usable[i];
      if ((ay <= yc && yc < by) || (by <= yc && yc < ay)) {
        crossings.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
      }
    }
    crossings.sort((p, q) => p - q);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const start = Math.max(0, Math.ceil(crossings[k] - 0.5));
      const end = Math.min(width, Math.ceil(crossings[k + 1] - 0.5));
      for (let x = start; x < end; x++) mask.data[y * width + x] = 1;
    }
  }
  return mask;
}

/** One box blur of side 2*r+1 along rows or columns; pixels outside the image count as 0. */
function boxBlurAxis(src, width, height, r, horizontal) {
  const dst = new Float32Array(src.length);
  const len = horizontal ? width : height;
  const lines = horizontal ? height : width;
  const stride = horizontal ? 1 : width;
  const span = 2 * r + 1;
  const prefix = new Float64Array(len + 1);
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * width : line;
    prefix[0] = 0;
    for (let i = 0; i < len; i++) prefix[i + 1] = prefix[i] + src[base + i * stride];
    for (let i = 0; i < len; i++) {
      const lo = Math.max(0, i - r);
      const hi = Math.min(len, i + r + 1);
      dst[base + i * stride] = Math.min(1, (prefix[hi] - prefix[lo]) / span);
    }
  }
  return dst;
}

/**
 * Soft edge of a mask: values 0..1 of the same size. The mask is blurred twice, each time
 * with a horizontal and a vertical box of the given radius. Deep inside a region the value is 1,
 * far outside it is 0.
 * @returns {Float32Array}
 */
export function featherMask(mask, radius) {
  const r = radiusOf(radius);
  const { width, height } = mask;
  let current = Float32Array.from(mask.data);
  if (r === 0) return current;
  for (let pass = 0; pass < 2; pass++) {
    current = boxBlurAxis(current, width, height, r, true);
    current = boxBlurAxis(current, width, height, r, false);
  }
  return current;
}

/**
 * Sea colour estimated from the frame along the four edges of the image: the most common colour
 * (channels quantized to steps of 8), averaged over its real pixels.
 * @returns {{color: number[], tolerance: number}}
 */
export function seaColorFromBorder(image) {
  const { width, height, data } = image;
  const buckets = new Map();
  for (let y = 0; y < height; y++) {
    const edgeRow = y < FRAME || y >= height - FRAME;
    for (let x = 0; x < width; x++) {
      if (!edgeRow && x >= FRAME && x < width - FRAME) continue;
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = ((r / COLOR_STEP) | 0) * 1024 + ((g / COLOR_STEP) | 0) * 32 + ((b / COLOR_STEP) | 0);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { count: 0, r: 0, g: 0, b: 0 };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    }
  }
  let winner = null;
  for (const bucket of buckets.values()) {
    if (!winner || bucket.count > winner.count) winner = bucket;
  }
  const color = winner
    ? [winner.r, winner.g, winner.b].map((sum) => Math.round(sum / winner.count))
    : [0, 0, 0];
  return { color, tolerance: SEA_TOLERANCE };
}

/**
 * Land mask of a picture by colour: a pixel is sea when its Euclidean RGB distance to seaColor
 * is at most tolerance. Then open, close, remove small land, fill small lakes.
 * A colour heuristic: callers expose seaColor and tolerance.
 * @returns {{width: number, height: number, data: Uint8Array}} 1 = land
 */
export function landMaskFromImage(image, options = {}) {
  const {
    tolerance = SEA_TOLERANCE,
    minLandPixels = 40,
    minLakePixels = 40,
    closeRadius = 2,
    openRadius = 2,
  } = options;
  const seaColor = options.seaColor ?? seaColorFromBorder(image).color;
  const { width, height, data } = image;
  const land = newMask(width, height);
  const [sr, sg, sb] = seaColor;
  const limit = tolerance * tolerance;
  const n = width * height;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const dr = data[i] - sr;
    const dg = data[i + 1] - sg;
    const db = data[i + 2] - sb;
    land.data[p] = dr * dr + dg * dg + db * db <= limit ? 0 : 1;
  }
  let result = open(land, openRadius);
  result = close(result, closeRadius);
  result = removeSmall(result, minLandPixels);
  return fillSmallHoles(result, minLakePixels);
}

/** RGBA image: land white, sea black, alpha 255. */
export function maskToImage(mask) {
  const n = mask.width * mask.height;
  const data = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) {
    const v = mask.data[p] ? 255 : 0;
    const i = p * 4;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width: mask.width, height: mask.height, data };
}

/** Mask from the red channel of an RGBA image: 1 where red >= threshold. */
export function imageToMask(image, threshold = 128) {
  const n = image.width * image.height;
  const data = new Uint8Array(n);
  for (let p = 0; p < n; p++) data[p] = image.data[p * 4] >= threshold ? 1 : 0;
  return { width: image.width, height: image.height, data };
}

/**
 * Difference between two masks of the same size. gained = pixels 0 -> 1, lost = pixels 1 -> 0.
 * blocks are the 4-connected components of each difference with at least minBlock pixels,
 * gained first, then lost.
 */
export function diffMasks(before, after, minBlock = 30) {
  assertSameSize(before, after);
  const { width, height } = before;
  const gainedMask = newMask(width, height);
  const lostMask = newMask(width, height);
  let gained = 0;
  let lost = 0;
  for (let p = 0; p < before.data.length; p++) {
    const b = before.data[p];
    const a = after.data[p];
    if (!b && a) {
      gainedMask.data[p] = 1;
      gained += 1;
    } else if (b && !a) {
      lostMask.data[p] = 1;
      lost += 1;
    }
  }
  const blocks = [];
  for (const [kind, mask] of [['gained', gainedMask], ['lost', lostMask]]) {
    const regions = labelRegions(mask, 1);
    for (let label = 1; label <= regions.count; label++) {
      const pixels = regions.sizes[label];
      if (pixels < minBlock) continue;
      const box = regions.boxes[label - 1];
      blocks.push({ kind, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, pixels });
    }
  }
  return { gained, lost, blocks };
}

/** Land pixels that have a sea pixel in their 4-neighbourhood (pixels outside the image are not sea). */
export function maskOutline(mask) {
  const { width: w, height: h, data } = mask;
  const out = newMask(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!data[p]) continue;
      const seaNear = (x > 0 && !data[p - 1])
        || (x < w - 1 && !data[p + 1])
        || (y > 0 && !data[p - w])
        || (y < h - 1 && !data[p + w]);
      if (seaNear) out.data[p] = 1;
    }
  }
  return out;
}
