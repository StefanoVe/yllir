#!/usr/bin/env node
// Builds the synthetic world notes of the convert/basic case as a .docx, by hand (Node built-ins
// only, no Word, no dependencies). The output is deterministic: the same bytes on every run.
// Usage: node testbench/fixtures/make-convert-basic-docx.mjs [outFile]
// Default outFile: testbench/fixtures/convert-basic-input/mondo.docx.
// The content is invented; it holds the population of Fenvale (400, against 40 in the session notes)
// and no master-only secret.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DEFAULT_OUT = path.join(import.meta.dirname, 'convert-basic-input', 'mondo.docx');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of a buffer, as zip stores it. */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Escapes the five XML special characters. */
export function xmlEscape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** One paragraph. style is a heading style id (Heading1, Heading2) or null; bullet adds a list mark. */
function paragraph(text, { style = null, bullet = false } = {}) {
  const props = [];
  if (style) props.push(`<w:pStyle w:val="${style}"/>`);
  if (bullet) props.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
  const pPr = props.length > 0 ? `<w:pPr>${props.join('')}</w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

/** A table: rows of cell strings; the first row is the header. */
function table(rows) {
  const body = rows
    .map((cells) => `<w:tr>${cells.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join('')}</w:tr>`)
    .join('');
  return `<w:tbl>${body}</w:tbl>`;
}

/** The world notes, in document order. */
export function worldBody() {
  return [
    paragraph('Mondo di Ardelmo', { style: 'Heading1' }),
    paragraph(
      'Ardelmo è una città portuale costruita su tre colline attorno al fiume Sallo. Il consiglio della città governa dall\'archivio, e il sigillo di Ardelmo ne è il simbolo.',
    ),
    paragraph('I luoghi', { style: 'Heading2' }),
    paragraph(
      'Fenvale è un villaggio sulla riva est del lago, con quattrocento abitanti che vivono di pesca e di commercio con Ardelmo.',
    ),
    paragraph('Ponte Rotto di Sallavo: un ponte di pietra crollato a metà, attraversato solo a piedi.', { bullet: true }),
    paragraph('Tempio di Lume: sulla collina sopra Ardelmo, con una sala bassa e un portale di ferro.', { bullet: true }),
    paragraph('Molo di Sallavo: dove le navi caricano il grano per la città.', { bullet: true }),
    paragraph('Le persone', { style: 'Heading2' }),
    table([
      ['Nome', 'Ruolo', 'Dove'],
      ['Oddo Selce', 'Tesoriere della gilda dei mercanti', 'Ardelmo'],
      ['Varn', 'Capitano della nave Ondina', 'Molo di Sallavo'],
    ]),
    paragraph('La gilda dei mercanti', { style: 'Heading2' }),
    paragraph(
      'La gilda controlla i carri che vanno tra Ardelmo e il lago. I suoi membri pagano le tasse al consiglio della città.',
    ),
  ].join('');
}

/** The document part: the body inside the w namespace, with the section properties. */
export function documentXml(bodyXml) {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    `<w:body>${bodyXml}<w:sectPr/></w:body>`,
    '</w:document>',
  ].join('');
}

const CONTENT_TYPES = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '<Default Extension="xml" ContentType="application/xml"/>',
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
  '</Types>',
].join('');

const ROOT_RELS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
  '</Relationships>',
].join('');

const DOCUMENT_RELS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
].join('');

/** Builds a zip archive by hand: local headers, central directory, end record. Fixed timestamps. */
export function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const DOS_DATE = 0x0021; // 1980-01-01
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.data, 'utf8');
    const raw = zlib.deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(raw.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, raw);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(raw.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + raw.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** The whole .docx as bytes. */
export function buildDocx() {
  return buildZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/document.xml', data: documentXml(worldBody()) },
    { name: 'word/_rels/document.xml.rels', data: DOCUMENT_RELS },
  ]);
}

function main() {
  const out = path.resolve(process.argv[2] ?? DEFAULT_OUT);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buildDocx());
  console.log(out);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
