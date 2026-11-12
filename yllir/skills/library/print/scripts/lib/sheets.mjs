// Builds the printable PDF of the cards with pdf-lib. Every card has a front (title, framed
// illustration when a JPEG exists, short text, id) and a back (a large QR code to the
// encyclopedia entry, the short address and the id). A finished face image (`<base>.png`)
// replaces the vector front. All layout is in card units (360 x 504 points = 5 x 7 inch) and
// is scaled to the cell it is drawn in, so the 5x7 and A4 layouts share one design.
//
//   5x7: one card per page, each copy as a front page followed by its back page (duplex pairs).
//   a4:  four cards of 100 x 140 mm per page (2 x 2), crop marks at the outer corners and the
//        middle of each outer edge. The back page of each four-card sheet mirrors the columns,
//        so that a duplex print lines every back up with its front.
//
// Colour: RGB by default. With cmyk, the ink is black (K only) and the border is cyan (C only);
// embedded images are not converted and are reported with the warning `cmyk-images`.
// Deterministic: the same items and dates give the same bytes.

import { PDFDocument, StandardFonts, rgb, cmyk, QRCode } from '../../vendor/print-libs.mjs';

export const CARD_WIDTH = 360;
export const CARD_HEIGHT = 504;
const MM = 72 / 25.4;
export const A4_WIDTH = 210 * MM;
export const A4_HEIGHT = 297 * MM;
const CELL_WIDTH = 100 * MM;
const CELL_HEIGHT = 140 * MM;
const GRID_WIDTH = 2 * CELL_WIDTH;
const GRID_HEIGHT = 2 * CELL_HEIGHT;
const GRID_LEFT = (A4_WIDTH - GRID_WIDTH) / 2;
const GRID_BOTTOM = (A4_HEIGHT - GRID_HEIGHT) / 2;
const QR_QUIET_ZONE = 4;
const QR_SIZE = 230;
const LABELS = Object.freeze({
  en: { scan: 'Scan to read the entry' },
  it: { scan: 'Inquadra per leggere la voce' },
});
export const DEFAULT_CREATION_DATE = new Date('2026-11-12T00:00:00Z');

// Characters the standard fonts cannot draw are replaced by close ASCII forms.
const SUBSTITUTES = Object.freeze({
  '…': '...',
  '–': '-',
  '—': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '•': '-',
  ' ': ' ',
});

/**
 * Converts text to characters the standard PDF fonts (WinAnsi) can draw.
 * @param {string} value
 * @returns {string}
 */
export function pdfText(value) {
  let out = '';
  for (const ch of String(value).normalize('NFC')) {
    if (ch === '\n' || ch === '\r' || ch === '\t') {
      out += ' ';
      continue;
    }
    if (Object.hasOwn(SUBSTITUTES, ch)) {
      out += SUBSTITUTES[ch];
      continue;
    }
    const code = ch.codePointAt(0);
    const printable = (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || ch === '€';
    out += printable ? ch : '?';
  }
  return out;
}

/**
 * Wraps one paragraph to lines no wider than `width`, splitting words longer than a line.
 * @param {string} text
 * @param {number} width
 * @param {(s: string) => number} measure width of a string
 * @returns {string[]}
 */
export function wrapText(text, width, measure) {
  const lines = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (measure(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current !== '') lines.push(current);
    current = '';
    let rest = word;
    while (measure(rest) > width && [...rest].length > 1) {
      const chars = [...rest];
      let cut = chars.length - 1;
      while (cut > 1 && measure(chars.slice(0, cut).join('')) > width) cut -= 1;
      lines.push(chars.slice(0, cut).join(''));
      rest = chars.slice(cut).join('');
    }
    current = rest;
  }
  if (current !== '') lines.push(current);
  return lines;
}

/** Colours of the chosen mode. */
export function palette(useCmyk) {
  if (useCmyk) {
    return { ink: cmyk(0, 0, 0, 1), border: cmyk(1, 0, 0, 0) };
  }
  return { ink: rgb(0, 0, 0), border: rgb(0, 0.45, 0.7) };
}

/** Title at the largest size (30 down to 12) that wraps to two lines at most. */
export function fitTitle(title, font, width) {
  for (let size = 30; size >= 12; size -= 1) {
    const lines = wrapText(title, width, (s) => font.widthOfTextAtSize(s, size));
    if (lines.length <= 2) return { size, lines };
  }
  const lines = wrapText(title, width, (s) => font.widthOfTextAtSize(s, 12));
  return { size: 12, lines: lines.slice(0, 2), truncated: lines.length > 2 };
}

/**
 * Lays out the short text in the height left on the card, from 13 down to 7 points.
 * @returns {{ size: number, lines: Array<{ text: string, gap: number }>, truncated: boolean }}
 */
export function fitBody(text, font, width, height) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const layout = (size) => {
    const measure = (s) => font.widthOfTextAtSize(s, size);
    const lines = [];
    paragraphs.forEach((paragraph, index) => {
      const wrapped = wrapText(paragraph, width, measure);
      wrapped.forEach((line, n) => lines.push({ text: line, gap: n === 0 && index > 0 ? size * 0.5 : 0 }));
    });
    const total = lines.reduce((sum, line) => sum + size * 1.3 + line.gap, 0);
    return { lines, total };
  };
  for (let size = 13; size >= 7; size -= 0.5) {
    const { lines, total } = layout(size);
    if (total <= height) return { size, lines, truncated: false };
  }
  const size = 7;
  const { lines } = layout(size);
  const kept = [];
  let used = 0;
  for (const line of lines) {
    const need = size * 1.3 + line.gap;
    if (used + need > height) break;
    kept.push(line);
    used += need;
  }
  if (kept.length < lines.length && kept.length > 0) {
    const last = kept[kept.length - 1];
    kept[kept.length - 1] = { ...last, text: `${last.text.replace(/[.,;:!?\s]+$/, '')}...` };
  }
  return { size, lines: kept, truncated: true };
}

/** Draws a card front inside a box (points). The box keeps the 5x7 proportion. */
function drawFront(page, box, item, images, fonts, colours, warnings) {
  const scale = box.w / CARD_WIDTH;
  const X = (u) => box.x + u * scale;
  const Y = (v) => box.y + v * scale;
  const border = () => page.drawRectangle({
    x: X(10),
    y: Y(10),
    width: 340 * scale,
    height: 484 * scale,
    borderColor: colours.border,
    borderWidth: 3 * scale,
  });

  if (images.face) {
    page.drawImage(images.face, { x: box.x, y: box.y, width: box.w, height: box.h });
    return;
  }
  border();

  const titleWidth = 308;
  const title = fitTitle(pdfText(item.title), fonts.bold, titleWidth);
  if (title.truncated) warnings.push({ code: 'title-truncated', message: `the title of ${item.id} is cut to two lines` });
  let top = 470;
  for (const line of title.lines) {
    const width = fonts.bold.widthOfTextAtSize(line, title.size);
    page.drawText(line, {
      x: X(180 - width / 2),
      y: Y(top - title.size * 0.8),
      size: title.size * scale,
      font: fonts.bold,
      color: colours.ink,
    });
    top -= title.size * 1.15;
  }
  let cursor = top - 8;
  page.drawLine({
    start: { x: X(40), y: Y(cursor) },
    end: { x: X(320), y: Y(cursor) },
    thickness: 0.8 * scale,
    color: colours.ink,
  });
  cursor -= 12;

  if (images.illustration) {
    const frameHeight = 180;
    const frameTop = cursor;
    const frameBottom = frameTop - frameHeight;
    const frame = { x: X(40), y: Y(frameBottom), w: 280 * scale, h: frameHeight * scale };
    const picture = images.illustration;
    const fit = picture.scaleToFit(frame.w, frame.h);
    page.drawImage(picture, {
      x: frame.x + (frame.w - fit.width) / 2,
      y: frame.y + (frame.h - fit.height) / 2,
      width: fit.width,
      height: fit.height,
    });
    page.drawRectangle({ x: frame.x, y: frame.y, width: frame.w, height: frame.h, borderColor: colours.ink, borderWidth: 0.8 * scale });
    cursor = frameBottom - 14;
  }

  const bodyBottom = 52;
  const bodyHeight = cursor - bodyBottom;
  if (item.text !== '' && bodyHeight > 0) {
    const body = fitBody(pdfText(item.text), fonts.regular, 280, bodyHeight);
    if (body.truncated) warnings.push({ code: 'text-truncated', message: `the text of ${item.id} is cut to fit the card` });
    let y = cursor - body.size;
    for (const line of body.lines) {
      y -= line.gap;
      page.drawText(line.text, { x: X(40), y: Y(y), size: body.size * scale, font: fonts.regular, color: colours.ink });
      y -= body.size * 1.3;
    }
  }

  const footer = pdfText(`ID ${item.id}`);
  const footerWidth = fonts.regular.widthOfTextAtSize(footer, 8);
  page.drawText(footer, { x: X(180 - footerWidth / 2), y: Y(28), size: 8 * scale, font: fonts.regular, color: colours.ink });
}

/** Draws a card back: the QR code to the entry, the address and the id. */
function drawBack(page, box, item, fonts, colours, encyclopediaTitle, language) {
  const scale = box.w / CARD_WIDTH;
  const X = (u) => box.x + u * scale;
  const Y = (v) => box.y + v * scale;
  page.drawRectangle({
    x: X(10),
    y: Y(10),
    width: 340 * scale,
    height: 484 * scale,
    borderColor: colours.border,
    borderWidth: 3 * scale,
  });
  const labels = LABELS[language] ?? LABELS.en;
  if (encyclopediaTitle) {
    const width = fonts.bold.widthOfTextAtSize(pdfText(encyclopediaTitle), 14);
    page.drawText(pdfText(encyclopediaTitle), { x: X(180 - width / 2), y: Y(466), size: 14 * scale, font: fonts.bold, color: colours.ink });
  }
  const label = pdfText(labels.scan);
  const labelWidth = fonts.regular.widthOfTextAtSize(label, 12);
  page.drawText(label, { x: X(180 - labelWidth / 2), y: Y(440), size: 12 * scale, font: fonts.regular, color: colours.ink });

  const qr = QRCode.create(item.qrUrl, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = QR_SIZE / (n + 2 * QR_QUIET_ZONE);
  const qrLeft = 180 - QR_SIZE / 2;
  const qrBottom = 420 - QR_SIZE;
  // One path for all dark modules: separate rectangles show hairline seams in some viewers.
  let qrPath = '';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.modules.data[row * n + col]) qrPath += `M${col} ${row}h1v1h-1z`;
    }
  }
  page.drawSvgPath(qrPath, {
    x: X(qrLeft + QR_QUIET_ZONE * cell),
    y: Y(qrBottom + QR_SIZE - QR_QUIET_ZONE * cell),
    scale: cell * scale,
    color: colours.ink,
  });

  const url = pdfText(item.qrUrl);
  const lines = wrapText(url, 308, (s) => fonts.regular.widthOfTextAtSize(s, 9));
  let y = 178;
  for (const line of lines.slice(0, 2)) {
    const width = fonts.regular.widthOfTextAtSize(line, 9);
    page.drawText(line, { x: X(180 - width / 2), y: Y(y), size: 9 * scale, font: fonts.regular, color: colours.ink });
    y -= 13;
  }
  const idText = pdfText(`ID ${item.id}`);
  const idWidth = fonts.regular.widthOfTextAtSize(idText, 10);
  page.drawText(idText, { x: X(180 - idWidth / 2), y: Y(y - 6), size: 10 * scale, font: fonts.regular, color: colours.ink });
}

/** Crop marks of the A4 sheet: an L at each outer corner and a tick at the middle of each outer edge. */
function drawCropMarks(page, colour) {
  const left = GRID_LEFT;
  const right = GRID_LEFT + GRID_WIDTH;
  const bottom = GRID_BOTTOM;
  const top = GRID_BOTTOM + GRID_HEIGHT;
  const gap = 3;
  const length = 10;
  const line = (x1, y1, x2, y2) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.25, color: colour });
  for (const [x, y, sx, sy] of [[left, top, -1, 1], [right, top, 1, 1], [left, bottom, -1, -1], [right, bottom, 1, -1]]) {
    line(x + sx * gap, y, x + sx * (gap + length), y);
    line(x, y + sy * gap, x, y + sy * (gap + length));
  }
  const midX = GRID_LEFT + CELL_WIDTH;
  const midY = GRID_BOTTOM + CELL_HEIGHT;
  line(midX, top + gap, midX, top + gap + length);
  line(midX, bottom - gap, midX, bottom - gap - length);
  line(left - gap, midY, left - gap - length, midY);
  line(right + gap, midY, right + gap + length, midY);
}

/** Box of a cell of the A4 grid: column 0 or 1, row 0 (top) or 1 (bottom). */
export function cellBox(column, row) {
  return {
    x: GRID_LEFT + column * CELL_WIDTH,
    y: GRID_BOTTOM + (1 - row) * CELL_HEIGHT,
    w: CELL_WIDTH,
    h: CELL_HEIGHT,
  };
}

const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/**
 * Builds the sheets PDF.
 * @param {object} input
 * @param {Array<{ id: string, title: string, text: string, qrUrl: string,
 *   face: Uint8Array|null, illustration: Uint8Array|null, copies: number }>} input.items
 * @param {'5x7'|'a4'} input.format
 * @param {boolean} input.cmyk
 * @param {string|null} input.encyclopediaTitle shown on the backs when set
 * @param {string} input.language 'en' or 'it' (labels of the backs)
 * @param {Date} input.creationDate fixed date of the document
 * @returns {Promise<{ bytes: Uint8Array, pages: number, index: object[], warnings: object[] }>}
 */
export async function buildSheetsPdf({ items, format, cmyk: useCmyk, encyclopediaTitle, language, creationDate }) {
  const doc = await PDFDocument.create();
  doc.setTitle('Yllir print sheets');
  doc.setProducer('yllir');
  doc.setCreator('yllir');
  doc.setCreationDate(creationDate);
  doc.setModificationDate(creationDate);
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const colours = palette(useCmyk);
  const warnings = [];
  const index = [];

  const embedded = new Map();
  let imageEmbedded = false;
  const imagesOf = async (item) => {
    if (!embedded.has(item.id)) {
      const face = item.face ? await doc.embedPng(item.face) : null;
      const illustration = item.illustration ? await doc.embedJpg(item.illustration) : null;
      if (face || illustration) imageEmbedded = true;
      embedded.set(item.id, { face, illustration });
    }
    return embedded.get(item.id);
  };

  const entries = [];
  for (const item of items) {
    for (let copy = 1; copy <= item.copies; copy++) entries.push({ item, copy });
  }

  if (format === '5x7') {
    const box = { x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT };
    for (const { item, copy } of entries) {
      const images = await imagesOf(item);
      const front = doc.addPage([CARD_WIDTH, CARD_HEIGHT]);
      drawFront(front, box, item, images, fonts, colours, warnings);
      index.push({ id: item.id, copy, page: doc.getPageCount(), side: 'front', position: null, qr: null });
      const back = doc.addPage([CARD_WIDTH, CARD_HEIGHT]);
      drawBack(back, box, item, fonts, colours, encyclopediaTitle, language);
      index.push({ id: item.id, copy, page: doc.getPageCount(), side: 'back', position: null, qr: item.qrUrl });
    }
  } else {
    for (let start = 0; start < entries.length; start += 4) {
      const chunk = entries.slice(start, start + 4);
      const front = doc.addPage([A4_WIDTH, A4_HEIGHT]);
      const frontPage = doc.getPageCount();
      for (let k = 0; k < chunk.length; k++) {
        const { item, copy } = chunk[k];
        const column = k % 2;
        const row = Math.floor(k / 2);
        drawFront(front, cellBox(column, row), item, await imagesOf(item), fonts, colours, warnings);
        index.push({ id: item.id, copy, page: frontPage, side: 'front', position: POSITIONS[k], qr: null });
      }
      drawCropMarks(front, colours.ink);

      const back = doc.addPage([A4_WIDTH, A4_HEIGHT]);
      const backPage = doc.getPageCount();
      for (let k = 0; k < chunk.length; k++) {
        const { item, copy } = chunk[k];
        const column = k % 2;
        const row = Math.floor(k / 2);
        const mirrored = 1 - column;
        drawBack(back, cellBox(mirrored, row), item, fonts, colours, encyclopediaTitle, language);
        index.push({ id: item.id, copy, page: backPage, side: 'back', position: POSITIONS[row * 2 + mirrored], qr: item.qrUrl });
      }
      drawCropMarks(back, colours.ink);
    }
  }

  if (useCmyk && imageEmbedded) {
    warnings.push({ code: 'cmyk-images', message: 'images are embedded as they are; only the text and borders are converted to CMYK' });
  }
  const bytes = await doc.save();
  return { bytes, pages: doc.getPageCount(), index, warnings };
}
