// Reference image of the atlas: a picture (a map from the sources or given by the master) that the assistant looks at
// to trace coasts, districts and buildings into the atlas data. This file is pure: the image header readers, the
// canvas the picture is drawn on, and the SVG builders that show the picture with a labelled coordinate grid, and
// with the drawn map on top of it. It never reads or writes files and uses no randomness.

import { imageInfo } from './bake.mjs';

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
/** The JPEG markers that carry the frame header (size and precision): SOF0 to SOF15, without DHT, JPG and DAC. */
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const GRID_COLOR = '#ff00ff';
const HALO_COLOR = '#ffffff';
const DEFAULT_OPACITY = 0.55;
/** A thicker line every this many grid steps, so the assistant can count. */
const THICK_EVERY = 4;
/** The most grid lines on one axis: a smaller step than this is refused rather than drawn. */
const MAX_LINES = 2000;
/** The shortest side of a canvas. */
const MIN_SIDE = 100;

/** Width and height from the frame header of a JPEG file, or null when the marker walk fails. */
function jpegSize(buffer) {
  let pos = 2;
  while (pos + 4 <= buffer.length) {
    if (buffer[pos] !== 0xff) return null;
    const marker = buffer[pos + 1];
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    // Markers without a length: start of image, TEM, and the restart markers.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    // End of image or start of scan before any frame header: there is no size to read.
    if (marker === 0xd9 || marker === 0xda) return null;
    if (SOF_MARKERS.has(marker)) {
      if (pos + 9 > buffer.length) return null;
      const height = buffer.readUInt16BE(pos + 5);
      const width = buffer.readUInt16BE(pos + 7);
      if (width === 0 || height === 0) return null;
      return { width, height };
    }
    const length = buffer.readUInt16BE(pos + 2);
    if (length < 2) return null;
    pos += 2 + length;
  }
  return null;
}

/**
 * The kind of a reference picture, by its magic bytes (never its name), with its size when the header can be read.
 * @param {Buffer|Uint8Array} buffer the picture's bytes
 * @returns {{ ext: 'png'|'jpg'|'webp', size: { width: number, height: number } | null, mime: string } | null}
 *   null when the bytes are none of PNG, JPEG or WebP
 */
export function referenceImageInfo(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : (buffer instanceof Uint8Array ? Buffer.from(buffer) : null);
  if (bytes === null) return null;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', size: jpegSize(bytes), mime: MIME.jpg };
  }
  const info = imageInfo(bytes);
  if (info === null) return null;
  return { ext: info.ext, size: info.size, mime: MIME[info.ext] };
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a whole number above zero`);
}

/**
 * The canvas the picture is drawn on: the same aspect ratio, the longer side equal to longSide, the shorter side
 * rounded and never below 100.
 * @param {{ width: number, height: number }} size the picture's size
 * @param {number} longSide the length of the longer side of the canvas (4000 for a geographic atlas, 2400 urban)
 * @returns {{ width: number, height: number }}
 */
export function canvasForReference(size, longSide) {
  if (size === null || typeof size !== 'object') throw new RangeError('size must be { width, height }');
  assertPositiveInteger(size.width, 'size.width');
  assertPositiveInteger(size.height, 'size.height');
  assertPositiveInteger(longSide, 'longSide');
  const { width, height } = size;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const other = Math.max(MIN_SIDE, Math.round((longSide * short) / long));
  return width >= height ? { width: longSide, height: other } : { width: other, height: longSide };
}

/** Escapes a value for an XML attribute in double quotes. */
function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A number for the markup: at most three decimals. */
function fmt(value) {
  return String(Math.round(value * 1000) / 1000);
}

function checkCanvas(canvas) {
  if (canvas === null || typeof canvas !== 'object') throw new RangeError('canvas must be { width, height }');
  assertPositiveInteger(canvas.width, 'canvas.width');
  assertPositiveInteger(canvas.height, 'canvas.height');
}

function checkHref(value, name) {
  if (typeof value !== 'string' || value === '') throw new TypeError(`${name} must be a non-empty string`);
}

function checkStep(step, canvas) {
  const value = step === undefined ? (canvas.width <= 3000 ? 200 : 250) : step;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError('step must be a number above zero');
  }
  if (Math.floor(canvas.width / value) + 1 > MAX_LINES || Math.floor(canvas.height / value) + 1 > MAX_LINES) {
    throw new RangeError('step is too small for this canvas');
  }
  return value;
}

/** The grid lines and their labels: the x values on the top row, the y values on the left column. */
function gridMarkup(canvas, step) {
  const { width: w, height: h } = canvas;
  const lineWidth = w / 1500;
  const fontSize = w / 70;
  const haloWidth = w / 400;
  const gap = fontSize * 0.15;
  const lines = [];
  const labels = [];
  const labelAttributes = `font-family="Cinzel" font-size="${fmt(fontSize)}" fill="${GRID_COLOR}" ` +
    `stroke="${HALO_COLOR}" stroke-width="${fmt(haloWidth)}" paint-order="stroke"`;

  for (let k = 0; k * step <= w; k++) {
    const v = k * step;
    const thick = k % THICK_EVERY === 0;
    const strokeWidth = fmt(thick ? lineWidth * 2 : lineWidth);
    const opacity = thick ? 0.7 : 0.45;
    lines.push(`<line x1="${fmt(v)}" y1="0" x2="${fmt(v)}" y2="${h}" stroke="${GRID_COLOR}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`);
    const nearRightEdge = v > w * 0.9;
    const x = nearRightEdge ? v - gap : v + gap;
    const anchor = nearRightEdge ? ' text-anchor="end"' : '';
    labels.push(`<text x="${fmt(x)}" y="${fmt(fontSize)}"${anchor} ${labelAttributes}>${v}</text>`);
  }
  for (let k = 0; k * step <= h; k++) {
    const v = k * step;
    // The corner (0, 0) is labelled once, by the top row.
    if (v === 0) continue;
    const thick = k % THICK_EVERY === 0;
    const strokeWidth = fmt(thick ? lineWidth * 2 : lineWidth);
    const opacity = thick ? 0.7 : 0.45;
    lines.push(`<line x1="0" y1="${fmt(v)}" x2="${w}" y2="${fmt(v)}" stroke="${GRID_COLOR}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`);
    labels.push(`<text x="${fmt(gap)}" y="${fmt(v - gap)}" ${labelAttributes}>${v}</text>`);
  }
  return { lines, labels };
}

function assemble(canvas, layers, grid) {
  const { width: w, height: h } = canvas;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${HALO_COLOR}"/>`,
    ...layers,
    ...grid.lines,
    ...grid.labels,
    '</svg>',
  ].join('\n');
}

/**
 * The picture on the canvas with a labelled coordinate grid, to look at.
 * @param {object} options
 * @param {{ width: number, height: number }} options.canvas the canvas (see canvasForReference)
 * @param {string} options.imageHref the picture as a data URI
 * @param {number} [options.step] the distance between grid lines in canvas units (200, or 250 above 3000 wide)
 * @returns {string} the SVG markup
 */
export function referenceGridSvg({ canvas, imageHref, step } = {}) {
  checkCanvas(canvas);
  checkHref(imageHref, 'imageHref');
  const gridStep = checkStep(step, canvas);
  const { width: w, height: h } = canvas;
  const picture = `<image href="${escapeXml(imageHref)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
  return assemble(canvas, [picture], gridMarkup(canvas, gridStep));
}

/**
 * The picture with the drawn map semi-transparent on top of it and the grid over both, to compare them.
 * @param {object} options
 * @param {{ width: number, height: number }} options.canvas the canvas (see canvasForReference)
 * @param {string} options.imageHref the picture as a data URI
 * @param {string} options.drawingHref the drawn map as a data URI (the render of the atlas)
 * @param {number} [options.step] the distance between grid lines (see referenceGridSvg)
 * @param {number} [options.opacity] the opacity of the drawn map, between 0 and 1 (0.55 by default)
 * @returns {string} the SVG markup
 */
export function referenceOverlaySvg({ canvas, imageHref, drawingHref, step, opacity = DEFAULT_OPACITY } = {}) {
  checkCanvas(canvas);
  checkHref(imageHref, 'imageHref');
  checkHref(drawingHref, 'drawingHref');
  if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError('opacity must be a number between 0 and 1');
  }
  const gridStep = checkStep(step, canvas);
  const { width: w, height: h } = canvas;
  const picture = `<image href="${escapeXml(imageHref)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
  const drawing = `<image href="${escapeXml(drawingHref)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" opacity="${opacity}"/>`;
  return assemble(canvas, [picture, drawing], gridMarkup(canvas, gridStep));
}

/**
 * A data URI of the bytes.
 * @param {Buffer|Uint8Array} buffer
 * @param {string} mime for example image/png
 * @returns {string} data:<mime>;base64,<...>
 */
export function dataUriOf(buffer, mime) {
  if (typeof mime !== 'string' || mime === '') throw new TypeError('mime must be a non-empty string');
  return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
}
