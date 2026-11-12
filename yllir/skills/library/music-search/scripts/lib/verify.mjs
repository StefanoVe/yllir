// Link verifier of the music search. Checks that a music link is an https address
// on an allowed host, follows at most three redirects (each target checked again
// with the same rules), reads at most 200 KB, and reports the page title.
// The only thing sent over the network is the URL itself and a generic User-Agent:
// no cookies, no campaign text, no body. The network call is injectable
// (fetchImpl) so the rules can be tested without a network.
// Every result is { ok, finalUrl, status, title, reason? }; never throws.

import fs from 'node:fs';
import { fail } from './common.mjs';

export const USER_AGENT = 'yllir-music-check';
export const MAX_BYTES = 200 * 1024;
export const MAX_REDIRECTS = 3;
export const TIMEOUT_MS = 8000;
export const MAX_URL_LENGTH = 300;
const MAX_TITLE_CHARS = 200;

/** A refused link: the reason is a short code, the message is plain text. */
function refuseUrl(reason, message) {
  return { ok: false, reason, message };
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const HOST_LINE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const CONTROL_OR_SPACE = /[\s\u0000-\u001f\u007f]/;
/** Titles that only name the service: the page shows no particular track. */
const GENERIC_TITLES = new Set([
  'youtube', 'youtube music', 'spotify', 'soundcloud', 'bandcamp', 'apple music',
  'archive.org', 'free music archive', 'spotify web player',
]);

/**
 * Validates an allow list read from JSON: a non-empty array of host names.
 * @param {unknown} data
 * @returns {{ ok: true, hosts: string[] } | { ok: false, error: string, message: string }}
 */
export function parseHosts(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return fail('hosts-unavailable', 'the allow list must be a non-empty JSON array of host names');
  }
  const hosts = [];
  for (const entry of data) {
    if (typeof entry !== 'string') return fail('hosts-unavailable', 'every entry of the allow list must be a text');
    const host = entry.trim().toLowerCase();
    if (!HOST_LINE.test(host)) return fail('hosts-unavailable', `not a host name: ${entry}`);
    hosts.push(host);
  }
  return { ok: true, hosts: [...new Set(hosts)] };
}

/**
 * Reads and validates the allow list file.
 * @param {string} file path of hosts.json
 */
export function loadHosts(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return fail('hosts-unavailable', 'the allow list file cannot be read');
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return fail('hosts-unavailable', 'the allow list file is not valid JSON');
  }
  return parseHosts(data);
}

function isPrivateIPv4(host) {
  const [a, b] = host.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * Checks one URL against the rules: length, https only, no user information, no
 * non-default port, no IP literal or private address, no local host name, and a
 * host on the allow list (the host itself or one of its subdomains).
 * @param {string} value
 * @param {string[]} hosts allow list, lowercase host names
 * @returns {{ ok: true, url: URL } | { ok: false, reason: string, message: string }}
 */
export function checkUrl(value, hosts) {
  if (typeof value !== 'string' || value === '') return refuseUrl('bad-url', 'the link is empty');
  if (value.length > MAX_URL_LENGTH) return refuseUrl('url-too-long', `the link is longer than ${MAX_URL_LENGTH} characters`);
  if (CONTROL_OR_SPACE.test(value)) return refuseUrl('bad-url', 'the link has spaces or control characters');
  let url;
  try {
    url = new URL(value);
  } catch {
    return refuseUrl('bad-url', 'the link does not parse');
  }
  if (url.protocol !== 'https:') return refuseUrl('not-https', 'the link must use https');
  if (url.username !== '' || url.password !== '') return refuseUrl('userinfo', 'the link must not carry a user name or password');
  if (url.port !== '') return refuseUrl('port', 'the link must use the default https port');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '') return refuseUrl('bad-url', 'the link has no host');
  if (host.includes(':') || host.startsWith('[')) return refuseUrl('ip-address', 'IP address links are not allowed');
  if (IPV4.test(host)) {
    return isPrivateIPv4(host)
      ? refuseUrl('private-address', 'private addresses are not allowed')
      : refuseUrl('ip-address', 'IP address links are not allowed');
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localdomain')
  ) {
    return refuseUrl('local-host', 'local host names are not allowed');
  }
  if (!hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    return refuseUrl('host-not-allowed', 'the host is not on the allow list');
  }
  return { ok: true, url };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    const key = name.toLowerCase();
    if (key.startsWith('#x')) {
      const code = parseInt(key.slice(2), 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith('#')) {
      const code = Number(key.slice(1));
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[key] ?? match;
  });
}

function cleanTitle(raw) {
  const text = decodeEntities(String(raw)).replace(/\s+/g, ' ').trim();
  return text.length > MAX_TITLE_CHARS ? text.slice(0, MAX_TITLE_CHARS).trim() : text;
}

/**
 * Reads the title of a page: the HTML title, or else the og:title meta tag (the
 * oEmbed-style title that services publish in the page head).
 * @param {string} html the first 200 KB of the page
 * @returns {string|null}
 */
export function extractTitle(html) {
  const text = String(html ?? '');
  const tag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  if (tag && cleanTitle(tag[1]) !== '') return cleanTitle(tag[1]);
  for (const meta of text.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bproperty\s*=\s*["']og:title["']/i.test(meta)) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(meta);
    const value = content ? (content[1] ?? content[2] ?? '') : '';
    if (cleanTitle(value) !== '') return cleanTitle(value);
  }
  return null;
}

/** Waits for the promise, or rejects as soon as the signal aborts. */
function untilAborted(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
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
    const result = response?.body?.cancel?.();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // Nothing to discard.
  }
}

/** Reads at most maxBytes of the body. Accepts a web stream, a string or bytes (for fakes). */
async function readLimited(response, maxBytes, signal) {
  const body = response.body;
  if (body === null || body === undefined) return Buffer.alloc(0);
  if (typeof body === 'string') return Buffer.from(body).subarray(0, maxBytes);
  if (body instanceof Uint8Array) return Buffer.from(body).subarray(0, maxBytes);
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await untilAborted(reader.read(), signal);
    if (done) break;
    const piece = Buffer.from(value);
    const take = piece.subarray(0, maxBytes - total);
    chunks.push(take);
    total += take.length;
  }
  try {
    await reader.cancel();
  } catch {
    // The stream is already closed.
  }
  return Buffer.concat(chunks);
}

/**
 * Verifies one music link.
 * @param {string} value the link
 * @param {{ hosts: string[], fetchImpl?: Function, timeoutMs?: number, maxBytes?: number }} options
 * @returns {Promise<{ ok: boolean, finalUrl: string|null, status: number|null, title: string|null, reason?: string }>}
 */
export async function verifyLink(value, options = {}) {
  const {
    hosts = [],
    fetchImpl = globalThis.fetch,
    timeoutMs = TIMEOUT_MS,
    maxBytes = MAX_BYTES,
  } = options;
  if (!Array.isArray(hosts) || hosts.length === 0) {
    return { ok: false, finalUrl: null, status: null, title: null, reason: 'hosts-unavailable' };
  }
  const first = checkUrl(value, hosts);
  if (!first.ok) return { ok: false, finalUrl: null, status: null, title: null, reason: first.reason };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;
  let current = first.url;
  let status = null;

  const refuse = (reason) => ({ ok: false, finalUrl: current.href, status, title: null, reason });
  try {
    let hops = 0;
    for (;;) {
      const response = await untilAborted(
        fetchImpl(current.href, {
          method: 'GET',
          redirect: 'manual',
          signal,
          headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
        }),
        signal,
      );
      status = response.status;

      if (REDIRECT_STATUS.has(status)) {
        discardBody(response);
        const location = response.headers?.get?.('location') ?? null;
        if (!location) return refuse('bad-redirect');
        hops += 1;
        if (hops > MAX_REDIRECTS) return refuse('too-many-redirects');
        let target;
        try {
          target = new URL(location, current).href;
        } catch {
          return refuse('bad-redirect');
        }
        const next = checkUrl(target, hosts);
        if (!next.ok) return refuse(`redirect-${next.reason}`);
        current = next.url;
        continue;
      }

      if (status !== 200) {
        discardBody(response);
        return refuse(`http-${status}`);
      }

      const bytes = await readLimited(response, maxBytes, signal);
      const title = extractTitle(new TextDecoder('utf-8').decode(bytes));
      if (title === null) return refuse('no-title');
      if (GENERIC_TITLES.has(title.toLowerCase())) return refuse('generic-title');
      return { ok: true, finalUrl: current.href, status, title };
    }
  } catch {
    return refuse(signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}
