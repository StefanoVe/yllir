import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Detail } from '../cockpit/ports.js';
import type { Ctx } from '../context.js';
import { createArchive } from './archive.js';
import { CampaignCategories, loadCategoryEntries } from './categories.js';
import { listImageAssets } from './images.js';
import { listMapAssets } from './maps.js';
import { contextFor, copyFixture, removeCampaign } from './test-support.js';

let root: string;
let ctx: Ctx;
let archive: ReturnType<typeof createArchive>;
let categories: CampaignCategories;

before(async () => {
  root = await copyFixture();
  const img = path.join(root, 'Oggetti', 'img');
  await fs.mkdir(img, { recursive: true });
  for (const name of ['lanterna-thumbnail.png', 'lanterna.jpg', 'taverna-map.png', 'taverna-map-grid.png']) {
    await fs.writeFile(path.join(img, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  // The item sheet shows its thumbnail to the players: the image is an item card for players.
  await fs.appendFile(path.join(root, 'Oggetti', 'Lanterna di Morvalle.md'), '\n![Lanterna](img/lanterna-thumbnail.png)\n');
  ctx = contextFor(root);
  categories = new CampaignCategories();
  archive = createArchive(ctx, categories, async () => {
    categories.load(await loadCategoryEntries(ctx));
  });
  await archive.idle();
});

after(async () => {
  await archive.close();
  await ctx.closeAll();
  await removeCampaign(root);
});

describe('cockpit images', () => {
  it('lists every raster image with its kind, variant, documents and audience', async () => {
    const docs: Detail[] = [...archive.docs.values()];
    const maps = await listMapAssets(root, docs, (rel) => categories.folderOf(rel));
    const images = await listImageAssets(root, docs, maps, (rel) => categories.folderOf(rel));
    assert.ok(Array.isArray(images));

    const card = images.find((image) => image.path === 'Oggetti/img/lanterna-thumbnail.png');
    assert.ok(card);
    assert.equal(card.kind, 'card');
    assert.equal(card.audience, 'players');
    assert.deepEqual(card.docs, [{ path: 'Oggetti/Lanterna di Morvalle.md', title: 'Lanterna di Morvalle' }]);

    const plain = images.find((image) => image.path === 'Oggetti/img/lanterna.jpg');
    assert.ok(plain);
    assert.equal(plain.kind, 'image');
    assert.equal(plain.audience, 'master');

    const noGrid = images.find((image) => image.path === 'Oggetti/img/taverna-map.png');
    assert.equal(noGrid?.variant, 'senza griglia');
    assert.equal(images.find((image) => image.path === 'Oggetti/img/taverna-map-grid.png')?.kind, 'battlemap');
  });

  it('keeps the card of a document as its thumbnail', () => {
    assert.equal(archive.docs.get('Oggetti/Lanterna di Morvalle.md')?.card, 'Oggetti/img/lanterna-thumbnail.png');
  });
});
