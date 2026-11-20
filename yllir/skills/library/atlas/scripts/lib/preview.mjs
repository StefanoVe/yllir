// Preview of the atlas as one picture, .campaign/cache/atlas/preview.png: the master's overlay (labels,
// borders) drawn over the base picture, rasterized with the installed tools. When the rasterizer is not
// available, the preview is the base picture alone, resized to the width, and says so (withLabels: false).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAtlas } from './model.mjs';
import { buildOverlaySvg } from './export.mjs';
import { imageFromFile, resizeImage, writePngFile } from './image.mjs';
import { rasterizeSvg } from './rasterize.mjs';
import { FONT_FILES } from './styles.mjs';

const ASSETS_DIR = fileURLToPath(new URL('../../assets/', import.meta.url));
const PREVIEW_FILE = path.posix.join('.campaign', 'cache', 'atlas', 'preview.png');

/**
 * Writes the preview picture of the campaign's atlas.
 * @param {string} root the campaign folder
 * @param {object} [options]
 * @param {number} [options.width=1024] the width of the picture in pixels
 * @param {string} [options.dataDir] the data folder of the rasterizer tools (default: the usual one)
 * @returns {Promise<{ ok: boolean, out: string|null, withLabels: boolean, problems: object[] }>}
 *   `out` is campaign-relative. `withLabels` is false when only the base picture was written.
 */
export async function renderPreview(root, { width = 1024, dataDir } = {}) {
  if (!Number.isInteger(width) || width < 1) throw new RangeError('width must be a whole number above zero');
  const refusal = (problems) => ({ ok: false, out: null, withLabels: false, problems });

  let overlay;
  try {
    overlay = buildOverlaySvg(root, { audience: 'master' });
  } catch (err) {
    return refusal(err.problems ?? [{ code: 'render', file: null, path: '', message: err.message }]);
  }

  const atlas = readAtlas(root);
  const baseFile = path.join(atlas.dir, atlas.manifest.base?.file ?? 'base.png');
  if (!fs.existsSync(baseFile)) return refusal([{ code: 'missing-file', file: null, path: 'base', message: 'the atlas has no base picture' }]);

  const out = path.join(root, PREVIEW_FILE);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const baseBytes = fs.readFileSync(baseFile);
  const fontFiles = Object.values(FONT_FILES).map((rel) => path.join(ASSETS_DIR, rel));
  try {
    const dataUri = `data:image/png;base64,${baseBytes.toString('base64')}`;
    const svg = overlay.svg.replace('href="assets/base.png"', `href="${dataUri}"`);
    const png = await rasterizeSvg(svg, { width, dataDir, fontFiles });
    fs.writeFileSync(out, png);
    return { ok: true, out: PREVIEW_FILE, withLabels: true, problems: [] };
  } catch {
    // The rasterizer is missing or failed: the base picture alone, at the same width.
    try {
      const base = imageFromFile(baseFile);
      const height = Math.max(1, Math.round((base.height * width) / base.width));
      writePngFile(out, resizeImage(base, width, height));
    } catch (err) {
      return refusal([{ code: 'bad-picture', file: null, path: 'base', message: err.message }]);
    }
    return { ok: true, out: PREVIEW_FILE, withLabels: false, problems: [] };
  }
}
