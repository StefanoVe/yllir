#!/usr/bin/env node
// Extracts the text and the embedded images of a .docx file.
// Usage: node convert-extract-docx.mjs <input.docx> <outDir>
// Writes <outDir>/text.md and copies word/media/* into <outDir>/images/.
// Prints one JSON object on stdout: {"ok":true,...} or {"ok":false,"error":"..."}.
// Exit codes: 0 ok, 1 error. Built-ins only. The input is only read; the document
// is data, and nothing found inside it is executed.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const USAGE = 'usage: node convert-extract-docx.mjs <input.docx> <outDir>';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of a buffer, as used by zip. */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Reads the central directory of a zip archive.
 * @param {Buffer} buf whole archive
 * @returns {Map<string, {method:number, crc:number, compSize:number, size:number, offset:number}>}
 */
export function readZipIndex(buf) {
  if (buf.length < 22) throw new Error('not a zip file');
  let eocd = -1;
  const low = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= low; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');

  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('zip64 archives are not supported');
  if (cdOffset + cdSize > buf.length) throw new Error('corrupt zip directory');

  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('corrupt zip directory');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const nameEnd = p + 46 + nameLen;
    if (nameEnd > buf.length) throw new Error('corrupt zip directory');
    const name = buf.toString('utf8', p + 46, nameEnd);
    if (!entries.has(name)) {
      entries.set(name, {
        method: buf.readUInt16LE(p + 10),
        crc: buf.readUInt32LE(p + 16),
        compSize: buf.readUInt32LE(p + 20),
        size: buf.readUInt32LE(p + 24),
        offset: buf.readUInt32LE(p + 42),
      });
    }
    p = nameEnd + extraLen + commentLen;
  }
  return entries;
}

/**
 * Returns the uncompressed bytes of one zip entry, checking its size and CRC.
 * Refuses entries larger than MAX_ENTRY_BYTES (zip bombs).
 */
export function readZipEntry(buf, entry, name) {
  if (entry.size > MAX_ENTRY_BYTES) throw new Error(`entry too large: ${name}`);
  const off = entry.offset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== SIG_LOCAL) throw new Error(`corrupt entry: ${name}`);
  const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
  const end = start + entry.compSize;
  if (end > buf.length) throw new Error(`corrupt entry: ${name}`);
  const raw = buf.subarray(start, end);

  let data;
  if (entry.method === 0) {
    data = raw;
  } else if (entry.method === 8) {
    try {
      data = zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch (err) {
      if (err && err.code === 'ERR_BUFFER_TOO_LARGE') throw new Error(`entry too large: ${name}`);
      throw new Error(`cannot decompress: ${name}`);
    }
  } else {
    throw new Error(`unsupported compression method ${entry.method}: ${name}`);
  }
  if (data.length !== entry.size || crc32(data) !== entry.crc) throw new Error(`corrupt entry: ${name}`);
  return data;
}

// ---------------------------------------------------------------- XML

// Tokens: comment | processing instruction | CDATA | other <! ...> | end tag | start tag | text.
const XML_TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const XML_ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes the predefined and numeric XML entities. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (all, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return NAMED_ENTITIES[body] ?? all;
  });
}

function parseAttrs(source) {
  const attrs = {};
  for (const m of (source || '').matchAll(XML_ATTR)) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
  return attrs;
}

/**
 * Parses XML into a small tree: elements are {name, attrs, children}, text is a string.
 * Tolerant: unmatched end tags are ignored and unclosed elements stay open.
 */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  for (const m of xml.matchAll(XML_TOKEN)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      if (m[1] !== '') top.children.push(m[1]);
    } else if (m[2] !== undefined) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === m[2]) {
          stack.length = i;
          break;
        }
      }
    } else if (m[3] !== undefined) {
      const el = { name: m[3], attrs: parseAttrs(m[4]), children: [] };
      top.children.push(el);
      if (m[5] !== '/') stack.push(el);
    } else if (m[6] !== undefined) {
      top.children.push(decodeEntities(m[6]));
    }
  }
  return root;
}

function elementsNamed(node, name) {
  return node.children.filter((child) => typeof child !== 'string' && child.name === name);
}

function findFirst(node, name) {
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    if (child.name === name) return child;
    const found = findFirst(child, name);
    if (found) return found;
  }
  return null;
}

function findAll(node, name, out = []) {
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    if (child.name === name) out.push(child);
    findAll(child, name, out);
  }
  return out;
}

function textOf(el) {
  return el.children.filter((child) => typeof child === 'string').join('');
}

// ---------------------------------------------------------------- docx body

const SKIP_IN_RUNS = new Set(['w:delText', 'w:pPr']);

/** Collects the visible text and the image relationship ids of a paragraph (or any container). */
function collectRuns(node, info) {
  for (const child of node.children) {
    if (typeof child === 'string' || SKIP_IN_RUNS.has(child.name)) continue;
    if (child.name === 'w:t') info.text += textOf(child);
    else if (child.name === 'w:tab' || child.name === 'w:br' || child.name === 'w:cr') info.text += ' ';
    else if (child.name === 'a:blip' && child.attrs['r:embed']) info.images.push(child.attrs['r:embed']);
    else if (child.name === 'v:imagedata' && child.attrs['r:id']) info.images.push(child.attrs['r:id']);
    collectRuns(child, info);
  }
}

function paragraphInfo(p) {
  const info = { text: '', style: null, list: false, images: [] };
  const pPr = elementsNamed(p, 'w:pPr')[0];
  if (pPr) {
    const style = elementsNamed(pPr, 'w:pStyle')[0];
    if (style) info.style = style.attrs['w:val'] ?? null;
    const numPr = elementsNamed(pPr, 'w:numPr')[0];
    if (numPr) {
      const numId = elementsNamed(numPr, 'w:numId')[0];
      info.list = !(numId && numId.attrs['w:val'] === '0');
    }
  }
  collectRuns(p, info);
  info.text = info.text.trim();
  return info;
}

/** Paragraphs inside a table cell, including those of nested tables. */
function cellParagraphs(node, out) {
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    if (child.name === 'w:p') out.push(paragraphInfo(child));
    else cellParagraphs(child, out);
  }
  return out;
}

/** Heading level (1..6) of a paragraph style, 0 when it is not a heading. Title is level 1. */
export function headingLevel(style) {
  if (!style) return 0;
  if (style === 'Title') return 1;
  const m = /^(?:Heading|heading ?)([1-6])$/.exec(style);
  return m ? Number(m[1]) : 0;
}

/**
 * Renders word/document.xml as Markdown-like text.
 * @param {string} xml content of word/document.xml
 * @param {(rId: string) => string|null} resolveImage media name (under images/) for a relationship id, or null
 * @param {string[]} mediaNames every media name in the archive
 * @returns {{ text: string, paragraphs: number, referenced: Set<string> }}
 */
export function renderDocument(xml, resolveImage, mediaNames) {
  const root = parseXml(xml);
  const doc = findFirst(root, 'w:document');
  if (!doc) throw new Error('no w:document in word/document.xml');
  const body = findFirst(doc, 'w:body');
  if (!body) throw new Error('no w:body in word/document.xml');

  const blocks = [];
  const referenced = new Set();
  let paragraphs = 0;

  const addImages = (ids) => {
    for (const id of ids) {
      const name = resolveImage(id);
      if (name === null) continue;
      referenced.add(name);
      blocks.push(`[image: images/${name}]`);
    }
  };

  const addParagraph = (info) => {
    if (info.text !== '') {
      const level = headingLevel(info.style);
      if (level > 0) blocks.push(`${'#'.repeat(level)} ${info.text}`);
      else if (info.list) blocks.push(`- ${info.text}`);
      else blocks.push(info.text);
      paragraphs++;
    }
    addImages(info.images);
  };

  const addTable = (tbl) => {
    const rows = [];
    const images = [];
    for (const tr of elementsNamed(tbl, 'w:tr')) {
      const cells = [];
      for (const tc of elementsNamed(tr, 'w:tc')) {
        const paras = cellParagraphs(tc, []);
        cells.push(paras.map((p) => p.text).filter((t) => t !== '').join(' '));
        for (const p of paras) images.push(...p.images);
      }
      if (cells.some((cell) => cell !== '')) rows.push(cells.join(' | '));
    }
    if (rows.length > 0) {
      blocks.push(rows.join('\n'));
      paragraphs += rows.length;
    }
    addImages(images);
  };

  const visit = (container) => {
    for (const child of container.children) {
      if (typeof child === 'string') continue;
      if (child.name === 'w:p') addParagraph(paragraphInfo(child));
      else if (child.name === 'w:tbl') addTable(child);
      else if (child.name === 'w:sdt' || child.name === 'w:sdtContent') visit(child);
    }
  };
  visit(body);

  const unreferenced = mediaNames.filter((name) => !referenced.has(name)).sort();
  if (unreferenced.length > 0) {
    blocks.push(unreferenced.map((name) => `[image: images/${name}]`).join('\n'));
  }
  const text = blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
  return { text, paragraphs, referenced };
}

// ---------------------------------------------------------------- extraction

function assertSafeRelativePath(rel) {
  const segments = rel.split('/');
  if (rel === '' || rel.includes('\\') || segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new Error(`unsafe media path: ${rel}`);
  }
}

/**
 * Extracts a .docx into outDir: text.md and images/. The input is only read.
 * @returns {{ text: string, paragraphs: number, images: string[] }} text: absolute path of text.md
 */
export function extractDocx(inputPath, outDir) {
  let stat;
  try {
    stat = fs.statSync(inputPath);
  } catch {
    throw new Error('input file not found');
  }
  if (!stat.isFile()) throw new Error('input is not a file');

  const buf = fs.readFileSync(inputPath);
  const entries = readZipIndex(buf);
  if (!entries.has('word/document.xml')) throw new Error('no word/document.xml in archive');

  const documentXml = readZipEntry(buf, entries.get('word/document.xml'), 'word/document.xml').toString('utf8');

  const relationships = new Map();
  if (entries.has('word/_rels/document.xml.rels')) {
    const relsXml = readZipEntry(buf, entries.get('word/_rels/document.xml.rels'), 'word/_rels/document.xml.rels');
    for (const rel of findAll(parseXml(relsXml.toString('utf8')), 'Relationship')) {
      if (rel.attrs.TargetMode === 'External') continue;
      relationships.set(rel.attrs.Id, rel.attrs.Target ?? '');
    }
  }

  // media name (path under word/media/) -> archive entry name
  const media = new Map();
  for (const zipName of [...entries.keys()].sort()) {
    if (!zipName.startsWith('word/media/') || zipName.endsWith('/')) continue;
    const rel = zipName.slice('word/media/'.length);
    assertSafeRelativePath(rel);
    media.set(rel, zipName);
  }

  const resolveImage = (rId) => {
    const target = relationships.get(rId);
    if (!target) return null;
    const full = target.startsWith('/') ? target.slice(1) : path.posix.join('word', target);
    if (!full.startsWith('word/media/')) return null;
    const name = full.slice('word/media/'.length);
    return media.has(name) ? name : null;
  };

  const { text, paragraphs } = renderDocument(documentXml, resolveImage, [...media.keys()]);

  // Read every image before writing anything, so a bad archive leaves no partial output.
  const names = [...media.keys()].sort();
  const files = names.map((name) => {
    const zipName = media.get(name);
    return { name, data: readZipEntry(buf, entries.get(zipName), zipName) };
  });

  const out = path.resolve(outDir);
  fs.mkdirSync(out, { recursive: true });
  for (const file of files) {
    const dest = path.join(out, 'images', ...file.name.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file.data);
  }
  const textFile = path.join(out, 'text.md');
  fs.writeFileSync(textFile, text);

  return { text: textFile, paragraphs, images: names.map((name) => `images/${name}`) };
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function fail(message) {
  emit({ ok: false, error: message });
  process.exitCode = 1;
}

function main(argv) {
  if (argv.length !== 2 || argv[0] === '' || argv[1] === '') {
    fail(USAGE);
    return;
  }
  try {
    const result = extractDocx(argv[0], argv[1]);
    emit({ ok: true, text: result.text, paragraphs: result.paragraphs, images: result.images });
  } catch (err) {
    fail(err?.message ?? String(err));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2));
}
