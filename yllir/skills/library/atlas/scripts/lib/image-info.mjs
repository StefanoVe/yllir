// Kind and size of an image, read from its magic bytes and header only. Pure: no file reads.
// PNG, JPEG and WebP are recognised; any other content gives null.

import { pngSize } from '../../../../../scripts/lib/png.mjs';

/** The largest image the atlas accepts as a reference or a provider output. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Width and height from the header of a WebP file (simple lossy, lossless or extended format).
function webpSize(buffer) {
  if (buffer.length < 30) return null;
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

// Width and height from the first start-of-frame segment of a JPEG file, or null when there is none.
function jpegSize(buffer) {
  let at = 2;
  while (at + 4 <= buffer.length) {
    if (buffer[at] !== 0xff) return null;
    const marker = buffer[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (at + 9 > buffer.length) return null;
      return { width: buffer.readUInt16BE(at + 7), height: buffer.readUInt16BE(at + 5) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    at += 2 + buffer.readUInt16BE(at + 2);
  }
  return null;
}

/**
 * The kind of an image, by its magic bytes, with its size when the header can be read.
 * @param {Buffer} buffer
 * @returns {{ format: 'png'|'jpeg'|'webp', width: number, height: number } | null}
 *   null when the bytes are not a PNG, JPEG or WebP image, or when the size cannot be read
 */
export function imageInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  let format = null;
  let size = null;
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    format = 'png';
    size = pngSize(buffer);
  } else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    format = 'jpeg';
    size = jpegSize(buffer);
  } else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    format = 'webp';
    size = webpSize(buffer);
  }
  if (format === null || size === null || !(size.width > 0) || !(size.height > 0)) return null;
  return { format, width: size.width, height: size.height };
}
