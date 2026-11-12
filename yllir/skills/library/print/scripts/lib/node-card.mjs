// The Node card renderer: draws the finished card face (1500 x 2100 px, 5x7 inch at
// 300 dpi) as a PNG with the built-in pixel font. It draws the border, the title (wrapped,
// shrunk to two lines at most), the short text (wrapped, shrunk, cut with an ellipsis when it
// still does not fit) and the entry id. It draws no illustration: the JPEG illustration is
// used only by the vector sheets. The sheets step prints the vector card directly when no
// face image exists, so this renderer is the fallback for a face file.

import { PNG } from '../../vendor/print-libs.mjs';
import { glyphFor, GLYPH_WIDTH, GLYPH_HEIGHT } from './pixel-font.mjs';

export const FACE_WIDTH = 1500;
export const FACE_HEIGHT = 2100;
const MARGIN = 150;
const FRAME = 60;
const FRAME_THICKNESS = 22;
const INK = [24, 24, 24];
const PAPER = [255, 255, 255];

/** Width in pixels of a string at a scale (one pixel of the font = `scale` px). */
export function textWidth(text, scale) {
  const n = [...text].length;
  return n === 0 ? 0 : n * GLYPH_WIDTH * scale + (n - 1) * scale;
}

/** Wraps text to lines no wider than `maxWidth` pixels at `scale`; words longer than a line are split. */
export function wrapPixels(text, maxWidth, scale) {
  const lines = [];
  let current = '';
  const fits = (s) => textWidth(s, scale) <= maxWidth;
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current !== '') lines.push(current);
    current = '';
    let rest = word;
    while (!fits(rest) && [...rest].length > 1) {
      const chars = [...rest];
      let cut = chars.length - 1;
      while (cut > 1 && !fits(chars.slice(0, cut).join(''))) cut -= 1;
      lines.push(chars.slice(0, cut).join(''));
      rest = chars.slice(cut).join('');
    }
    current = rest;
  }
  if (current !== '') lines.push(current);
  return lines;
}

/** Fills a rectangle of the pixel buffer. */
function fillRect(png, x, y, w, h, colour) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(png.width, Math.floor(x + w));
  const y1 = Math.min(png.height, Math.floor(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * png.width + px) * 4;
      png.data[i] = colour[0];
      png.data[i + 1] = colour[1];
      png.data[i + 2] = colour[2];
      png.data[i + 3] = 255;
    }
  }
}

/** Draws one line of text with its top-left corner at (x, y). */
function drawLine(png, text, x, y, scale, colour) {
  let cx = x;
  for (const ch of text) {
    const rows = glyphFor(ch);
    for (let r = 0; r < GLYPH_HEIGHT; r++) {
      for (let c = 0; c < GLYPH_WIDTH; c++) {
        if (rows[r][c] === '1') fillRect(png, cx + c * scale, y + r * scale, scale, scale, colour);
      }
    }
    cx += (GLYPH_WIDTH + 1) * scale;
  }
}

/**
 * Chooses the largest scale at which the lines fit the box.
 * @returns {{ scale: number, lines: string[], truncated: boolean }}
 */
function fitBlock(text, maxWidth, maxHeight, scales, lineGap) {
  for (const scale of scales) {
    const lines = wrapPixels(text, maxWidth, scale);
    const height = lines.length * (GLYPH_HEIGHT * scale) + Math.max(0, lines.length - 1) * lineGap(scale);
    if (height <= maxHeight) return { scale, lines, truncated: false };
  }
  const scale = scales[scales.length - 1];
  const lines = wrapPixels(text, maxWidth, scale);
  const lineHeight = GLYPH_HEIGHT * scale + lineGap(scale);
  const fitting = Math.max(1, Math.floor((maxHeight + lineGap(scale)) / lineHeight));
  const kept = lines.slice(0, fitting);
  const last = kept[kept.length - 1] ?? '';
  kept[kept.length - 1] = `${last.replace(/[.,;:!?\s]+$/, '')}...`;
  while (kept.length > 1 && textWidth(kept[kept.length - 1], scale) > maxWidth) {
    kept[kept.length - 1] = kept[kept.length - 1].slice(0, -4).trimEnd();
  }
  return { scale, lines: kept, truncated: true };
}

/**
 * Renders the card face.
 * @param {{ id: string, title: string, text: string }} card public data only
 * @returns {{ png: Buffer, truncated: boolean }}
 */
export function renderCardPng(card) {
  const png = new PNG({ width: FACE_WIDTH, height: FACE_HEIGHT });
  fillRect(png, 0, 0, FACE_WIDTH, FACE_HEIGHT, PAPER);
  fillRect(png, FRAME, FRAME, FACE_WIDTH - 2 * FRAME, FRAME_THICKNESS, INK);
  fillRect(png, FRAME, FRAME + (FACE_HEIGHT - 2 * FRAME) - FRAME_THICKNESS, FACE_WIDTH - 2 * FRAME, FRAME_THICKNESS, INK);
  fillRect(png, FRAME, FRAME, FRAME_THICKNESS, FACE_HEIGHT - 2 * FRAME, INK);
  fillRect(png, FACE_WIDTH - FRAME - FRAME_THICKNESS, FRAME, FRAME_THICKNESS, FACE_HEIGHT - 2 * FRAME, INK);

  const contentWidth = FACE_WIDTH - 2 * MARGIN;
  const gap = (scale) => scale * 2;

  // Title: at most two lines, the largest scale that fits.
  const titleTop = 230;
  const titleBlock = fitBlock(card.title, contentWidth, 2 * GLYPH_HEIGHT * 14, [22, 20, 18, 16, 14, 12, 10, 8], gap);
  let y = titleTop;
  for (const line of titleBlock.lines) {
    const x = Math.round((FACE_WIDTH - textWidth(line, titleBlock.scale)) / 2);
    drawLine(png, line, x, y, titleBlock.scale, INK);
    y += GLYPH_HEIGHT * titleBlock.scale + gap(titleBlock.scale);
  }
  const ruleY = y + 20;
  fillRect(png, MARGIN, ruleY, contentWidth, 6, INK);

  // Short text: from below the rule to above the footer.
  const bodyTop = ruleY + 90;
  const footerTop = FACE_HEIGHT - FRAME - 150;
  const bodyHeight = footerTop - 60 - bodyTop;
  const bodyScales = [12, 11, 10, 9, 8, 7, 6];
  const body = card.text === ''
    ? { scale: 8, lines: [], truncated: false }
    : fitBlock(card.text.replace(/\n\n/g, '  '), contentWidth, bodyHeight, bodyScales, (scale) => scale * 4);
  y = bodyTop;
  for (const line of body.lines) {
    drawLine(png, line, MARGIN, y, body.scale, INK);
    y += GLYPH_HEIGHT * body.scale + body.scale * 4;
  }

  // Footer: the entry id.
  const footer = `ID ${card.id}`;
  const footerScale = 6;
  const footerLines = wrapPixels(footer, contentWidth, footerScale);
  drawLine(png, footerLines[0], Math.round((FACE_WIDTH - textWidth(footerLines[0], footerScale)) / 2), footerTop, footerScale, INK);

  return { png: PNG.sync.write(png), truncated: body.truncated || titleBlock.truncated };
}
