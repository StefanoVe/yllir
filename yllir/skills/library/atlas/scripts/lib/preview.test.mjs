// Tests of preview.mjs. Run: node --test yllir/skills/library/atlas/scripts/lib/preview.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { renderPreview } from './preview.mjs';
import { decodePng, newImage, writePngFile } from './image.mjs';
import { cleanupCampaigns, makeCampaign, writeAtlas, baseManifest } from './test-support.mjs';

after(cleanupCampaigns);

const W = 120;
const H = 90;

/** A campaign with a 120x90 base picture and a land mask; no labels, no places. */
function previewCampaign() {
  const root = makeCampaign({});
  writeAtlas(root, { manifest: baseManifest({ canvas: { width: W, height: H } }), labels: null, pictures: [] });
  const dir = path.join(root, 'Atlas');
  writePngFile(path.join(dir, 'base.png'), newImage(W, H, [200, 190, 160, 255]));
  writePngFile(path.join(dir, 'land.png'), newImage(W, H, [255, 255, 255, 255]));
  return root;
}

test('without the rasterizer the preview is the base picture resized to the width', async () => {
  const root = previewCampaign();
  const result = await renderPreview(root, { width: 1024, dataDir: path.join(root, 'no-such-tools-folder') });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.withLabels, false);
  assert.equal(result.out, '.campaign/cache/atlas/preview.png');
  const png = decodePng(fs.readFileSync(path.join(root, result.out)));
  assert.equal(png.width, 1024);
  assert.equal(png.height, Math.round((H * 1024) / W));
});

test('a preview of a campaign with no valid atlas is refused, and nothing is written', async () => {
  const root = makeCampaign({});
  const result = await renderPreview(root, { width: 256, dataDir: path.join(root, 'no-such-tools-folder') });
  assert.equal(result.ok, false);
  assert.equal(result.out, null);
  assert.ok(result.problems.length > 0);
  assert.equal(fs.existsSync(path.join(root, '.campaign', 'cache', 'atlas', 'preview.png')), false);
});

test('the fallback keeps the aspect ratio at another width', async () => {
  const root = previewCampaign();
  const result = await renderPreview(root, { width: 300, dataDir: path.join(root, 'no-such-tools-folder') });
  assert.equal(result.ok, true);
  const png = decodePng(fs.readFileSync(path.join(root, result.out)));
  assert.equal(png.width, 300);
  assert.equal(png.height, Math.round((H * 300) / W));
});
