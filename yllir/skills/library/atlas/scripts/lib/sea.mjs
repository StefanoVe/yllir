// The sea texture of the atlas: a square picture of the sea, stored as sea.png in the atlas folder.
// It is generated elsewhere by an image service; here it is sampled from the base (the open sea of
// the map, when the assistant wants a stand-in), or checked, made seamless and written in place.
// Errors are thrown as Error objects with a `code`. Nothing else in the atlas folder is touched.

import fs from 'node:fs';
import path from 'node:path';
import { atlasDir, atlasFolder } from './model.mjs';
import { loadBase } from './ops.mjs';
import { largestSeaSquare, makeSeamless } from './sea-tile.mjs';
import { cropImage, imageFromFile, writePngFile } from './image.mjs';

const FILE = 'sea.png';
/** The sampled square is at most this large, in pixels. */
const SAMPLE_MAX = 512;
/** The largest sea square of a sample must be at least this large. */
const SAMPLE_MIN = 32;
/** A candidate picture must have each side in this range. */
const CANDIDATE_MIN = 128;
const CANDIDATE_MAX = 2048;

function coded(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Path of the sea picture in an atlas folder. */
export function seaFileOf(dir) {
  return path.join(dir, FILE);
}

/**
 * Samples a square of the open sea of the base into a PNG: the largest all-sea square of the land
 * mask, its centre min(side, 512) pixels a side.
 * @param {string} root the campaign folder
 * @param {string} outPath where to write the PNG (absolute)
 * @returns {{ side: number, size: string }} the side of the largest sea square and the written size
 * @throws {Error} code 'no-open-sea' when the largest sea square is smaller than 32 pixels
 */
export function sampleSea(root, outPath) {
  const loaded = loadBase(root);
  if (!loaded.ok) throw coded(loaded.code, loaded.message);
  if (loaded.land === null) throw coded('no-land', 'the atlas has no land.png; run init or base-set first');

  const found = largestSeaSquare(loaded.land);
  if (found.side < SAMPLE_MIN) {
    throw coded('no-open-sea', `the largest sea square is ${found.side} pixels; at least ${SAMPLE_MIN} are needed`);
  }
  const side = Math.min(found.side, SAMPLE_MAX);
  const inset = Math.floor((found.side - side) / 2);
  const x0 = found.x0 + inset;
  const y0 = found.y0 + inset;
  writePngFile(outPath, cropImage(loaded.base, x0, y0, x0 + side, y0 + side));
  return { side: found.side, size: `${side}x${side}` };
}

/**
 * Makes a candidate picture of the sea the atlas's sea.png: a PNG of 128 to 2048 pixels a side,
 * cropped to its centre square, made seamless, and written to <atlas folder>/sea.png (replacing it).
 * @param {string} root the campaign folder
 * @param {string} candidatePath the PNG to use (absolute)
 * @returns {{ file: string, size: string }} the campaign-relative file and the written size
 * @throws {Error} code 'no-atlas', 'missing-file', 'not-png' or 'bad-sea-size'
 */
export function setSea(root, candidatePath) {
  const dir = atlasDir(root);
  if (dir === null) throw coded('no-atlas', 'the campaign declares no atlas folder');
  if (!fs.existsSync(candidatePath)) throw coded('missing-file', `${path.basename(candidatePath)} does not exist`);

  let picture;
  try {
    picture = imageFromFile(candidatePath);
  } catch (err) {
    throw coded('not-png', `${path.basename(candidatePath)} is not a PNG picture: ${err.message}`);
  }
  const { width, height } = picture;
  const inRange = (n) => n >= CANDIDATE_MIN && n <= CANDIDATE_MAX;
  if (!inRange(width) || !inRange(height)) {
    throw coded('bad-sea-size', `the sea picture must be between ${CANDIDATE_MIN} and ${CANDIDATE_MAX} pixels on each side; it is ${width}x${height}`);
  }

  const side = Math.min(width, height);
  const x0 = Math.floor((width - side) / 2);
  const y0 = Math.floor((height - side) / 2);
  const square = cropImage(picture, x0, y0, x0 + side, y0 + side);
  writePngFile(seaFileOf(dir), makeSeamless(square));
  return { file: path.posix.join(atlasFolder(root), FILE), size: `${side}x${side}` };
}
