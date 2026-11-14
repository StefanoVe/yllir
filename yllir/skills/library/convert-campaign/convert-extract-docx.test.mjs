import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { crc32 } from './convert-extract-docx.mjs';

const CLI = fileURLToPath(new URL('./convert-extract-docx.mjs', import.meta.url));

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const WP_NS = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';

const DOCUMENT_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W_NS} ${R_NS} ${A_NS} ${WP_NS}><w:body>`;
const DOCUMENT_TAIL = '</w:body></w:document>';

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake png body, not a real image', 'utf8'),
]);

const RELS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
  '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
  '</Relationships>',
].join('\n');

const CONTENT_TYPES = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '<Default Extension="xml" ContentType="application/xml"/>',
  '<Default Extension="png" ContentType="image/png"/>',
  '</Types>',
].join('\n');

const DRAWING =
  '<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><a:blip r:embed="rId5"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

/** The happy-path document: heading, two paragraphs, a bullet, a 2x2 table, one image. */
const HAPPY_BODY = [
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>The Lost Mill</w:t></w:r></w:p>',
  '<w:p><w:r><w:t xml:space="preserve">First </w:t></w:r><w:r><w:t>paragraph &amp; more</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>Second paragraph</w:t></w:r><w:r><w:tab/><w:t>tabbed</w:t></w:r></w:p>',
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>A bullet</w:t></w:r></w:p>',
  '<w:tbl>',
  '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>',
  '<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr>',
  '</w:tbl>',
  `<w:p>${DRAWING}</w:p>`,
].join('');

const HAPPY_TEXT = [
  '# The Lost Mill',
  '',
  'First paragraph & more',
  '',
  'Second paragraph tabbed',
  '',
  '- A bullet',
  '',
  'A1 | B1',
  'A2 | B2',
  '',
  '[image: images/image1.png]',
  '',
].join('\n');

/** Builds a zip archive by hand. Each file: {name, data: Buffer, method: 0 | 8}. */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = file.method === 8 ? zlib.deflateRawSync(file.data) : file.data;
    const crc = crc32(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(file.method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(raw.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, raw);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(file.method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(raw.length, 20);
    central.writeUInt32LE(file.data.length, 24);
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

/** A docx with the given body XML, plus optional extra media files (name -> bytes). */
function buildDocx(bodyXml, extraMedia = {}) {
  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES), method: 8 },
    { name: 'word/document.xml', data: Buffer.from(`${DOCUMENT_HEAD}${bodyXml}${DOCUMENT_TAIL}`), method: 8 },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(RELS), method: 8 },
    { name: 'word/media/image1.png', data: PNG_BYTES, method: 0 },
  ];
  for (const [name, data] of Object.entries(extraMedia)) {
    files.push({ name: `word/media/${name}`, data, method: 0 });
  }
  return buildZip(files);
}

/** Runs f with a fresh temporary folder, removed afterwards. */
function withTmp(f) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-convert-docx-'));
  try {
    return f(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = null;
  }
  return { status: result.status, stdout: result.stdout, json };
}

test('happy path: text.md has headings, paragraphs, bullet, table and image line', () => {
  withTmp((dir) => {
    const input = path.join(dir, 'campaign.docx');
    const out = path.join(dir, 'out');
    fs.writeFileSync(input, buildDocx(HAPPY_BODY));

    const result = runCli([input, out]);
    assert.equal(result.status, 0);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.text, path.join(out, 'text.md'));
    assert.equal(result.json.paragraphs, 6);
    assert.deepEqual(result.json.images, ['images/image1.png']);
    assert.equal(fs.readFileSync(path.join(out, 'text.md'), 'utf8'), HAPPY_TEXT);
  });
});

test('image is copied to images/ with its name and bytes', () => {
  withTmp((dir) => {
    const input = path.join(dir, 'campaign.docx');
    const out = path.join(dir, 'out');
    fs.writeFileSync(input, buildDocx(HAPPY_BODY));

    const result = runCli([input, out]);
    assert.equal(result.status, 0);
    const copied = fs.readFileSync(path.join(out, 'images', 'image1.png'));
    assert.deepEqual(copied, PNG_BYTES);
  });
});

test('a file that is not a zip gives ok:false and exit code 1', () => {
  withTmp((dir) => {
    const input = path.join(dir, 'notes.docx');
    fs.writeFileSync(input, 'this is plain text, not a zip archive at all');

    const result = runCli([input, path.join(dir, 'out')]);
    assert.equal(result.status, 1);
    assert.equal(result.json.ok, false);
    assert.equal(typeof result.json.error, 'string');
    assert.match(result.json.error, /not a zip/);
  });
});

test('a missing input gives ok:false and exit code 1', () => {
  withTmp((dir) => {
    const result = runCli([path.join(dir, 'absent.docx'), path.join(dir, 'out')]);
    assert.equal(result.status, 1);
    assert.equal(result.json.ok, false);
    assert.match(result.json.error, /not found/);
  });
});

test('a zip without word/document.xml gives ok:false', () => {
  withTmp((dir) => {
    const input = path.join(dir, 'other.zip');
    fs.writeFileSync(input, buildZip([{ name: 'readme.txt', data: Buffer.from('hi'), method: 0 }]));

    const result = runCli([input, path.join(dir, 'out')]);
    assert.equal(result.status, 1);
    assert.equal(result.json.ok, false);
    assert.match(result.json.error, /word\/document\.xml/);
  });
});

test('deleted text (w:del / w:delText) is ignored', () => {
  withTmp((dir) => {
    const input = path.join(dir, 'tracked.docx');
    const out = path.join(dir, 'out');
    const body =
      '<w:p><w:del w:id="1" w:author="x"><w:r><w:delText>struck out</w:delText></w:r></w:del>' +
      '<w:r><w:t>kept</w:t></w:r></w:p>';
    fs.writeFileSync(input, buildDocx(body));

    const result = runCli([input, out]);
    assert.equal(result.status, 0);
    // image1.png is in the archive but not referenced by this body, so it is listed at the end.
    assert.equal(
      fs.readFileSync(path.join(out, 'text.md'), 'utf8'),
      'kept\n\n[image: images/image1.png]\n',
    );
    assert.equal(result.json.paragraphs, 1);
  });
});

test('unreferenced media is copied and listed at the end of text.md', () => {
  withTmp((dir) => {
    const input = path.join(dir, 'orphan.docx');
    const out = path.join(dir, 'out');
    const body = '<w:p><w:r><w:t>Only text</w:t></w:r></w:p>';
    fs.writeFileSync(input, buildDocx(body, { 'orphan.jpg': Buffer.from('jpeg-ish') }));

    const result = runCli([input, out]);
    assert.equal(result.status, 0);
    assert.deepEqual(result.json.images, ['images/image1.png', 'images/orphan.jpg']);
    assert.equal(
      fs.readFileSync(path.join(out, 'text.md'), 'utf8'),
      'Only text\n\n[image: images/image1.png]\n[image: images/orphan.jpg]\n',
    );
  });
});

test('an entry larger than 50 MB is refused (zip bomb)', () => {
  withTmp((dir) => {
    const input = path.join(dir, 'bomb.docx');
    const out = path.join(dir, 'out');
    const bomb = Buffer.alloc(51 * 1024 * 1024);
    const body = '<w:p><w:r><w:t>hello</w:t></w:r></w:p>';
    const files = [
      { name: 'word/document.xml', data: Buffer.from(`${DOCUMENT_HEAD}${body}${DOCUMENT_TAIL}`), method: 8 },
      { name: 'word/media/huge.bin', data: bomb, method: 8 },
    ];
    fs.writeFileSync(input, buildZip(files));

    const result = runCli([input, out]);
    assert.equal(result.status, 1);
    assert.equal(result.json.ok, false);
    assert.match(result.json.error, /too large/);
    assert.equal(fs.existsSync(path.join(out, 'text.md')), false);
  });
});
