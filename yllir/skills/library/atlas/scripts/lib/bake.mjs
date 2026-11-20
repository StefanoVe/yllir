// Bake of the atlas: one painted image of the whole drawn map, made by an image service from the players'
// render, kept in the atlas folder with the hash of the layers it was made from. This file is pure: the
// hash, the status and the image header readers. The files are written by atlas.mjs.

import { createHash } from 'node:crypto';
import { LAYERS } from './model.mjs';
import { canonicalJson, sha256 } from './geometry.mjs';
import { pngSize } from '../../../../../scripts/lib/png.mjs';

/** Where the players' render of the atlas goes before an image service paints it (campaign-relative). */
export const BAKE_INPUT = '.campaign/cache/atlas/bake/input.png';
/** The folder of the baked images, inside the atlas folder. */
export const BAKE_DIR = 'bake';
/** The largest image the bake accepts. */
export const BAKE_MAX_BYTES = 12 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The layers that are not painted into a bake: the labels are texts, the places are icons drawn on top. */
const UNBAKED_LAYERS = new Set(['labels', 'places']);

/**
 * Hash of the drawn layers: the features and the constraints of every layer that exists, except the labels and the
 * places (see UNBAKED_LAYERS), in the order of LAYERS. A layer that does not exist adds nothing. Other keys of a
 * layer file do not change the hash. This is the only definition: export.mjs and atlas.mjs use it too.
 * @param {Record<string, object>} layers the layer files of the atlas, by name
 * @returns {string} hex SHA-256
 */
export function layersHash(layers = {}) {
  const hashed = {};
  for (const name of LAYERS) {
    if (UNBAKED_LAYERS.has(name)) continue;
    const layer = layers?.[name];
    if (layer === undefined || layer === null) continue;
    hashed[name] = { features: layer.features, constraints: layer.constraints };
  }
  return sha256(canonicalJson(hashed));
}

/**
 * Whether the bake of the manifest was made from the layers as they are now.
 * @returns {'none'|'current'|'stale'} none when the manifest has no bake
 */
export function bakeStatus(manifest, layers) {
  const bake = manifest?.bake;
  if (bake === undefined || bake === null || typeof bake !== 'object') return 'none';
  return bake.layersHash === layersHash(layers) ? 'current' : 'stale';
}

/**
 * Width and height from the header of a WebP file (simple lossy, lossless or extended format).
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number } | null} null when the header cannot be read
 */
export function webpSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 30) return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  if (chunk === 'VP8L') {
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') {
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/**
 * The kind of an image, by its magic bytes, with its size when the header can be read.
 * @param {Buffer} buffer
 * @returns {{ ext: 'png'|'webp', size: { width: number, height: number } | null } | null} null for any other file
 */
export function imageInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return { ext: 'png', size: pngSize(buffer) };
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', size: webpSize(buffer) };
  }
  return null;
}

/**
 * The file name of a baked image inside bake/: its first 8 hex digits of SHA-256, and its extension.
 * @param {Buffer} buffer the image bytes
 * @returns {string|null} null when the bytes are not a PNG or WebP image
 */
export function bakeFileName(buffer) {
  const info = imageInfo(buffer);
  if (info === null) return null;
  const digest = createHash('sha256').update(buffer).digest('hex');
  return `bake-${digest.slice(0, 8)}.${info.ext}`;
}
