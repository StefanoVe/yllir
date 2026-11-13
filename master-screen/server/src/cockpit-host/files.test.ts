import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resolveCampaignFile } from '../docs/scan.js';
import { setExternalFrameworkRoot } from '../docs/external.js';
import { REAL_FRAMEWORK, worldFixture, type WorldFixture } from '../docs/test-support.js';
import { listRasterImages } from './files.js';

let fixture: WorldFixture;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

before(async () => {
  setExternalFrameworkRoot(REAL_FRAMEWORK);
  fixture = await worldFixture();
  const img = path.join(fixture.world, 'Luoghi', 'img');
  await fs.mkdir(img, { recursive: true });
  await fs.writeFile(path.join(img, 'raatnagar-mappa.png'), PNG);
  await fs.mkdir(path.join(fixture.world, 'Luoghi', '.cache'), { recursive: true });
  await fs.writeFile(path.join(fixture.world, 'Luoghi', '.cache', 'hidden.png'), PNG);
  // A link inside the world back to its own img folder: each real directory is entered once.
  await fs.symlink(img, path.join(fixture.world, 'Luoghi', 'again'));
  // Links that leave the world or the campaign: never listed, never served.
  await fs.writeFile(path.join(fixture.outside, 'secret.png'), PNG);
  await fs.symlink(path.join(fixture.outside, 'secret.png'), path.join(img, 'alias-secret.png'));
  await fs.symlink(path.join(fixture.outside, 'secret.png'), path.join(fixture.campaign, 'linked.png'));
});

after(async () => {
  setExternalFrameworkRoot(null);
  await fs.rm(fixture.base, { recursive: true, force: true });
});

describe('listRasterImages', () => {
  it('lists the images of an external folder through its link, once, and nothing reached by a foreign link', async () => {
    const rels = (await listRasterImages(fixture.campaign)).map((file) => file.rel);
    // The image is listed once, under one of its two paths (the link back to img/ is not entered again).
    const images = rels.filter((rel) => rel.endsWith('raatnagar-mappa.png'));
    assert.equal(images.length, 1, rels.join(', '));
    assert.ok(images[0]!.startsWith('shared/Luoghi/'));
    assert.deepEqual(rels, rels.slice().sort());
    assert.equal(rels.length, 1, rels.join(', '));
    assert.equal(rels.some((rel) => rel.includes('.cache') || rel.includes('alias-secret') || rel.includes('linked')), false);
  });

  it('keeps symlinks ignored outside external folders', async () => {
    const plain = path.join(fixture.base, 'plain');
    await fs.mkdir(path.join(plain, 'Oggetti'), { recursive: true });
    await fs.writeFile(path.join(plain, 'Oggetti', 'lanterna.png'), PNG);
    await fs.symlink(fixture.outside, path.join(plain, 'linkdir'));
    await fs.symlink(path.join(fixture.outside, 'secret.png'), path.join(plain, 'linked.png'));
    const rels = (await listRasterImages(plain)).map((file) => file.rel);
    assert.deepEqual(rels, ['Oggetti/lanterna.png']);
  });
});

describe('serving an external image', () => {
  it('resolves an image of an external folder, and refuses a link that leaves the external folder', async () => {
    const resolved = await resolveCampaignFile(fixture.campaign, 'shared/Luoghi/img/raatnagar-mappa.png');
    assert.deepEqual(resolved, {
      abs: await fs.realpath(path.join(fixture.world, 'Luoghi', 'img', 'raatnagar-mappa.png')),
      rel: 'shared/Luoghi/img/raatnagar-mappa.png',
    });
    assert.equal(await resolveCampaignFile(fixture.campaign, 'shared/Luoghi/img/alias-secret.png'), null);
    assert.equal(await resolveCampaignFile(fixture.campaign, 'linked.png'), null);
  });
});
