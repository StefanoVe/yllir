// Rasterizer of the bake: turns the players' SVG of the atlas into a PNG with the pinned packages. The packages
// live outside the campaign and outside the framework, in <data dir>/atlas-tools, and are installed on first use
// by bake-setup.mjs. Nothing here is imported from the framework's own dependencies.
// Two packages: @resvg/resvg-js renders the SVG, and @jsquash/webp decodes the WebP files of the style textures
// and stamps, which resvg cannot read. The WebP images are decoded here and handed to resvg as PNG files.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PINS_FILE = fileURLToPath(new URL('../../assets/bake-tools.json', import.meta.url));
const TOOLS_SUBDIR = 'atlas-tools';
const MESSAGE_LIMIT = 200;
const RENDERER = '@resvg/resvg-js';
const WEBP = '@jsquash/webp';
/** The decoder module of @jsquash/webp, relative to the package root, and its wasm file. */
const WEBP_DECODER = 'decode.js';
const WEBP_WASM = path.join('codec', 'dec', 'webp_dec.wasm');
/** The WebP references of the SVG: an href (or xlink:href) that ends in .webp. */
const WEBP_HREF = /(\s(?:xlink:)?href=")([^"]+\.webp)"/gi;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The pinned packages (assets/bake-tools.json): `{ packages: [{ package, version }] }`. */
export function loadPins(file = PINS_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * The data folder: the given one when it is usable, else CLAUDE_PLUGIN_DATA, else the OS default. Always absolute.
 * Same rule as the image tools' install (outside every campaign).
 */
export function resolveDataDir(given, { env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (typeof given === 'string' && given !== '' && !given.includes('${')) return path.resolve(given);
  if (typeof env.CLAUDE_PLUGIN_DATA === 'string' && env.CLAUDE_PLUGIN_DATA !== '' && !env.CLAUDE_PLUGIN_DATA.includes('${')) {
    return path.resolve(env.CLAUDE_PLUGIN_DATA);
  }
  if (platform === 'darwin') return path.resolve(home, 'Library', 'Application Support', 'yllir');
  if (platform === 'win32') return path.resolve(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'yllir');
  const xdg = env.XDG_DATA_HOME;
  return path.resolve(xdg && xdg !== '' ? xdg : path.join(home, '.local', 'share'), 'yllir');
}

/** The folder where the rasterizer packages are installed, for a data folder. */
export function toolsDirOf(dataDir, options) {
  return path.join(resolveDataDir(dataDir, options), TOOLS_SUBDIR);
}

/** The folder of one installed package inside a tools folder. */
function packageDirOf(toolsDir, pkgName) {
  return path.join(toolsDir, 'node_modules', ...pkgName.split('/'));
}

/** The installed version of the package in a tools folder, or null when it is not installed. */
export function installedVersion(toolsDir, pkgName) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDirOf(toolsDir, pkgName), 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/** The absolute entry file of the installed package, or null when it is not installed. */
export function packageEntry(toolsDir, pkgName) {
  const pkgDir = packageDirOf(toolsDir, pkgName);
  let main = 'index.js';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    if (typeof pkg.main === 'string' && pkg.main !== '') main = pkg.main;
  } catch {
    return null;
  }
  return path.join(pkgDir, main);
}

/** Imports a module by its absolute file path. */
export function defaultLoader(entry) {
  return import(pathToFileURL(entry).href);
}

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

function unavailable(message) {
  const err = new Error(message);
  err.code = 'rasterizer-unavailable';
  return err;
}

/** Loads the package and returns its Resvg class; throws rasterizer-unavailable when it cannot. */
async function loadResvg(entry, loader) {
  let mod;
  try {
    mod = await loader(entry);
  } catch (err) {
    throw unavailable(`${entry} could not be loaded: ${oneLine(err.message)}`);
  }
  const Resvg = mod?.Resvg ?? mod?.default?.Resvg;
  if (typeof Resvg !== 'function') throw unavailable(`${entry} does not export Resvg`);
  return Resvg;
}

/** The modules that already had their wasm initialised (a module object is initialised once). */
const initialisedDecoders = new WeakSet();

/**
 * The WebP decoder of @jsquash/webp, with its wasm read from disk and initialised once. Throws
 * rasterizer-unavailable when the package is missing or cannot be initialised.
 */
async function webpDecoderOf(toolsDir, loader) {
  const pkgDir = packageDirOf(toolsDir, WEBP);
  let mod;
  try {
    mod = await loader(path.join(pkgDir, WEBP_DECODER));
  } catch (err) {
    throw unavailable(`${WEBP} could not be loaded: ${oneLine(err.message)}`);
  }
  if (typeof mod?.init !== 'function' || typeof mod?.default !== 'function') {
    throw unavailable(`${WEBP} does not export init and decode`);
  }
  if (!initialisedDecoders.has(mod)) {
    try {
      // The wasm is handed over as a compiled module: jSquash's own fetch path does not work outside browsers.
      await mod.init(new WebAssembly.Module(fs.readFileSync(path.join(pkgDir, WEBP_WASM))));
    } catch (err) {
      throw unavailable(`${WEBP} wasm could not be initialised: ${oneLine(err.message)}`);
    }
    initialisedDecoders.add(mod);
  }
  return mod.default;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Encodes RGBA pixels as an 8-bit PNG (colour type 6). lib/png.mjs writes RGB only, hence this encoder.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba width*height*4 bytes, row by row, left to right
 * @returns {Buffer}
 */
export function encodeRgbaPng(width, height, rgba) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) throw new Error('png-size');
  if (rgba.length !== width * height * 4) throw new Error('png-data');
  const rowBytes = width * 4;
  const raw = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    const offset = y * (rowBytes + 1);
    raw[offset] = 0; // filter type None
    raw.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), offset + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type RGBA
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function unescapeXml(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&amp;/g, '&');
}

function escapeXmlAttribute(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Replaces every absolute WebP href of the SVG (images and patterns) by a PNG of the same picture, written into
 * workDir as <sha8>.png. Each distinct file is decoded once. A file that does not exist keeps its href (the renderer
 * skips it). A WebP that cannot be decoded throws, so that a blank render is never silent. Relative hrefs are left
 * alone: the renderer resolves them against resourcesDir. Returns the SVG unchanged when it has no WebP.
 * @param {string} svg
 * @param {{ workDir: string, loader?: (entry: string) => Promise<object>, dataDir?: string }} options
 * @returns {Promise<string>}
 */
export async function prepareSvgImages(svg, { workDir, loader = defaultLoader, dataDir } = {}) {
  const hrefs = [...svg.matchAll(WEBP_HREF)].map((m) => unescapeXml(m[2])).filter((href) => path.isAbsolute(href));
  if (hrefs.length === 0) return svg;

  let decode = null;
  const converted = new Map();
  for (const file of new Set(hrefs)) {
    if (!fs.existsSync(file)) continue;
    if (decode === null) decode = await webpDecoderOf(toolsDirOf(dataDir), loader);
    const bytes = fs.readFileSync(file);
    let image;
    try {
      image = await decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    } catch (err) {
      const error = new Error(`${file} could not be decoded: ${oneLine(err.message)}`);
      error.code = 'webp-decode';
      throw error;
    }
    const digest = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    const target = path.join(workDir, `${digest}.png`);
    fs.writeFileSync(target, encodeRgbaPng(image.width, image.height, image.data));
    converted.set(file, target);
  }

  return svg.replace(WEBP_HREF, (whole, prefix, raw) => {
    const target = converted.get(unescapeXml(raw));
    return target === undefined ? whole : `${prefix}${escapeXmlAttribute(target)}"`;
  });
}

/**
 * Renders an SVG to a PNG of the given width. WebP images are converted first (prepareSvgImages). Local image
 * hrefs of the SVG resolve against `resourcesDir`; system fonts are not loaded (the bake input has no text). Throws
 * an error with code `rasterizer-unavailable` when a package is not installed or cannot be loaded.
 * @param {string} svg
 * @param {{ width: number, dataDir?: string, resourcesDir?: string, loader?: (entry: string) => Promise<object> }} options
 * @returns {Promise<Buffer>} the PNG bytes
 */
export async function rasterizeSvg(svg, { width, dataDir, resourcesDir, loader = defaultLoader } = {}) {
  if (!Number.isInteger(width) || width < 1) throw new RangeError('width must be a whole number above zero');
  const pins = loadPins();
  const tools = toolsDirOf(dataDir);
  for (const pin of pins.packages) {
    if (packageEntry(tools, pin.package) === null || installedVersion(tools, pin.package) === null) {
      throw unavailable(`${pin.package} is not installed in ${tools}`);
    }
  }
  const Resvg = await loadResvg(packageEntry(tools, RENDERER), loader);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-bake-'));
  try {
    const prepared = await prepareSvgImages(svg, { workDir, loader, dataDir });
    const options = {
      fitTo: { mode: 'width', value: width },
      font: { loadSystemFonts: false },
    };
    const renderer = new Resvg(prepared, options);
    // The hrefs the renderer asks for are read from resourcesDir (a relative href is taken from it). Absolute
    // file hrefs are read by the renderer itself. Only the hrefs it lists are resolved here.
    for (const href of renderer.imagesToResolve()) {
      if (!resourcesDir) continue;
      const file = path.isAbsolute(href) ? href : path.join(resourcesDir, href);
      if (fs.existsSync(file)) renderer.resolveImage(href, fs.readFileSync(file));
    }
    return Buffer.from(renderer.render().asPng());
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function fail(reason, message) {
  const text = oneLine(message);
  return { ok: false, reason, message: text.length > MESSAGE_LIMIT ? text.slice(0, MESSAGE_LIMIT) : text };
}

/**
 * Installs the pinned packages when one is missing or of another version, then checks that they load. Idempotent:
 * installed pinned versions are not installed again. Never rejects.
 * @param {object} options
 * @param {string} options.dataDir the data folder (the tools go in <dataDir>/atlas-tools)
 * @param {(cmd: string, args: string[], opts?: object) => Promise<{code: number, stdout: string, stderr: string}>} options.runner
 * @param {(toolsDir: string) => Promise<void>} [options.probe] loads the packages to check them (default: the real loaders)
 * @returns {Promise<{ok: true, dir: string, versions: Record<string, string>} | {ok: false, reason: string, message: string}>}
 */
export async function installRasterizer({ dataDir, runner, probe, pins = loadPins() }) {
  const tools = toolsDirOf(dataDir);
  const specs = pins.packages.map((pin) => `${pin.package}@${pin.version}`);
  const missing = pins.packages.some((pin) => installedVersion(tools, pin.package) !== pin.version);
  if (missing) {
    try {
      fs.mkdirSync(tools, { recursive: true });
    } catch (err) {
      return fail('disk', err.message);
    }
    const args = ['install', '--prefix', tools, '--no-audit', '--no-fund', '--ignore-scripts=false', ...specs];
    const res = await runner(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {});
    if (res.code === 127) return fail('npm-missing', 'npm was not found on the PATH');
    if (res.code !== 0) return fail('install-failed', `npm install ${specs.join(' ')} failed: ${oneLine(res.stderr)}`);
    for (const pin of pins.packages) {
      const version = installedVersion(tools, pin.package);
      if (version !== pin.version) {
        return fail('install-failed', `${pin.package}@${pin.version} was not installed (found ${version ?? 'nothing'})`);
      }
    }
  }
  for (const pin of pins.packages) {
    if (packageEntry(tools, pin.package) === null) return fail('install-failed', `${pin.package} has no entry file`);
  }
  try {
    if (probe) {
      await probe(tools);
    } else {
      await loadResvg(packageEntry(tools, RENDERER), defaultLoader);
      await webpDecoderOf(tools, defaultLoader);
    }
  } catch (err) {
    return fail('load-failed', err.message);
  }
  const versions = Object.fromEntries(pins.packages.map((pin) => [pin.package, pin.version]));
  return { ok: true, dir: tools, versions };
}
