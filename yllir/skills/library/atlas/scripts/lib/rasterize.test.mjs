import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { pngSize, encodePng } from '../../../../../scripts/lib/png.mjs';
import {
  defaultLoader, encodeRgbaPng, installRasterizer, installedVersion, loadPins, packageEntry, prepareSvgImages,
  rasterizeSvg, resolveDataDir, toolsDirOf,
} from './rasterize.mjs';

const tmpRoots = [];
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

function tempData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-bake-rasterize-'));
  tmpRoots.push(dir);
  return dir;
}

const RESVG = { package: '@resvg/resvg-js', version: '2.6.2' };
const WEBP = { package: '@jsquash/webp', version: '1.5.0' };
const PINS = { packages: [RESVG, WEBP] };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50"><rect width="100" height="50" fill="#3366cc"/></svg>';
const TEXTURE = fileURLToPath(new URL('../../assets/styles/fantasy-color/textures/deep-sea.webp', import.meta.url));

/** Writes a fake installed package (its package.json and entry file) into a tools folder. */
function writeFakePackage(toolsDir, pin) {
  const pkgDir = path.join(toolsDir, 'node_modules', ...pin.package.split('/'));
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pin.package, version: pin.version, main: 'index.js' }));
  fs.writeFileSync(path.join(pkgDir, 'index.js'), 'module.exports = {};\n');
  if (pin.package === WEBP.package) {
    // The empty wasm module (magic and version only): the decoder's init compiles the file on disk.
    fs.mkdirSync(path.join(pkgDir, 'codec', 'dec'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'codec', 'dec', 'webp_dec.wasm'), Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
  }
  return pkgDir;
}

/** Writes both fake packages into a data folder, at the pinned versions unless others are given. */
function fakeInstall(dataDir, { resvg = RESVG.version, webp = WEBP.version } = {}) {
  const tools = toolsDirOf(dataDir);
  const resvgDir = writeFakePackage(tools, { ...RESVG, version: resvg });
  writeFakePackage(tools, { ...WEBP, version: webp });
  return resvgDir;
}

/** A fake Resvg class that records its constructor arguments and the hrefs it was asked to resolve. */
function fakeModule(calls, { hrefs = [] } = {}) {
  class Resvg {
    constructor(svg, options) {
      this.svg = svg;
      this.options = options;
      this.resolved = [];
      calls.push(this);
    }

    imagesToResolve() {
      return hrefs;
    }

    resolveImage(href, buffer) {
      this.resolved.push({ href, bytes: buffer.length });
    }

    render() {
      const width = this.options.fitTo.value;
      const height = Math.round(width / 2);
      return { asPng: () => encodePng(width, height, new Uint8Array(width * height * 3)) };
    }
  }
  return { Resvg };
}

/** A fake @jsquash/webp decoder module: decodes any bytes to a 2x1 image, and records each decode. */
function fakeWebpModule(decodes = [], { fail = false } = {}) {
  return {
    init: async () => {},
    default: async (buffer) => {
      decodes.push(buffer.byteLength);
      if (fail) throw new Error('corrupt file');
      return { width: 2, height: 1, data: Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 128]) };
    },
  };
}

/**
 * Decodes an 8-bit PNG of colour type 2 (RGB) or 6 (RGBA), not interlaced, into RGBA pixels. Test helper only: it
 * reads the output of the rasterizer back, so that the pixels can be counted.
 */
function decodePngRgba(buffer) {
  let width = 0;
  let height = 0;
  let colourType = 0;
  const idat = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'bit depth 8');
      colourType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += 12 + length;
  }
  const bpp = colourType === 6 ? 4 : 3;
  assert.ok(colourType === 6 || colourType === 2, 'colour type RGB or RGBA');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      out[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = out[i * bpp + k];
    rgba[i * 4 + 3] = bpp === 4 ? out[i * bpp + 3] : 255;
  }
  return { width, height, rgba };
}

const distinctColours = (rgba) => new Set(Array.from({ length: rgba.length / 4 }, (_, i) => rgba.subarray(i * 4, i * 4 + 4).join(','))).size;

test('resolveDataDir: the given folder, else CLAUDE_PLUGIN_DATA, else the OS default; an unexpanded variable is ignored', () => {
  assert.equal(resolveDataDir('/x/data'), path.resolve('/x/data'));
  assert.equal(resolveDataDir('${CLAUDE_PLUGIN_DATA}', { env: {}, platform: 'darwin', home: '/h' }), path.resolve('/h/Library/Application Support/yllir'));
  assert.equal(resolveDataDir(undefined, { env: { CLAUDE_PLUGIN_DATA: '/plugin' }, platform: 'linux', home: '/h' }), path.resolve('/plugin'));
  assert.equal(resolveDataDir(undefined, { env: {}, platform: 'linux', home: '/h' }), path.resolve('/h/.local/share/yllir'));
  assert.equal(toolsDirOf('/x/data'), path.join(path.resolve('/x/data'), 'atlas-tools'));
});

test('the pins are the exact packages and versions of assets/bake-tools.json: the renderer and the WebP decoder', () => {
  assert.deepEqual(loadPins(), PINS);
});

test('rasterizeSvg without the packages throws rasterizer-unavailable and never calls the loader', async () => {
  const dataDir = tempData();
  let loaded = false;
  await assert.rejects(
    rasterizeSvg(SVG, { width: 200, dataDir, loader: async () => { loaded = true; return {}; } }),
    (err) => err.code === 'rasterizer-unavailable' && /not installed/.test(err.message),
  );
  assert.equal(loaded, false);
});

test('rasterizeSvg with only the renderer installed throws rasterizer-unavailable for the WebP decoder', async () => {
  const dataDir = tempData();
  writeFakePackage(toolsDirOf(dataDir), RESVG);
  await assert.rejects(
    rasterizeSvg(SVG, { width: 200, dataDir, loader: async () => fakeModule([]) }),
    (err) => err.code === 'rasterizer-unavailable' && /@jsquash\/webp is not installed/.test(err.message),
  );
});

test('rasterizeSvg with a loader that fails throws rasterizer-unavailable', async () => {
  const dataDir = tempData();
  fakeInstall(dataDir);
  await assert.rejects(
    rasterizeSvg(SVG, { width: 200, dataDir, loader: async () => { throw new Error('bad binary'); } }),
    (err) => err.code === 'rasterizer-unavailable' && /bad binary/.test(err.message),
  );
});

test('rasterizeSvg renders at the given width with fit-to-width, no system fonts, and returns PNG bytes', async () => {
  const dataDir = tempData();
  const resvgDir = fakeInstall(dataDir);
  const calls = [];
  const png = await rasterizeSvg(SVG, {
    width: 800,
    dataDir,
    resourcesDir: '/assets',
    loader: async (entry) => {
      assert.equal(entry, path.join(resvgDir, 'index.js'));
      return fakeModule(calls);
    },
  });
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual(pngSize(png), { width: 800, height: 400 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].svg, SVG);
  assert.deepEqual(calls[0].options.fitTo, { mode: 'width', value: 800 });
  assert.deepEqual(calls[0].options.font, { loadSystemFonts: false });
  assert.deepEqual(Object.keys(calls[0].options).sort(), ['fitTo', 'font']);
});

test('rasterizeSvg passes fontFiles to the renderer only when they are given', async () => {
  const dataDir = tempData();
  fakeInstall(dataDir);
  const fontFile = path.join(dataDir, 'Cinzel.ttf');
  const withFonts = [];
  await rasterizeSvg(SVG, {
    width: 200,
    dataDir,
    loader: async () => fakeModule(withFonts),
    fontFiles: [fontFile],
  });
  assert.deepEqual(withFonts[0].options.font, { loadSystemFonts: false, fontFiles: [fontFile] });
  const without = [];
  await rasterizeSvg(SVG, { width: 200, dataDir, loader: async () => fakeModule(without) });
  assert.deepEqual(without[0].options.font, { loadSystemFonts: false });
  assert.equal('fontFiles' in without[0].options.font, false);
});

test('rasterizeSvg resolves the hrefs the renderer lists against resourcesDir, and skips the ones that do not exist', async () => {
  const dataDir = tempData();
  fakeInstall(dataDir);
  const assets = tempData();
  fs.writeFileSync(path.join(assets, 'stamp.png'), 'stamp-bytes');
  const calls = [];
  await rasterizeSvg(SVG, {
    width: 200,
    dataDir,
    resourcesDir: assets,
    loader: async () => fakeModule(calls, { hrefs: ['stamp.png', 'missing.png'] }),
  });
  assert.deepEqual(calls[0].resolved, [{ href: 'stamp.png', bytes: 'stamp-bytes'.length }]);
});

test('rasterizeSvg removes the folder of the WebP files it wrote, even when the render fails', async () => {
  const dataDir = tempData();
  fakeInstall(dataDir);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="${TEXTURE}"/></svg>`;
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('yllir-bake-')));
  const failing = { Resvg: class { constructor() {} imagesToResolve() { return []; } render() { throw new Error('bad svg'); } } };
  await assert.rejects(rasterizeSvg(svg, { width: 100, dataDir, loader: async (entry) => (entry.endsWith('decode.js') ? fakeWebpModule() : failing) }), /bad svg/);
  const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('yllir-bake-') && !before.has(name));
  assert.deepEqual(after, []);
});

test('rasterizeSvg rejects a width that is not a whole number above zero', async () => {
  await assert.rejects(rasterizeSvg(SVG, { width: 0, dataDir: tempData() }), RangeError);
  await assert.rejects(rasterizeSvg(SVG, { width: 10.5, dataDir: tempData() }), RangeError);
});

test('packageEntry is null without an installed package, and the main file of the installed one otherwise', () => {
  const dataDir = tempData();
  const tools = toolsDirOf(dataDir);
  assert.equal(packageEntry(tools, RESVG.package), null);
  assert.equal(installedVersion(tools, RESVG.package), null);
  fakeInstall(dataDir);
  assert.equal(installedVersion(tools, RESVG.package), RESVG.version);
  assert.equal(installedVersion(tools, WEBP.package), WEBP.version);
  assert.equal(packageEntry(tools, RESVG.package), path.join(tools, 'node_modules', '@resvg', 'resvg-js', 'index.js'));
});

/** A runner that stands in for npm: `install` writes the fake packages at the given version. */
function fakeRunner({ code = 0, stderr = '', version = RESVG.version, log = [] } = {}) {
  return async (cmd, args) => {
    log.push({ cmd, args });
    if (code === 0 && args[0] === 'install') {
      const prefix = args[args.indexOf('--prefix') + 1];
      fakeInstall(path.dirname(prefix), { resvg: version, webp: WEBP.version });
    }
    return { code, stdout: '', stderr };
  };
}

test('installRasterizer runs the pinned npm install of both packages into the tools folder, then checks they load', async () => {
  const dataDir = tempData();
  const log = [];
  const result = await installRasterizer({ dataDir, runner: fakeRunner({ log }), probe: async () => {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.versions, { '@resvg/resvg-js': '2.6.2', '@jsquash/webp': '1.5.0' });
  assert.equal(result.dir, toolsDirOf(dataDir));
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].args, [
    'install', '--prefix', toolsDirOf(dataDir), '--no-audit', '--no-fund', '--ignore-scripts=false',
    '@resvg/resvg-js@2.6.2', '@jsquash/webp@1.5.0',
  ]);
});

test('installRasterizer is idempotent: installed pinned versions run no npm at all', async () => {
  const dataDir = tempData();
  fakeInstall(dataDir);
  const log = [];
  const result = await installRasterizer({ dataDir, runner: fakeRunner({ log }), probe: async () => {} });
  assert.equal(result.ok, true);
  assert.equal(log.length, 0);
});

test('installRasterizer installs again when only one of the pinned packages is missing', async () => {
  const dataDir = tempData();
  writeFakePackage(toolsDirOf(dataDir), RESVG);
  const log = [];
  const result = await installRasterizer({ dataDir, runner: fakeRunner({ log }), probe: async () => {} });
  assert.equal(result.ok, true);
  assert.equal(log.length, 1);
});

test('installRasterizer reports install-failed when a pinned package is still missing after npm', async () => {
  const dataDir = tempData();
  const runner = async (cmd, args) => {
    writeFakePackage(args[args.indexOf('--prefix') + 1], RESVG);
    return { code: 0, stdout: '', stderr: '' };
  };
  const result = await installRasterizer({ dataDir, runner, probe: async () => {} });
  assert.deepEqual([result.ok, result.reason], [false, 'install-failed']);
  assert.match(result.message, /@jsquash\/webp@1\.5\.0 was not installed \(found nothing\)/);
});

test('installRasterizer reports npm-missing when npm cannot be started', async () => {
  const result = await installRasterizer({ dataDir: tempData(), runner: fakeRunner({ code: 127 }), probe: async () => {} });
  assert.deepEqual([result.ok, result.reason], [false, 'npm-missing']);
});

test('installRasterizer reports install-failed with the npm message when npm fails', async () => {
  const result = await installRasterizer({
    dataDir: tempData(),
    runner: fakeRunner({ code: 1, stderr: 'ETIMEDOUT\nregistry' }),
    probe: async () => {},
  });
  assert.deepEqual([result.ok, result.reason], [false, 'install-failed']);
  assert.equal(result.message, 'npm install @resvg/resvg-js@2.6.2 @jsquash/webp@1.5.0 failed: ETIMEDOUT registry');
});

test('installRasterizer reports install-failed when the installed version is not the pinned one', async () => {
  const result = await installRasterizer({
    dataDir: tempData(),
    runner: fakeRunner({ version: '2.5.0' }),
    probe: async () => {},
  });
  assert.deepEqual([result.ok, result.reason], [false, 'install-failed']);
});

test('installRasterizer reports load-failed when the installed package does not load', async () => {
  const dataDir = tempData();
  fakeInstall(dataDir);
  const result = await installRasterizer({
    dataDir,
    runner: fakeRunner(),
    probe: async () => { throw new Error('no native binding'); },
  });
  assert.deepEqual([result.ok, result.reason], [false, 'load-failed']);
  assert.equal(result.message, 'no native binding');
});

test('encodeRgbaPng writes a PNG of colour type 6 whose pixels read back unchanged', () => {
  const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 8, 7, 6]);
  const png = encodeRgbaPng(2, 2, rgba);
  assert.deepEqual(pngSize(png), { width: 2, height: 2 });
  assert.equal(png[25], 6, 'colour type RGBA');
  const back = decodePngRgba(png);
  assert.deepEqual(back.rgba, Buffer.from(rgba));
  assert.throws(() => encodeRgbaPng(2, 2, new Uint8Array(3)), /png-data/);
  assert.throws(() => encodeRgbaPng(0, 2, new Uint8Array(0)), /png-size/);
});

test('prepareSvgImages returns the SVG unchanged, without loading anything, when it has no absolute WebP href', async () => {
  const workDir = tempData();
  const plain = `<svg><image href="assets/styles/x.png"/><image href="${TEXTURE.replace(/\.webp$/, '.png')}"/></svg>`;
  const relative = '<svg><pattern><image href="textures/deep-sea.webp"/></pattern></svg>';
  let loaded = false;
  const loader = async () => { loaded = true; return {}; };
  assert.equal(await prepareSvgImages(plain, { workDir, loader }), plain);
  assert.equal(await prepareSvgImages(relative, { workDir, loader }), relative);
  assert.equal(loaded, false);
});

test('prepareSvgImages keeps the href of a WebP that does not exist', async () => {
  const workDir = tempData();
  const missing = path.join(tempData(), 'gone.webp');
  const svg = `<svg><image href="${missing}"/></svg>`;
  assert.equal(await prepareSvgImages(svg, { workDir, loader: async () => { throw new Error('not loaded'); }, dataDir: tempData() }), svg);
});

test('prepareSvgImages rewrites every WebP href (href and xlink:href, images and patterns) to a PNG, decoding each file once', async () => {
  const dataDir = tempData();
  fakeInstall(dataDir);
  const folder = path.join(tempData(), 'a&b');
  fs.mkdirSync(folder);
  const file = path.join(folder, 'texture.webp');
  fs.writeFileSync(file, Buffer.from('RIFF-not-really-a-webp-but-the-fake-decodes-it'));
  const svg = `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><defs><pattern id="p"><image href="${file.replace(/&/g, '&amp;')}"/></pattern></defs>`
    + `<image xlink:href="${file.replace(/&/g, '&amp;')}"/><image href="${file}"/></svg>`;
  const workDir = tempData();
  const decodes = [];
  const loader = async () => fakeWebpModule(decodes);
  const out = await prepareSvgImages(svg, { workDir, loader, dataDir });
  assert.deepEqual(decodes, [fs.statSync(file).size], 'the file is decoded once');
  const hrefs = [...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(hrefs.length, 3);
  for (const href of hrefs) {
    assert.match(href, /\.png$/);
    assert.ok(path.dirname(href) === workDir || href.startsWith(`${workDir}${path.sep}`), href);
  }
  assert.equal(new Set(hrefs).size, 1);
  const targetFile = hrefs[0].replace(/&amp;/g, '&');
  const png = fs.readFileSync(targetFile);
  const back = decodePngRgba(png);
  assert.deepEqual([back.width, back.height], [2, 1]);
  assert.deepEqual(Array.from(back.rgba), [1, 2, 3, 255, 4, 5, 6, 128]);
  assert.match(path.basename(targetFile), /^[0-9a-f]{8}\.png$/);
});

test('prepareSvgImages throws webp-decode with the file name when a WebP cannot be decoded', async () => {
  const dataDir = tempData();
  fakeInstall(dataDir);
  const file = path.join(tempData(), 'broken.webp');
  fs.writeFileSync(file, 'broken');
  await assert.rejects(
    prepareSvgImages(`<svg><image href="${file}"/></svg>`, { workDir: tempData(), loader: async () => fakeWebpModule([], { fail: true }), dataDir }),
    (err) => err.code === 'webp-decode' && err.message.includes('broken.webp') && /corrupt file/.test(err.message),
  );
});

test('prepareSvgImages throws rasterizer-unavailable when the WebP decoder is not installed', async () => {
  const file = path.join(tempData(), 'texture.webp');
  fs.writeFileSync(file, 'bytes');
  await assert.rejects(
    prepareSvgImages(`<svg><image href="${file}"/></svg>`, { workDir: tempData(), loader: async () => fakeWebpModule(), dataDir: tempData() }),
    (err) => err.code === 'rasterizer-unavailable',
  );
});
