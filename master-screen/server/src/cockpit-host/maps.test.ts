import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Detail } from '../cockpit/ports.js';
import type { Ctx } from '../context.js';
import { createArchive } from './archive.js';
import { CampaignCategories, loadCategoryEntries } from './categories.js';
import { listMapAssets } from './maps.js';
import { contextFor, copyFixture, removeCampaign } from './test-support.js';

let root: string;
let ctx: Ctx;
let docs: Detail[];
let archive: ReturnType<typeof createArchive>;

before(async () => {
  root = await copyFixture();
  const img = path.join(root, 'Mondo', 'Morvalle', 'img');
  await fs.mkdir(img, { recursive: true });
  // A world map named by its stem, a battle map made by the images skill (grid and no-grid), a
  // plain portrait, and a thumbnail that is not a map.
  for (const name of ['valle-mappa.png', 'taverna-map.png', 'taverna-map-grid.png', 'ritratto-oria.png', 'lanterna-thumbnail.png']) {
    await fs.writeFile(path.join(img, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  ctx = contextFor(root);
  const categories = new CampaignCategories();
  archive = createArchive(ctx, categories, async () => {
    categories.load(await loadCategoryEntries(ctx));
  });
  await archive.idle();
  docs = [...archive.docs.values()];
});

after(async () => {
  await archive.close();
  await ctx.closeAll();
  await removeCampaign(root);
});

describe('cockpit maps', () => {
  it('lists named maps as Mappa and skill battle maps as Battlemap, through the file route', async () => {
    const categories = new CampaignCategories();
    categories.load(await loadCategoryEntries(ctx));
    const maps = await listMapAssets(root, docs, (rel) => categories.folderOf(rel));
    const byPath = new Map(maps.map((map) => [map.path, map]));

    const world = byPath.get('Mondo/Morvalle/img/valle-mappa.png');
    assert.ok(world, 'the named map is listed');
    assert.equal(world.category, 'Mappa');
    assert.equal(world.format, 'PNG');
    assert.equal(world.src, '/api/file?path=' + encodeURIComponent('Mondo/Morvalle/img/valle-mappa.png'));
    assert.equal(world.area, 'Morvalle');

    const battle = byPath.get('Mondo/Morvalle/img/taverna-map-grid.png');
    assert.ok(battle, 'the grid battle map is listed');
    assert.equal(battle.category, 'Battlemap');
    assert.equal(battle.title, 'Taverna');

    assert.equal(byPath.has('Mondo/Morvalle/img/taverna-map.png'), false, 'the no-grid twin is not a map of its own');
    assert.equal(byPath.has('Mondo/Morvalle/img/ritratto-oria.png'), false);
    assert.equal(byPath.has('Mondo/Morvalle/img/lanterna-thumbnail.png'), false);
  });
});
