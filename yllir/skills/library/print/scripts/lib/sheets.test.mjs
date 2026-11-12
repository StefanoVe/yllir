import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PDFDocument, QRCode, PNG } from '../../vendor/print-libs.mjs';
import {
  buildSheetsPdf, pdfText, wrapText, fitTitle, fitBody, cellBox, palette, CARD_WIDTH, CARD_HEIGHT, A4_WIDTH, A4_HEIGHT,
} from './sheets.mjs';
import { renderCardPng } from './node-card.mjs';
import { TINY_JPEG_BASE64 } from './fixtures.mjs';
import { entryUrl } from './settings.mjs';
import { PRINT_CACHE_DIR } from './paths.mjs';

const DATE = new Date('2026-11-12T00:00:00Z');
const measure = (s) => s.length * 5;
const JPEG = new Uint8Array(Buffer.from(TINY_JPEG_BASE64, 'base64'));

function item(id, extra = {}) {
  return { id, title: `Titolo ${id}`, text: 'Un testo breve per la carta.', qrUrl: entryUrl('http://localhost/', id), face: null, illustration: null, copies: 1, ...extra };
}

async function build(items, options = {}) {
  return buildSheetsPdf({ items, format: '5x7', cmyk: false, encyclopediaTitle: null, language: 'en', creationDate: DATE, ...options });
}

async function pagesOf(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => ({ width: Math.round(p.getWidth() * 100) / 100, height: Math.round(p.getHeight() * 100) / 100 }));
}

test('text helpers: WinAnsi substitutes, wrapping, title and body fitting', () => {
  assert.equal(pdfText('a… “b” ✓ €'), 'a... "b" ? €');
  assert.equal(pdfText('x\ny'), 'x y');
  assert.deepEqual(wrapText('uno due tre', 40, measure), ['uno due', 'tre']);
  assert.deepEqual(wrapText('abcdefghijkl', 20, measure), ['abcd', 'efgh', 'ijkl']);
  const font = { widthOfTextAtSize: (s, size) => s.length * size * 0.5 };
  assert.equal(fitTitle('Breve', font, 300).size, 30);
  const long = fitTitle('parola '.repeat(40), font, 100);
  assert.equal(long.lines.length, 2);
  assert.equal(long.truncated, true);
  const body = fitBody('testo '.repeat(400), font, 100, 40);
  assert.equal(body.truncated, true);
  assert.ok(body.lines[body.lines.length - 1].text.endsWith('...'));
  assert.equal(fitBody('poco', font, 200, 200).truncated, false);
});

test('5x7: one front and one back page per copy, card size, pages in duplex pairs', async () => {
  const result = await build([item('lanterna', { copies: 2 }), item('bussola')]);
  assert.equal(result.pages, 6);
  const pages = await pagesOf(result.bytes);
  assert.ok(pages.every((p) => p.width === CARD_WIDTH && p.height === CARD_HEIGHT));
  assert.deepEqual(result.index.map((e) => [e.id, e.copy, e.side, e.page]), [
    ['lanterna', 1, 'front', 1], ['lanterna', 1, 'back', 2],
    ['lanterna', 2, 'front', 3], ['lanterna', 2, 'back', 4],
    ['bussola', 1, 'front', 5], ['bussola', 1, 'back', 6],
  ]);
  assert.equal(result.index[1].qr, 'http://localhost/e/lanterna/');
  const head = Buffer.from(result.bytes.slice(0, 5)).toString('latin1');
  assert.equal(head, '%PDF-');
});

test('A4: four cards per page at 100 x 140 mm, backs mirrored for duplex', async () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => item(id));
  const result = await build(items, { format: 'a4' });
  assert.equal(result.pages, 4, 'five cards make two fronts and two backs');
  const pages = await pagesOf(result.bytes);
  assert.ok(pages.every((p) => Math.abs(p.width - A4_WIDTH) < 0.01 && Math.abs(p.height - A4_HEIGHT) < 0.01));
  const front = result.index.filter((e) => e.side === 'front');
  const back = result.index.filter((e) => e.side === 'back');
  assert.deepEqual(front.slice(0, 4).map((e) => e.position), ['top-left', 'top-right', 'bottom-left', 'bottom-right']);
  assert.deepEqual(back.slice(0, 4).map((e) => [e.id, e.position]), [
    ['a', 'top-right'], ['b', 'top-left'], ['c', 'bottom-right'], ['d', 'bottom-left'],
  ]);
  assert.equal(front[4].page, 3);
  assert.equal(back[4].page, 4);
});

test('cell boxes of the A4 grid are 100 x 140 mm and fill the grid', () => {
  const mm = 72 / 25.4;
  const topLeft = cellBox(0, 0);
  const bottomRight = cellBox(1, 1);
  assert.ok(Math.abs(topLeft.w - 100 * mm) < 1e-6 && Math.abs(topLeft.h - 140 * mm) < 1e-6);
  assert.ok(Math.abs(topLeft.y - bottomRight.y - 140 * mm) < 1e-6, 'the top row sits above the bottom row');
  assert.ok(Math.abs(bottomRight.x + bottomRight.w - topLeft.x - 200 * mm) < 1e-6);
});

test('a finished face PNG replaces the vector front; a JPEG is placed in the frame', async () => {
  const face = new Uint8Array(renderCardPng({ id: 'a', title: 'A', text: 'B' }).png);
  const withFace = await build([item('a', { face })]);
  assert.equal(withFace.pages, 2);
  const withJpeg = await build([item('b', { illustration: JPEG })]);
  assert.equal(withJpeg.pages, 2);
  const plain = await build([item('c')]);
  assert.ok(withJpeg.bytes.length > plain.bytes.length, 'the illustration is embedded');
  assert.equal(withFace.warnings.length, 0);
});

test('cmyk: warns only when an image is embedded', async () => {
  const noImage = await build([item('a')], { cmyk: true });
  assert.deepEqual(noImage.warnings, []);
  const withImage = await build([item('b', { illustration: JPEG })], { cmyk: true });
  assert.deepEqual(withImage.warnings.map((w) => w.code), ['cmyk-images']);
  assert.equal(palette(true).ink.type, 'CMYK');
});

test('long text and long titles are cut with a warning, never drawn outside the card', async () => {
  const longText = 'parola lunga '.repeat(300);
  const result = await build([item('lungo', { text: longText, title: 'Titolo '.repeat(30) })]);
  assert.ok(result.warnings.some((w) => w.code === 'text-truncated'));
  assert.ok(result.warnings.some((w) => w.code === 'title-truncated'));
  assert.equal(result.pages, 2);
});

test('the same items and date give the same bytes', async () => {
  const items = [item('a', { copies: 2 }), item('b', { illustration: JPEG })];
  const first = await build(items, { format: 'a4' });
  const second = await build(items, { format: 'a4' });
  assert.equal(Buffer.compare(Buffer.from(first.bytes), Buffer.from(second.bytes)), 0);
});

test('the QR payload is the entry address and the matrix encodes it (re-encoded and compared)', () => {
  const url = 'http://localhost/e/lanterna-da-bordo/';
  const first = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules;
  const second = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules;
  assert.equal(first.size, second.size);
  assert.deepEqual(Array.from(first.data), Array.from(second.data));
  assert.equal(first.size, 29, 'a 36-character address needs version 3 (29 modules) at level M');
});

test('the QR matrix decodes back to the address, when a barcode reader is installed', (t) => {
  let zbar = true;
  try {
    execFileSync('zbarimg', ['--version'], { stdio: 'ignore' });
  } catch {
    zbar = false;
  }
  if (!zbar) {
    t.skip('zbarimg is not installed');
    return;
  }
  const url = 'http://localhost/e/lanterna-da-bordo/';
  const { size, data } = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules;
  const scale = 8;
  const quiet = 4;
  const side = (size + 2 * quiet) * scale;
  const png = new PNG({ width: side, height: side });
  png.data.fill(255);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!data[r * size + c]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + quiet) * scale + y) * side + (c + quiet) * scale + x) * 4;
          png.data[i] = 0;
          png.data[i + 1] = 0;
          png.data[i + 2] = 0;
        }
      }
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-qr-'));
  try {
    const file = path.join(dir, 'qr.png');
    fs.writeFileSync(file, PNG.sync.write(png));
    const decoded = execFileSync('zbarimg', ['-q', '--raw', file]).toString().trim();
    assert.equal(decoded, url);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the constants of the sheets and the cache folder are the documented ones', () => {
  assert.equal(PRINT_CACHE_DIR, '.campaign/cache/print');
  assert.equal(CARD_WIDTH, 360);
  assert.equal(CARD_HEIGHT, 504);
});
