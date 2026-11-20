// File-level operations of the atlas CLI: zoomed views of the base for the assistant and for the
// image providers, candidate composition, verification and acceptance of a candidate, and the
// rebuild of the land mask. Every export takes plain arguments and returns a result object.
// Expected failures return { ok: false, code, message } and never throw.
//
// Boxes are { x0, y0, x1, y1 } in canvas pixels, x1 and y1 exclusive, inside the canvas and at
// least 16 x 16. Work files go to <root>/.campaign/cache/atlas/work/ unless an output path is given.

import fs from 'node:fs';
import path from 'node:path';
import { readAtlas, writeJson } from './model.mjs';
import {
  cropImage, resizeImage, pasteImage, drawGrid, matchColors, sha256Of,
  imageFromFile, writePngFile, newImage,
} from './image.mjs';
import {
  newMask, cropMask, featherMask, landMaskFromImage, seaColorFromBorder, maskToImage,
  imageToMask, diffMasks, countOnes, waterColorsFromPoints,
} from './mask.mjs';
import { checkLandChange } from './lock.mjs';

/** Longer side, in pixels, of the pictures the assistant and the providers see. */
const MAX_SIDE = 1100;
const MIN_BOX = 16;
/** Grid lines are about this far apart, in canvas pixels, rounded to 10. */
const GRID_CANVAS_STEP = Math.round(50 / 10) * 10;
const GRID_MAX_SCALE = 4;
const DEFAULT_TOLERANCE = 40;
const DEFAULT_WATER_TOLERANCE = 30;
/** A difference block smaller than this is noise (same threshold as the verify report). */
const MIN_BLOCK = 30;
/** Width, in pixels, of the before | after | diff strip. */
const MAX_STRIP = 1600;
const STRIP_GAP = 4;
const STRIP_BG = [24, 24, 24, 255];
const LAND_THRESHOLD = 128;
const LAND_FEATHER = 2;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function fail(code, message) {
  return { ok: false, code, message };
}

/** The work folder of the candidates, created when needed. */
function workDir(root) {
  const dir = path.join(root, '.campaign', 'cache', 'atlas', 'work');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function outFile(root, outPath, name) {
  return outPath ? path.resolve(outPath) : path.join(workDir(root), name);
}

/** null when the box is valid, else a bad-box failure. */
function checkBox(box, width, height) {
  if (!isPlainObject(box)) return fail('bad-box', 'the box needs x0, y0, x1 and y1');
  const { x0, y0, x1, y1 } = box;
  if (![x0, y0, x1, y1].every(Number.isInteger)) return fail('bad-box', 'the box coordinates must be whole pixels');
  if (x0 < 0 || y0 < 0 || x1 > width || y1 > height) {
    return fail('bad-box', `the box must lie inside the ${width}x${height} canvas`);
  }
  if (x1 - x0 < MIN_BOX || y1 - y0 < MIN_BOX) return fail('bad-box', `the box must be at least ${MIN_BOX}x${MIN_BOX} pixels`);
  return null;
}

function boxSize(box) {
  return { w: box.x1 - box.x0, h: box.y1 - box.y0 };
}

function isInside(inner, outer) {
  return inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1;
}

function parseHex(value) {
  if (typeof value !== 'string') return null;
  const match = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb) {
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function cropBox(image, box) {
  return cropImage(image, box.x0, box.y0, box.x1, box.y1);
}

function cropBoxMask(mask, box) {
  return cropMask(mask, box.x0, box.y0, box.x1, box.y1);
}

/** Integer factor that brings the longer side of the view to about MAX_SIDE, from 1 to 4. */
function gridScale(longer) {
  return Math.min(GRID_MAX_SCALE, Math.max(1, Math.round(MAX_SIDE / longer)));
}

/** Largest factor 3 or 2 whose longer side stays within MAX_SIDE; 1 when even 2 is too large. */
function providerScale(longer) {
  for (const scale of [3, 2]) if (longer * scale <= MAX_SIDE) return scale;
  return 1;
}

/** The extra water colours stored in land.sea.waters, as { color: [r, g, b], tolerance } entries. */
function waterSpecs(sea) {
  if (!Array.isArray(sea?.waters)) return [];
  const out = [];
  for (const entry of sea.waters) {
    const color = parseHex(entry?.color);
    if (color) out.push({ color, tolerance: Number.isFinite(entry.tolerance) ? entry.tolerance : DEFAULT_WATER_TOLERANCE });
  }
  return out;
}

/** Sea colour, tolerance and extra waters of the atlas, or the sea estimated from the base when absent. */
function seaSpec(atlas, image) {
  const sea = atlas?.land?.sea;
  const color = parseHex(sea?.color) ?? seaColorFromBorder(image).color;
  const tolerance = Number.isInteger(sea?.tolerance) ? sea.tolerance : DEFAULT_TOLERANCE;
  return { color, tolerance, waters: waterSpecs(sea) };
}

function fileName(entry, fallback) {
  return typeof entry?.file === 'string' && entry.file !== '' ? path.basename(entry.file) : fallback;
}

/** The atlas folder and its files, without reading any picture. */
function readAtlasState(root) {
  const { dir, manifest, errors } = readAtlas(root);
  if (dir === null) return fail('no-atlas', 'the campaign declares no atlas folder');
  if (manifest === undefined) {
    if (errors.length > 0) return fail('bad-json', errors[0].message);
    return fail('no-atlas', 'atlas.json is missing');
  }
  if (!isPlainObject(manifest)) return fail('bad-json', 'atlas.json must hold an object');
  return {
    ok: true,
    dir,
    atlas: manifest,
    basePath: path.join(dir, fileName(manifest.base, 'base.png')),
    landPath: path.join(dir, fileName(manifest.land, 'land.png')),
    atlasPath: path.join(dir, 'atlas.json'),
  };
}

function readImage(file) {
  try {
    return { image: imageFromFile(file) };
  } catch (err) {
    return { error: fail('bad-image', `${path.basename(file)} cannot be read as a PNG: ${err.message}`) };
  }
}

/**
 * Reads the base picture and the land mask of the atlas.
 * @returns {{ ok: true, atlas: object, dir: string, base: object, land: object|null, basePath: string, landPath: string } | { ok: false, code: string, message: string }}
 */
export function loadBase(root) {
  const state = readAtlasState(root);
  if (!state.ok) return state;
  if (!fs.existsSync(state.basePath)) return fail('no-base', 'the atlas has no base picture yet');
  const baseRead = readImage(state.basePath);
  if (baseRead.error) return baseRead.error;
  const base = baseRead.image;
  let land = null;
  if (fs.existsSync(state.landPath)) {
    const landRead = readImage(state.landPath);
    if (landRead.error) return landRead.error;
    if (landRead.image.width !== base.width || landRead.image.height !== base.height) {
      return fail('size-mismatch', 'land.png and base.png differ in size');
    }
    land = imageToMask(landRead.image, LAND_THRESHOLD);
  }
  return { ok: true, atlas: state.atlas, dir: state.dir, base, land, basePath: state.basePath, landPath: state.landPath };
}

/**
 * A zoomed view of a box of the base with a coordinate grid, for the assistant. Labels show canvas
 * coordinates.
 * @returns {{ ok: true, scale: number, size: number[], out: string } | { ok: false, code: string, message: string }}
 */
export function gridView(root, box, outPath) {
  const loaded = loadBase(root);
  if (!loaded.ok) return loaded;
  const { base } = loaded;
  const bad = checkBox(box, base.width, base.height);
  if (bad) return bad;
  const { w, h } = boxSize(box);
  const scale = gridScale(Math.max(w, h));
  const view = resizeImage(cropBox(base, box), w * scale, h * scale, 'bilinear');
  drawGrid(view, {
    step: GRID_CANVAS_STEP * scale,
    originX: box.x0,
    originY: box.y0,
    unitsPerPixel: 1 / scale,
  });
  const out = outFile(root, outPath, 'grid.png');
  writePngFile(out, view);
  return { ok: true, scale, size: [view.width, view.height], out };
}

/**
 * The crop of a box for an image provider: scaled by 3 or 2, without a grid.
 * @returns {{ ok: true, scale: number, size: number[], box: object, formula: string, out: string } | { ok: false, code: string, message: string }}
 */
export function cropForProvider(root, box, outPath) {
  const loaded = loadBase(root);
  if (!loaded.ok) return loaded;
  const { base } = loaded;
  const bad = checkBox(box, base.width, base.height);
  if (bad) return bad;
  const { w, h } = boxSize(box);
  const scale = providerScale(Math.max(w, h));
  const view = resizeImage(cropBox(base, box), w * scale, h * scale, 'bilinear');
  const out = outFile(root, outPath, 'crop.png');
  writePngFile(out, view);
  return {
    ok: true,
    scale,
    size: [view.width, view.height],
    box: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 },
    formula: 'crop = (canvas - (x0,y0)) * scale',
    out,
  };
}

/** Sets 1 in the part of the mask (box-relative) covered by the canvas rectangle rect. */
function fillRectInMask(mask, rect, box) {
  const x0 = Math.max(rect.x0, box.x0) - box.x0;
  const y0 = Math.max(rect.y0, box.y0) - box.y0;
  const x1 = Math.min(rect.x1, box.x1) - box.x0;
  const y1 = Math.min(rect.y1, box.y1) - box.y0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) mask.data[y * mask.width + x] = 1;
  }
}

/**
 * The weight of the raw picture inside the box: 0 keeps the base, 1 takes the raw.
 * @returns {{ ok: true, weights: Float32Array } | { ok: false, code: string, message: string }}
 */
function weightsFor({ mode, box, bw, bh, landBox, zones, maskPath, margin, baseSize }) {
  if (mode === 'box') return { ok: true, weights: new Float32Array(bw * bh).fill(1) };
  if (mode === 'land') {
    const mask = newMask(bw, bh);
    for (let i = 0; i < bw * bh; i++) mask.data[i] = landBox.data[i];
    for (const zone of zones) fillRectInMask(mask, zone, box);
    return { ok: true, weights: featherMask(mask, LAND_FEATHER) };
  }
  // mode 'mask': the mask picture is canvas-sized or box-sized.
  const read = readImage(maskPath);
  if (read.error) return read.error;
  const picture = read.image;
  let maskBox;
  if (picture.width === baseSize.width && picture.height === baseSize.height) {
    maskBox = imageToMask(cropBox(picture, box), LAND_THRESHOLD);
  } else if (picture.width === bw && picture.height === bh) {
    maskBox = imageToMask(picture, LAND_THRESHOLD);
  } else {
    return fail('bad-mask', `the mask must be ${baseSize.width}x${baseSize.height} or the box size ${bw}x${bh}`);
  }
  return { ok: true, weights: featherMask(maskBox, margin) };
}

/**
 * Composes the provider output on the base into a full-canvas candidate, changed only inside the
 * box (and the zones). Never writes the atlas folder.
 * @returns {{ ok: true, out: string, box: object } | { ok: false, code: string, message: string }}
 */
export function composeCandidate(root, options = {}) {
  const {
    rawPath,
    box,
    mode = 'land',
    maskPath,
    margin = 30,
    zones = [],
    restores = [],
    colorMatch = true,
    outPath,
  } = options;
  if (!rawPath) return fail('no-raw', 'the provider output is missing');
  if (!['land', 'box', 'mask'].includes(mode)) return fail('bad-mode', `mode must be land, box or mask, not ${mode}`);
  if (mode === 'mask' && !maskPath) return fail('no-mask', 'mode mask needs the mask picture');
  const loaded = loadBase(root);
  if (!loaded.ok) return loaded;
  const { base, land } = loaded;
  const bad = checkBox(box, base.width, base.height);
  if (bad) return bad;
  for (const zone of zones) {
    const zoneBad = checkBox(zone, base.width, base.height);
    if (zoneBad) return zoneBad;
    if (!isInside(zone, box)) return fail('zone-outside-box', 'a zone must lie inside the box');
  }
  for (const restore of restores) {
    const restoreBad = checkBox(restore, base.width, base.height);
    if (restoreBad) return restoreBad;
  }
  if (mode === 'land' && !land) return fail('no-land', 'mode land needs land.png');

  const readRaw = readImage(rawPath);
  if (readRaw.error) return readRaw.error;
  const { w: bw, h: bh } = boxSize(box);
  const rawBox = resizeImage(readRaw.image, bw, bh, 'bilinear');
  const baseBox = cropBox(base, box);
  const landBox = land ? cropBoxMask(land, box) : null;

  let raw = rawBox;
  if (colorMatch && landBox) {
    const isLand = (i) => landBox.data[i] === 1;
    const isSea = (i) => landBox.data[i] === 0;
    raw = matchColors(raw, baseBox, isLand, isLand);
    raw = matchColors(raw, baseBox, isSea, isSea);
  }

  const weightResult = weightsFor({
    mode, box, bw, bh, landBox, zones, maskPath, margin,
    baseSize: { width: base.width, height: base.height },
  });
  if (!weightResult.ok) return weightResult;
  const weights = weightResult.weights;

  const blended = newImage(bw, bh);
  for (let i = 0; i < bw * bh; i++) {
    const wgt = Math.min(Math.max(weights[i], 0), 1);
    for (let c = 0; c < 3; c++) {
      blended.data[i * 4 + c] = Math.round(wgt * raw.data[i * 4 + c] + (1 - wgt) * baseBox.data[i * 4 + c]);
    }
    blended.data[i * 4 + 3] = 255;
  }

  const candidate = { width: base.width, height: base.height, data: new Uint8ClampedArray(base.data) };
  pasteImage(candidate, blended, box.x0, box.y0);
  for (const restore of restores) {
    pasteImage(candidate, cropBox(base, restore), restore.x0, restore.y0);
  }
  const out = outFile(root, outPath, 'candidate.png');
  writePngFile(out, candidate);
  return { ok: true, out, box: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 } };
}

/** Pixels outside the box whose RGB differs between the two pictures. */
function countOutsideBox(base, candidate, box) {
  let count = 0;
  for (let y = 0; y < base.height; y++) {
    for (let x = 0; x < base.width; x++) {
      if (x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1) continue;
      const i = (y * base.width + x) * 4;
      if (
        base.data[i] !== candidate.data[i]
        || base.data[i + 1] !== candidate.data[i + 1]
        || base.data[i + 2] !== candidate.data[i + 2]
      ) count++;
    }
  }
  return count;
}

/**
 * Reads the candidate and measures it against the current land and the base. Shared by verify and
 * accept. Never writes.
 */
function evaluateCandidate(loaded, candidatePath, box) {
  const { base, land, atlas } = loaded;
  const bad = checkBox(box, base.width, base.height);
  if (bad) return bad;
  if (!land) return fail('no-land', 'the atlas has no land.png; run land first');
  const read = readImage(candidatePath);
  if (read.error) return read.error;
  const candidate = read.image;
  if (candidate.width !== base.width || candidate.height !== base.height) {
    return fail('size-mismatch', `the candidate is ${candidate.width}x${candidate.height}, the canvas is ${base.width}x${base.height}`);
  }
  const sea = seaSpec(atlas, base);
  const candidateLand = landMaskFromImage(candidate, {
    seaColor: sea.color, tolerance: sea.tolerance, waterColors: sea.waters,
  });
  const diff = diffMasks(land, candidateLand, MIN_BLOCK);
  return {
    ok: true,
    gained: diff.gained,
    lost: diff.lost,
    blocks: diff.blocks,
    pixelsOutsideBox: countOutsideBox(base, candidate, box),
    candidate,
    candidateLand,
  };
}

/** before | after | diff, the box scaled so the strip is at most MAX_STRIP wide. */
function comparisonPicture(loaded, evaluation, box) {
  const { base, land } = loaded;
  const { w, h } = boxSize(box);
  const before = cropBox(base, box);
  const after = cropBox(evaluation.candidate, box);
  const landBefore = cropBoxMask(land, box);
  const landAfter = cropBoxMask(evaluation.candidateLand, box);
  const diff = newImage(w, h);
  for (let i = 0; i < w * h; i++) {
    let rgb;
    if (landBefore.data[i] && !landAfter.data[i]) rgb = [255, 0, 0];
    else if (!landBefore.data[i] && landAfter.data[i]) rgb = [0, 255, 0];
    else rgb = landBefore.data[i] ? [200, 200, 200] : [40, 40, 40];
    diff.data.set(rgb, i * 4);
    diff.data[i * 4 + 3] = 255;
  }
  const factor = Math.min(4, MAX_STRIP / (3 * w + 2 * STRIP_GAP));
  const pw = Math.max(1, Math.floor(w * factor));
  const ph = Math.max(1, Math.floor(h * factor));
  const strip = newImage(3 * pw + 2 * STRIP_GAP, ph, STRIP_BG);
  pasteImage(strip, resizeImage(before, pw, ph, 'bilinear'), 0, 0);
  pasteImage(strip, resizeImage(after, pw, ph, 'bilinear'), pw + STRIP_GAP, 0);
  pasteImage(strip, resizeImage(diff, pw, ph, 'nearest'), 2 * (pw + STRIP_GAP), 0);
  return strip;
}

/**
 * Measures a candidate: land gained and lost against land.png, changed blocks, pixels changed
 * outside the box, and a before | after | diff picture.
 * @returns {{ ok: true, gained: number, lost: number, blocks: object[], pixelsOutsideBox: number, out: string } | { ok: false, code: string, message: string }}
 */
export function verifyCandidate(root, { candidatePath, box, outPath } = {}) {
  const loaded = loadBase(root);
  if (!loaded.ok) return loaded;
  const evaluation = evaluateCandidate(loaded, candidatePath, box);
  if (!evaluation.ok) return evaluation;
  const out = outFile(root, outPath, 'verify.png');
  writePngFile(out, comparisonPicture(loaded, evaluation, box));
  return {
    ok: true,
    gained: evaluation.gained,
    lost: evaluation.lost,
    blocks: evaluation.blocks,
    pixelsOutsideBox: evaluation.pixelsOutsideBox,
    out,
  };
}

/**
 * The land of an image: a fresh mask, or, with a box, the box part of the new mask pasted over the
 * existing one (the rest of the existing land is kept).
 */
function buildLandMask(image, sea, existing, box) {
  const full = landMaskFromImage(image, { seaColor: sea.color, tolerance: sea.tolerance, waterColors: sea.waters });
  if (!box || !existing) return full;
  const out = { width: existing.width, height: existing.height, data: new Uint8Array(existing.data) };
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const p = y * out.width + x;
      out.data[p] = full.data[p];
    }
  }
  return out;
}

/** Writes land.png from an image, and returns the mask and the hash of the file. */
function writeLandFromImage(state, image, { box = null, sea }) {
  let existing = null;
  if (fs.existsSync(state.landPath)) {
    const read = readImage(state.landPath);
    if (read.error) return read.error;
    if (read.image.width !== image.width || read.image.height !== image.height) {
      // A partial rebuild needs the old mask of the same size; a whole rebuild does not, so it
      // ignores the old land.png and builds the full mask from the image.
      if (box) return fail('size-mismatch', 'land.png and the base picture differ in size');
    } else {
      existing = imageToMask(read.image, LAND_THRESHOLD);
    }
  }
  if (box && !existing) box = null;
  const mask = buildLandMask(image, sea, existing, box);
  writePngFile(state.landPath, maskToImage(mask));
  return { ok: true, mask, sha: sha256Of(fs.readFileSync(state.landPath)) };
}

/**
 * Rebuilds land.png from the base (or from another picture), whole or in a box, and records the
 * sea colour and the extra waters in atlas.json when one is given. Refuses when the land is locked
 * unless unlock is set.
 * waterPoints ([x, y] inside the picture, e.g. a point in a lake) add the colour of each point to
 * land.sea.waters (duplicates by colour are dropped); clearWaters empties the list first.
 * @returns {{ ok: true, landPixels: number, seaColor: string, tolerance: number, waters: object[] } | { ok: false, code: string, message: string }}
 */
export function deriveLand(root, {
  from, box, seaColor, tolerance, unlock = false, waterPoints, clearWaters = false,
} = {}) {
  const state = readAtlasState(root);
  if (!state.ok) return state;
  if (state.atlas.land?.locked === true && !unlock) {
    return fail('land-locked', 'the land is locked; the master must unlock it to rebuild it');
  }
  const source = from ? path.resolve(from) : state.basePath;
  if (!fs.existsSync(source)) return fail('no-base', `${path.basename(source)} does not exist`);
  const read = readImage(source);
  if (read.error) return read.error;
  const image = read.image;

  const given = seaColor !== undefined || tolerance !== undefined || waterPoints !== undefined || clearWaters;
  if (seaColor !== undefined && !parseHex(seaColor)) return fail('bad-sea-color', 'the sea colour must be #rrggbb');
  if (tolerance !== undefined && !(Number.isInteger(tolerance) && tolerance >= 0 && tolerance <= 255)) {
    return fail('bad-tolerance', 'the tolerance must be a whole number from 0 to 255');
  }
  if (box) {
    const bad = checkBox(box, image.width, image.height);
    if (bad) return bad;
  }
  if (waterPoints !== undefined) {
    const valid = Array.isArray(waterPoints) && waterPoints.every((p) => Array.isArray(p) && p.length === 2
      && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[1] >= 0
      && p[0] < image.width && p[1] < image.height);
    if (!valid) return fail('bad-water-point', `a water point must be x,y inside the ${image.width}x${image.height} picture`);
  }
  const fallback = seaSpec(state.atlas, image);
  const storedWaters = clearWaters ? [] : fallback.waters;
  const added = waterPoints?.length ? waterColorsFromPoints(image, waterPoints) : [];
  const sea = {
    color: parseHex(seaColor) ?? fallback.color,
    tolerance: tolerance ?? fallback.tolerance,
    waters: mergeWaters(storedWaters, added),
  };
  const written = writeLandFromImage(state, image, { box: box ?? null, sea });
  if (!written.ok) return written;

  const waters = sea.waters.map((w) => ({ color: toHex(w.color), tolerance: w.tolerance }));
  if (given) {
    const seaOut = { color: toHex(sea.color), tolerance: sea.tolerance };
    if (waters.length > 0) seaOut.waters = waters;
    const manifest = { ...state.atlas, land: { ...state.atlas.land, sha256: written.sha, sea: seaOut } };
    writeJson(state.atlasPath, manifest);
  } else {
    writeJson(state.atlasPath, { ...state.atlas, land: { ...state.atlas.land, sha256: written.sha } });
  }
  return {
    ok: true,
    landPixels: countOnes(written.mask),
    seaColor: toHex(sea.color),
    tolerance: sea.tolerance,
    waters,
  };
}

/** Existing waters followed by the added ones, one entry per colour (the first one wins). */
function mergeWaters(existing, added) {
  const seen = new Set();
  const out = [];
  for (const entry of [...existing, ...added]) {
    const key = toHex(entry.color);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * Puts a candidate on base.png and rebuilds land.png inside the box, after the checks: no change
 * outside the box, base not locked, and land change allowed by the lock.
 * @returns {{ ok: true, gained: number, lost: number } | { ok: false, code: string, message: string }}
 */
export function acceptCandidate(root, { candidatePath, box, extend = false, unlock = false } = {}) {
  const loaded = loadBase(root);
  if (!loaded.ok) return loaded;
  const evaluation = evaluateCandidate(loaded, candidatePath, box);
  if (!evaluation.ok) return evaluation;
  if (evaluation.pixelsOutsideBox > 0) {
    return fail('outside-box', `${evaluation.pixelsOutsideBox} pixels outside the box would change; nothing was written`);
  }
  const change = checkLandChange({
    manifest: loaded.atlas,
    diff: { gained: evaluation.gained, lost: evaluation.lost },
    extend,
    unlock,
  });
  if (!change.ok) {
    return fail('land-locked', 'the land is locked and this candidate changes it; nothing was written');
  }

  const state = readAtlasState(root);
  if (!state.ok) return state;
  writePngFile(state.basePath, evaluation.candidate);
  const sea = seaSpec(state.atlas, evaluation.candidate);
  const written = writeLandFromImage(state, evaluation.candidate, { box, sea });
  if (!written.ok) return written;
  const manifest = {
    ...state.atlas,
    base: { ...state.atlas.base, sha256: sha256Of(fs.readFileSync(state.basePath)) },
    land: { ...state.atlas.land, sha256: written.sha },
  };
  writeJson(state.atlasPath, manifest);
  return { ok: true, gained: evaluation.gained, lost: evaluation.lost };
}

/**
 * Writes the land mask as a black and white PNG, for the assistant to look at.
 * @returns {{ ok: true, out: string } | { ok: false, code: string, message: string }}
 */
export function maskPreview(root, outPath) {
  const loaded = loadBase(root);
  if (!loaded.ok) return loaded;
  if (!loaded.land) return fail('no-land', 'the atlas has no land.png; run land first');
  const out = outFile(root, outPath, 'land-mask.png');
  writePngFile(out, maskToImage(loaded.land));
  return { ok: true, out };
}
