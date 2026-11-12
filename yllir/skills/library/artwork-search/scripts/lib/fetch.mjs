// Safe downloader for the artwork search: fetches one image over https only, with
// manual redirects, a type check, a size limit, a timeout and a check of the real
// bytes, then saves it with a new file name (never overwrites).
// Only built-in modules. The network call takes an injectable fetchImpl.
// Every result is { ok:true, file, ext, bytes } or { ok:false, error, message }; never throws.

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
export const MIN_BYTES = 2 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const TYPE_TO_FORMAT = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/webp', 'webp'],
]);
const FORMAT_TO_EXT = { png: '.png', jpeg: '.jpg', webp: '.webp' };
const STEM = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function fail(error, message) {
  return { ok: false, error, message };
}

/**
 * Checks that a URL parses, uses https and names a public host.
 * Returns { ok:true, url } (URL object) or { ok:false, error:'bad-url', message }.
 */
export function checkHttpsUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return fail('bad-url', 'the URL does not parse');
  }
  if (url.protocol !== 'https:') return fail('bad-url', 'the URL must use https');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '') return fail('bad-url', 'the URL has no host');
  if (host === 'localhost' || host.endsWith('.localhost')) return fail('bad-url', 'localhost is not allowed');
  if (host.endsWith('.local') || host.endsWith('.internal')) return fail('bad-url', 'local host names are not allowed');
  if (host.startsWith('[') || host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return fail('bad-url', 'IP address literals are not allowed');
  }
  return { ok: true, url };
}

/** Detects the real format from the first bytes: 'png', 'jpeg', 'webp' or null. */
export function detectFormat(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

/** Rejects with a sentinel as soon as the signal aborts, even if the promise never settles. */
function untilAborted(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function discardBody(response) {
  try {
    response.body?.cancel?.().catch?.(() => {});
  } catch {
    // Nothing to discard.
  }
}

/** Follows at most MAX_REDIRECTS redirects, each target checked as https with a public host. */
async function fetchFollowingRedirects(url, signal, fetchImpl) {
  let current = checkHttpsUrl(url);
  if (!current.ok) return current;
  let hops = 0;
  for (;;) {
    const response = await untilAborted(
      fetchImpl(current.url.href, { redirect: 'manual', signal }),
      signal,
    );
    if (!REDIRECT_STATUS.has(response.status)) return { ok: true, response };
    discardBody(response);
    const location = response.headers.get('location');
    if (!location) return fail('failed', `redirect ${response.status} without a location`);
    hops += 1;
    if (hops > MAX_REDIRECTS) return fail('bad-redirect', `more than ${MAX_REDIRECTS} redirects`);
    let target;
    try {
      target = new URL(location, current.url).href;
    } catch {
      return fail('bad-redirect', 'the redirect target does not parse');
    }
    const next = checkHttpsUrl(target);
    if (!next.ok) return fail('bad-redirect', `redirect target refused: ${next.message}`);
    current = next;
  }
}

/** Reads the body up to maxBytes; returns the bytes or too-big. */
async function readLimited(response, maxBytes, signal) {
  if (!response.body) return { ok: true, bytes: Buffer.alloc(0) };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await untilAborted(reader.read(), signal);
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      return fail('too-big', `the image is larger than ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return { ok: true, bytes: Buffer.concat(chunks, total) };
}

/** Fetches and checks the image without saving it. */
async function fetchImage({ url, maxBytes, fetchImpl, signal }) {
  const fetched = await fetchFollowingRedirects(url, signal, fetchImpl);
  if (!fetched.ok) return fetched;
  const { response } = fetched;

  if (response.status < 200 || response.status > 299) {
    discardBody(response);
    return fail('failed', `the server answered HTTP ${response.status}`);
  }

  const declared = TYPE_TO_FORMAT.get((response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase());
  if (declared === undefined) {
    discardBody(response);
    return fail('bad-type', 'the content type is not png, jpeg or webp');
  }

  const length = (response.headers.get('content-length') ?? '').trim();
  if (/^\d+$/.test(length) && Number(length) > maxBytes) {
    discardBody(response);
    return fail('too-big', `the declared size is larger than ${maxBytes} bytes`);
  }

  const read = await readLimited(response, maxBytes, signal);
  if (!read.ok) return read;
  const { bytes } = read;

  if (bytes.length < MIN_BYTES) return fail('too-small', `the image is smaller than ${MIN_BYTES} bytes`);
  const actual = detectFormat(bytes);
  if (actual === null || actual !== declared) {
    return fail('bad-bytes', 'the file content does not match the declared image type');
  }
  return { ok: true, bytes, format: actual };
}

/**
 * Downloads one image and saves it as <destDir>/<stem><ext>, never overwriting.
 * @param {{url:string, destDir:string, stem:string, maxBytes?:number, fetchImpl?:Function, timeoutMs?:number}} options
 */
export async function downloadImage({
  url,
  destDir,
  stem,
  maxBytes = DEFAULT_MAX_BYTES,
  fetchImpl = fetch,
  timeoutMs = 20000,
} = {}) {
  try {
    if (typeof stem !== 'string' || !STEM.test(stem)) {
      return fail('bad-stem', 'the file name must be a plain name of letters, digits, - or _');
    }
    if (typeof destDir !== 'string' || destDir === '') return fail('bad-dest', 'the destination folder is missing');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let image;
    try {
      image = await fetchImage({ url, maxBytes, fetchImpl, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) return fail('timeout', `no complete answer within ${timeoutMs} ms`);
      return fail('failed', `network error: ${err?.message ?? String(err)}`);
    } finally {
      clearTimeout(timer);
    }
    if (!image.ok) return image;

    const ext = FORMAT_TO_EXT[image.format];
    fs.mkdirSync(destDir, { recursive: true });
    const file = path.join(destDir, `${stem}${ext}`);
    try {
      fs.writeFileSync(file, image.bytes, { flag: 'wx' });
    } catch (err) {
      if (err.code === 'EEXIST') return fail('exists', `${path.basename(file)} already exists and is never overwritten`);
      return fail('failed', `could not save the file: ${err.message}`);
    }
    return { ok: true, file, ext, bytes: image.bytes.length };
  } catch (err) {
    return fail('failed', `unexpected error: ${err?.message ?? String(err)}`);
  }
}
