import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Ctx } from '../context.js';
import { createArchive } from './archive.js';
import { CampaignCategories, loadCategoryEntries } from './categories.js';
import { contextFor, copyFixture, removeCampaign, waitFor } from './test-support.js';

let root: string;
let ctx: Ctx;
let archive: ReturnType<typeof createArchive>;
const logs: string[] = [];

before(async () => {
  root = await copyFixture();
  ctx = contextFor(root, logs);
  const categories = new CampaignCategories();
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

describe('cockpit archive', () => {
  it('holds the documents with the category ids of campaign.yaml', () => {
    const docs = archive.docs;
    assert.equal(docs.get('Personaggi/Oria Valdes.md')?.category, 'personaggi');
    assert.equal(docs.get('Creature/Verme di brace.md')?.category, 'creature');
    assert.equal(docs.get('Oggetti/Lanterna di Morvalle.md')?.category, 'oggetti');
    assert.equal(docs.get('Mondo/Morvalle/Morvalle.md')?.category, 'luoghi');
    assert.equal(docs.get('Giocatori/Neri Calce.md')?.category, 'giocatori');
    assert.equal(docs.get('Seme del mondo.md')?.category, '');
    assert.equal(docs.get('Giocatori/Neri Calce.md')?.master, true);
  });

  it('builds the detail the cockpit reads: title, area, headings with lines, raw body', () => {
    const doc = archive.docs.get('Mondo/Morvalle/Borgo Cenere/Torre dell’Ascia.md');
    assert.ok(doc, 'the nested place is in the archive');
    assert.equal(doc.category, 'luoghi');
    assert.equal(doc.area, 'Morvalle / Borgo Cenere');
    assert.ok(doc.title.length > 0);
    assert.ok(doc.headings.length > 0);
    const lines = doc.raw.split('\n');
    for (const heading of doc.headings) {
      assert.match(lines[heading.line - 1] ?? '', /^#{1,6}\s/, `line ${heading.line} is a heading`);
      assert.ok(heading.id.length > 0);
    }
  });

  it('finds a known title through the docs search, with the category filter applied', () => {
    const result = archive.search('Lanterna di Morvalle');
    assert.ok(result.total >= 1);
    assert.equal(result.hits[0]?.path, 'Oggetti/Lanterna di Morvalle.md');
    assert.equal(result.hits[0]?.category, 'oggetti');
    assert.ok(archive.search('Lanterna', 'oggetti').total >= 1);
    assert.equal(archive.search('Lanterna', 'luoghi').total, 0);
    assert.deepEqual(archive.search('   ').hits, []);
  });

  it('changes the version after a write and finds the new document after refresh', async () => {
    const before = archive.version();
    await fs.mkdir(path.join(root, 'Storia'), { recursive: true });
    await fs.writeFile(path.join(root, 'Storia', 'Ponte sospeso.md'), '# Ponte sospeso\n\nUn ponte di corde sul torrente.\n');
    await archive.refresh();
    assert.notEqual(archive.version(), before);
    assert.equal(archive.docs.get('Storia/Ponte sospeso.md')?.category, 'storia');
    assert.equal(archive.search('Ponte sospeso').hits[0]?.path, 'Storia/Ponte sospeso.md');
  });

  it('follows a change on disk without an explicit refresh (watcher)', async () => {
    const before = archive.version();
    await fs.writeFile(path.join(root, 'Storia', 'Torrente.md'), '# Torrente\n\nAcqua fredda.\n');
    const changed = await waitFor(() => archive.version() !== before, 8000);
    assert.equal(changed, true);
    assert.ok(archive.docs.has('Storia/Torrente.md'));
  });
});
