// Preview of the atlas as a PNG: a plain, deterministic drawing of the layers, for the agent to
// read coordinates and check the shape before the master approves a layer. Not the final map.

import { encodePng } from '../../../../../scripts/lib/png.mjs';
import { isFinitePoint, isUsablePolygon } from './geometry.mjs';

const COLOURS = {
  sea: '#7fa7c9',
  land: '#e8dcb5',
  lake: '#7fa7c9',
  relief: '#a08c6a',
  forest: '#7d9a62',
  biome: '#c9b98a',
  coast: '#3b3226',
  river: '#4a77a8',
  place: '#222222',
  road: '#7a5230',
  seaRoute: '#2c4a6b',
};

function rgbOf(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const COLOUR_RGB = Object.fromEntries(Object.entries(COLOURS).map(([k, v]) => [k, rgbOf(v)]));

function boundingBox(polygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Renders the atlas layers to a PNG.
 * @param {{ canvas: { width: number, height: number }, layers?: Record<string, { features?: object[] }>, width?: number }} input
 * @returns {Buffer}
 */
export function renderPreview({ canvas, layers = {}, width = 1024 }) {
  const scale = width / canvas.width;
  const w = width;
  const h = Math.max(1, Math.round(canvas.height * scale));
  const rgb = new Uint8Array(w * h * 3);
  const land = new Uint8Array(w * h);
  const features = (name) => (Array.isArray(layers[name]?.features) ? layers[name].features : []).filter((f) => f && typeof f === 'object');

  const setPixel = (index, colour, isLand) => {
    rgb[index * 3] = colour[0];
    rgb[index * 3 + 1] = colour[1];
    rgb[index * 3 + 2] = colour[2];
    land[index] = isLand ? 1 : 0;
  };

  const paint = (polygon, colour, isLand) => {
    if (!isUsablePolygon(polygon)) return;
    const box = boundingBox(polygon);
    const x0 = Math.max(0, Math.floor(box.minX * scale));
    const x1 = Math.min(w - 1, Math.ceil(box.maxX * scale));
    const y0 = Math.max(0, Math.floor(box.minY * scale));
    const y1 = Math.min(h - 1, Math.ceil(box.maxY * scale));
    // Scanline: for each pixel row, the edge crossings give the spans of pixels whose centre is inside.
    for (let py = y0; py <= y1; py++) {
      const y = (py + 0.5) / scale;
      const crossings = [];
      for (let k = 0; k < polygon.length; k++) {
        const [ax, ay] = polygon[k];
        const [bx, by] = polygon[(k + 1) % polygon.length];
        if ((ay > y) !== (by > y)) crossings.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
      crossings.sort((a, b) => a - b);
      for (let c = 0; c + 1 < crossings.length; c += 2) {
        const from = Math.max(x0, Math.ceil(crossings[c] * scale - 0.5));
        const to = Math.min(x1, Math.floor(crossings[c + 1] * scale - 0.5));
        for (let px = from; px <= to; px++) setPixel(py * w + px, colour, isLand);
      }
    }
  };

  // Sea background.
  for (let index = 0; index < w * h; index++) setPixel(index, COLOUR_RGB.sea, false);

  // Drawing order: terrain land, biomes, relief, terrain lakes, water lakes.
  for (const f of features('terrain')) if (f.type === 'land') paint(f.polygon, COLOUR_RGB.land, true);
  for (const f of features('biomes')) paint(f.polygon, COLOUR_RGB[f.type === 'forest' ? 'forest' : 'biome'], true);
  for (const f of features('relief')) paint(f.polygon, COLOUR_RGB.relief, true);
  for (const f of features('terrain')) if (f.type === 'lake') paint(f.polygon, COLOUR_RGB.lake, false);
  for (const f of features('water')) if (f.type === 'lake') paint(f.polygon, COLOUR_RGB.lake, false);

  // Coast: a land pixel with a sea neighbour. Found first, so painting does not cascade.
  const coast = [];
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const index = py * w + px;
      if (land[index] !== 1) continue;
      const neighbours = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
      if (neighbours.some(([nx, ny]) => nx < 0 || ny < 0 || nx >= w || ny >= h || land[ny * w + nx] === 0)) {
        coast.push(index);
      }
    }
  }
  for (const index of coast) setPixel(index, COLOUR_RGB.coast, true);

  // Rivers: two pixels wide.
  for (const f of features('water')) {
    if (f.type !== 'river' || !Array.isArray(f.path)) continue;
    for (let k = 0; k + 1 < f.path.length; k++) {
      const [a, b] = [f.path[k], f.path[k + 1]];
      if (!isFinitePoint(a) || !isFinitePoint(b)) continue;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * scale;
      const steps = Math.max(1, Math.ceil(length * 2));
      for (let s = 0; s <= steps; s++) {
        const x = (a[0] + ((b[0] - a[0]) * s) / steps) * scale;
        const y = (a[1] + ((b[1] - a[1]) * s) / steps) * scale;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const px = Math.floor(x) + dx;
          const py = Math.floor(y) + dy;
          if (px >= 0 && py >= 0 && px < w && py < h) setPixel(py * w + px, COLOUR_RGB.river, land[py * w + px] === 1);
        }
      }
    }
  }

  // Places: a 5x5 dark square.
  for (const f of features('places')) {
    if (!isFinitePoint(f.at)) continue;
    const cx = Math.round(f.at[0] * scale);
    const cy = Math.round(f.at[1] * scale);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && py >= 0 && px < w && py < h) setPixel(py * w + px, COLOUR_RGB.place, land[py * w + px] === 1);
      }
    }
  }

  // Realm borders: the boundary pixels of each realm, in its colour, two pixels wide.
  const HEX = /^#[0-9a-f]{6}$/i;
  const stroke = (points, width, colour, dotted = false) => {
    let travelled = 0;
    for (let k = 0; k + 1 < points.length; k++) {
      const [a, b] = [points[k], points[k + 1]];
      if (!isFinitePoint(a) || !isFinitePoint(b)) continue;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * scale;
      const steps = Math.max(1, Math.ceil(length * 2));
      for (let s = 0; s <= steps; s++) {
        const along = travelled + (length * s) / steps;
        // Dotted: four pixels on, four off.
        if (dotted && Math.floor(along / 4) % 2 === 1) continue;
        const x = (a[0] + ((b[0] - a[0]) * s) / steps) * scale;
        const y = (a[1] + ((b[1] - a[1]) * s) / steps) * scale;
        const size = width === 2 ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]];
        for (const [dx, dy] of size) {
          const px = Math.floor(x) + dx;
          const py = Math.floor(y) + dy;
          if (px >= 0 && py >= 0 && px < w && py < h) setPixel(py * w + px, colour, land[py * w + px] === 1);
        }
      }
      travelled += length;
    }
  };
  for (const f of features('political')) {
    if (f.type !== 'realm' || typeof f.color !== 'string' || !HEX.test(f.color)) continue;
    const colour = rgbOf(f.color);
    const polygons = Array.isArray(f.polygons) ? f.polygons : [f.polygon];
    for (const polygon of polygons) {
      if (!isUsablePolygon(polygon)) continue;
      stroke([...polygon, polygon[0]], 2, colour);
    }
  }

  // Routes: roads and trails on land, sea routes dotted on the sea.
  for (const f of features('routes')) {
    if (!Array.isArray(f.path)) continue;
    if (f.type === 'road') stroke(f.path, 2, COLOUR_RGB.road);
    else if (f.type === 'trail') stroke(f.path, 1, COLOUR_RGB.road);
    else if (f.type === 'sea-route') stroke(f.path, 1, COLOUR_RGB.seaRoute, true);
  }

  // Coordinate grid: every tenth of the width, white at 50 percent over the colour.
  const step = canvas.width / 10;
  const blend = (index) => {
    for (let c = 0; c < 3; c++) rgb[index * 3 + c] = (rgb[index * 3 + c] + 255) >> 1;
  };
  for (let x = step; x < canvas.width; x += step) {
    const px = Math.min(w - 1, Math.round(x * scale));
    for (let py = 0; py < h; py++) blend(py * w + px);
  }
  for (let y = step; y < canvas.height; y += step) {
    const py = Math.min(h - 1, Math.round(y * scale));
    for (let px = 0; px < w; px++) blend(py * w + px);
  }

  return encodePng(w, h, rgb);
}
