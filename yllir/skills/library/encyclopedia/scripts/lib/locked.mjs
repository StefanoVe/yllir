// Locked texts of the public part. A public document may hold
//   <!-- locked: <label> -->  ...text...  <!-- /locked -->
// The text is shown only after the visitor types its code. The codes live only
// in the master-only block of the same document, under `### Codici` (it) or
// `### Codes` (en), as list items `- <label>: <code>`.
//
// The site stores AES-256-GCM ciphertext. The key is PBKDF2-SHA256 (200000
// iterations) of the code. The salt and the iv are derived with HMAC from the
// code, the label and the text instead of being drawn at random: the same inputs
// then give the same files (a deliberate deviation from random salts, so that
// rebuilds are reproducible). The code is a secret in any case; the salt and iv
// are public by design.

import { createCipheriv, createHmac, pbkdf2Sync, webcrypto } from 'node:crypto';

export const ITERATIONS = 200000;
export const LABEL_RE = /^[a-z0-9][a-z0-9_-]{0,59}$/;
export const MIN_CODE_LENGTH = 4;
const OPEN_RE = /^<!--\s*locked:\s*(.*?)\s*-->$/;
const CLOSE = '<!-- /locked -->';
const CODES_HEADING = /^###\s+(Codici|Codes)\s*$/;
const CODE_ITEM = /^\s*[-*+]\s+([^:\s][^:]*?)\s*:\s*(.+?)\s*$/;

/**
 * Splits a public body into Markdown segments and locked segments.
 * @param {string} body public Markdown (metadata and master block already removed)
 * @returns {{ segments: Array<{type:'md', text:string}|{type:'locked', label:string, text:string}>, problems: Array<{code:string, message:string}> }}
 */
export function splitLocked(body) {
  const segments = [];
  const problems = [];
  const lines = String(body).split('\n');
  let md = [];
  let current = null;
  const seen = new Set();

  const flushMd = () => {
    if (md.length > 0) segments.push({ type: 'md', text: md.join('\n') });
    md = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const open = OPEN_RE.exec(trimmed);
    if (current === null && open) {
      const label = open[1];
      if (!LABEL_RE.test(label)) {
        problems.push({ code: 'locked-label', message: 'un blocco protetto ha un nome non valido (solo minuscole, cifre e trattini)' });
      } else if (seen.has(label)) {
        problems.push({ code: 'locked-label', message: `il nome «${label}» di un blocco protetto è usato due volte nella stessa scheda` });
      }
      seen.add(label);
      flushMd();
      current = { label, lines: [] };
      continue;
    }
    if (current !== null && trimmed === CLOSE) {
      segments.push({ type: 'locked', label: current.label, text: current.lines.join('\n') });
      current = null;
      continue;
    }
    if (current !== null) current.lines.push(line);
    else md.push(line);
  }
  if (current !== null) {
    problems.push({ code: 'locked-open', message: 'un blocco protetto non è chiuso con <!-- /locked -->' });
  }
  flushMd();
  return { segments, problems };
}

/**
 * Reads the codes of a master-only block: the list items under `### Codici` or `### Codes`.
 * @param {string} masterText the text from the master marker to the end of the document
 * @returns {Map<string, string>} label -> code (the first item wins)
 */
export function parseCodes(masterText) {
  const codes = new Map();
  let inside = false;
  for (const line of String(masterText).split('\n')) {
    if (/^#{1,3}\s/.test(line)) {
      inside = CODES_HEADING.test(line.trim());
      continue;
    }
    if (!inside) continue;
    const item = CODE_ITEM.exec(line);
    if (item && !codes.has(item[1])) codes.set(item[1], item[2]);
  }
  return codes;
}

/** Derives the salt, the iv and the ciphertext of a locked text. Pure and deterministic. */
export function encryptLocked({ code, label, text }) {
  const material = (purpose, length) =>
    createHmac('sha256', code).update(`${purpose}\0${label}\0${text}`).digest().subarray(0, length);
  const salt = material('salt', 16);
  const iv = material('iv', 12);
  const key = pbkdf2Sync(code, salt, ITERATIONS, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    cipher: Buffer.concat([body, tag]).toString('base64'),
  };
}

/**
 * Decrypts a locked text the way the site does: Web Crypto, PBKDF2 then AES-GCM.
 * Rejects when the code is wrong.
 */
export async function decryptLocked({ code, salt, iv, cipher }) {
  const subtle = webcrypto.subtle;
  const base = await subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt: Buffer.from(salt, 'base64'), iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(cipher, 'base64'));
  return new TextDecoder().decode(plain);
}
