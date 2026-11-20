// Procedural pictures for the atlas testbench. A sea, a green island with an irregular coast and, on
// Morvalle, a blue lake and a second small island. Everything is drawn from formulas, so the same bytes
// come out on every run. writeFakeCodex writes an executable stand-in for the Codex CLI: it answers
// --version and, for an exec job, copies one fixed picture to the path the job asks for, so no case ever
// calls a real image provider.

import fs from 'node:fs';
import path from 'node:path';
import { encodePngRgba, newImage } from '../../../yllir/skills/library/atlas/scripts/lib/image.mjs';

export const SEA = [0x1c, 0x3a, 0x4a, 255];
export const GREEN = [0x4f, 0x7a, 0x3a, 255];
export const LAKE = [0x2e, 0x5a, 0x78, 255];

export const MORVALLE_SIZE = { width: 400, height: 300 };
export const TOWN_SIZE = { width: 360, height: 300 };

const MORVALLE_SHAPES = [
  { shape: { cx: 200, cy: 150, rx: 150, ry: 110 }, color: GREEN, irregular: true },
  { shape: { cx: 205, cy: 135, rx: 35, ry: 20 }, color: LAKE, irregular: false },
  { shape: { cx: 330, cy: 250, rx: 18, ry: 12 }, color: GREEN, irregular: false },
];
const TOWN_SHAPES = [
  { shape: { cx: 180, cy: 150, rx: 140, ry: 110 }, color: GREEN, irregular: true },
];

/** The coast: the outline's radius at the angle theta, a few percent around 1. */
export function coastRadius(theta) {
  return 1 + 0.06 * Math.sin(3 * theta) + 0.04 * Math.cos(5 * theta) + 0.02 * Math.sin(9 * theta + 0.5);
}

function insideShape(x, y, { shape, irregular }) {
  const dx = (x + 0.5 - shape.cx) / shape.rx;
  const dy = (y + 0.5 - shape.cy) / shape.ry;
  const d = Math.hypot(dx, dy);
  if (!irregular) return d <= 1;
  return d <= coastRadius(Math.atan2(dy, dx));
}

/** Sea everywhere, then each shape in order: a later shape paints over an earlier one. */
function paintPicture({ width, height }, shapes) {
  const image = newImage(width, height, SEA);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (const item of shapes) {
        if (!insideShape(x, y, item)) continue;
        const p = (y * width + x) * 4;
        image.data[p] = item.color[0];
        image.data[p + 1] = item.color[1];
        image.data[p + 2] = item.color[2];
        image.data[p + 3] = 255;
      }
    }
  }
  return image;
}

/** The Morvalle picture: 400 by 300, a green island with a lake and a second small island. */
export function makeMorvallePicture() {
  return paintPicture(MORVALLE_SIZE, MORVALLE_SHAPES);
}

/** The town picture: 360 by 300, a sea with one green island. */
export function makeTownPicture() {
  return paintPicture(TOWN_SIZE, TOWN_SHAPES);
}

/** Writes morvalle.png and town.png into dir (created when missing). Returns their absolute paths. */
export function writePictures(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const morvalle = path.join(dir, 'morvalle.png');
  const town = path.join(dir, 'town.png');
  fs.writeFileSync(morvalle, encodePngRgba(makeMorvallePicture()));
  fs.writeFileSync(town, encodePngRgba(makeTownPicture()));
  return { morvalle, town };
}

/**
 * Writes an executable `codex` script into dir. It answers `--version` with exit 0. For `exec`, it finds
 * the path named in the instruction («Save the final image as a PNG file at exactly this path: <path>.»)
 * and copies pngPath there; without that phrase it writes result.png in the folder of -C. Written as
 * CommonJS so it runs without a package.json beside it. Returns the script path.
 */
export function writeFakeCodex(dir, pngPath) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'codex');
  const source = `#!/usr/bin/env node
// Fake Codex CLI for the atlas testbench: it never calls an image service.
const fs = require('node:fs');
const path = require('node:path');
const PICTURE = ${JSON.stringify(path.resolve(pngPath))};
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('fake-codex 0.0.0');
  process.exit(0);
}
if (args[0] !== 'exec') {
  console.error('fake-codex: only exec and --version are supported');
  process.exit(2);
}
const at = args.indexOf('-C');
const jobDir = at >= 0 ? args[at + 1] : process.cwd();
const instruction = args[args.length - 1] || '';
const match = /exactly this path: (.+?)\\. If the tool/.exec(instruction);
const out = match ? match[1] : path.join(jobDir, 'result.png');
fs.copyFileSync(PICTURE, out);
console.log('fake-codex: picture written');
process.exit(0);
`;
  fs.writeFileSync(file, source);
  fs.chmodSync(file, 0o755);
  return file;
}
