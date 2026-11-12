// Image metadata of the public site. JPEG loses its APP1 (EXIF, XMP), APP13
// (IPTC) and COM segments; PNG loses its tEXt, iTXt, zTXt and eXIf chunks. The
// pixels are copied byte for byte. WebP and GIF are never rewritten: a copy is
// refused when they carry metadata, so the master re-exports the picture.
// Each function is pure over Buffers and returns null for a file it cannot read.

export const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

const JPEG_STRIP = new Map([[0xe1, 'exif-xmp'], [0xed, 'iptc'], [0xfe, 'comment']]);
const PNG_STRIP = new Map([
  ['tEXt', 'text'],
  ['iTXt', 'text'],
  ['zTXt', 'text'],
  ['eXIf', 'exif'],
]);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Kind of a file from its extension: png, jpeg, webp or gif; null for others. */
export function formatOf(ext) {
  const e = String(ext).toLowerCase();
  if (e === 'png') return 'png';
  if (e === 'jpg' || e === 'jpeg') return 'jpeg';
  if (e === 'webp') return 'webp';
  if (e === 'gif') return 'gif';
  return null;
}

/**
 * Removes the metadata of a picture and says what was removed.
 * @returns {{ ok: true, bytes: Buffer, removed: string[] } | { ok: false, reason: string }}
 */
export function prepareImage(bytes, ext) {
  const format = formatOf(ext);
  if (format === 'jpeg') return stripJpeg(bytes);
  if (format === 'png') return stripPng(bytes);
  if (format === 'webp' || format === 'gif') {
    const found = findMetadata(bytes, format);
    if (found === null) return { ok: false, reason: 'not-readable' };
    if (found.length > 0) return { ok: false, reason: 'metadata-not-removable' };
    return { ok: true, bytes, removed: [] };
  }
  return { ok: false, reason: 'unsupported' };
}

/**
 * Lists the metadata kinds still present in a picture (empty when clean).
 * @returns {string[]|null} null when the file is not a readable picture of that format
 */
export function findMetadata(bytes, format) {
  if (format === 'jpeg') {
    const segments = jpegSegments(bytes);
    if (segments === null) return null;
    return segments.filter((s) => JPEG_STRIP.has(s.marker)).map((s) => JPEG_STRIP.get(s.marker));
  }
  if (format === 'png') {
    const chunks = pngChunks(bytes);
    if (chunks === null) return null;
    return chunks.filter((c) => PNG_STRIP.has(c.type)).map((c) => PNG_STRIP.get(c.type));
  }
  if (format === 'webp') return webpMetadata(bytes);
  if (format === 'gif') return gifMetadata(bytes);
  return null;
}

/** Marker segments of a JPEG up to the start of the entropy-coded data. */
function jpegSegments(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const segments = [];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    while (bytes[i] === 0xff && i + 1 < bytes.length && bytes[i + 1] === 0xff) i++;
    const marker = bytes[i + 1];
    if (marker === undefined) return null;
    if (marker === 0xd9 || marker === 0xda) {
      segments.push({ marker, start: i, end: i + 2, dataStart: i });
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (i + 4 > bytes.length) return null;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    const end = i + 2 + length;
    if (end > bytes.length) return null;
    segments.push({ marker, start: i, end });
    i = end;
  }
  return segments;
}

function stripJpeg(bytes) {
  const segments = jpegSegments(bytes);
  if (segments === null) return { ok: false, reason: 'not-readable' };
  const last = segments[segments.length - 1];
  if (last.marker !== 0xda && last.marker !== 0xd9) return { ok: false, reason: 'not-readable' };
  const removed = [];
  const parts = [bytes.subarray(0, 2)];
  for (const segment of segments) {
    if (segment === last) break;
    if (JPEG_STRIP.has(segment.marker)) {
      removed.push(JPEG_STRIP.get(segment.marker));
      continue;
    }
    parts.push(bytes.subarray(segment.start, segment.end));
  }
  // The start-of-scan marker (or the end marker) and everything after it are kept as they are.
  parts.push(bytes.subarray(last.start));
  return { ok: true, bytes: Buffer.concat(parts), removed: [...new Set(removed)].sort() };
}

/** Chunks of a PNG, or null when the signature or a chunk is broken. */
function pngChunks(bytes) {
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  const chunks = [];
  let i = 8;
  while (i < bytes.length) {
    if (i + 12 > bytes.length) return null;
    const length = bytes.readUInt32BE(i);
    const type = bytes.toString('latin1', i + 4, i + 8);
    const end = i + 12 + length;
    if (end > bytes.length) return null;
    chunks.push({ type, start: i, end });
    i = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

function stripPng(bytes) {
  const chunks = pngChunks(bytes);
  if (chunks === null || chunks[chunks.length - 1].type !== 'IEND') return { ok: false, reason: 'not-readable' };
  const removed = [];
  const parts = [bytes.subarray(0, 8)];
  for (const chunk of chunks) {
    if (PNG_STRIP.has(chunk.type)) {
      removed.push(PNG_STRIP.get(chunk.type));
    } else {
      parts.push(bytes.subarray(chunk.start, chunk.end));
    }
  }
  return { ok: true, bytes: Buffer.concat(parts), removed: [...new Set(removed)].sort() };
}

/** Metadata chunks of a WebP (EXIF, XMP), or null when the container is broken. */
function webpMetadata(bytes) {
  if (bytes.length < 12 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return null;
  const found = [];
  let i = 12;
  while (i + 8 <= bytes.length) {
    const type = bytes.toString('latin1', i, i + 4);
    const size = bytes.readUInt32LE(i + 4);
    if (type === 'EXIF') found.push('exif-xmp');
    if (type === 'XMP ') found.push('exif-xmp');
    i += 8 + size + (size % 2);
  }
  return found;
}

/** Metadata blocks of a GIF (comment and XMP application extensions), or null when broken. */
function gifMetadata(bytes) {
  if (bytes.length < 13 || (bytes.toString('latin1', 0, 6) !== 'GIF87a' && bytes.toString('latin1', 0, 6) !== 'GIF89a')) return null;
  const found = [];
  let i = 13;
  if (bytes[10] & 0x80) i += 3 * 2 ** ((bytes[10] & 0x07) + 1);
  while (i < bytes.length) {
    const block = bytes[i];
    if (block === 0x3b) return found;
    if (block === 0x2c) {
      if (i + 10 > bytes.length) return null;
      const packed = bytes[i + 9];
      i += 10;
      if (packed & 0x80) i += 3 * 2 ** ((packed & 0x07) + 1);
      i += 1; // LZW minimum code size
    } else if (block === 0x21) {
      const label = bytes[i + 1];
      if (label === 0xfe) found.push('comment');
      if (label === 0xff && bytes.toString('latin1', i + 3, i + 14) === 'XMP DataXMP') found.push('exif-xmp');
      i += 2;
    } else {
      return null;
    }
    // data sub-blocks until the zero terminator
    while (i < bytes.length && bytes[i] !== 0) i += bytes[i] + 1;
    if (i >= bytes.length) return null;
    i += 1;
  }
  return null;
}
