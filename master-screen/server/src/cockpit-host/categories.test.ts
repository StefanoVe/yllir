import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Ctx } from '../context.js';
import { CampaignCategories, categoryEntries, externalKindOf, isSessionFile, kindOfCategory, loadCategoryEntries } from './categories.js';
import { contextFor, copyFixture, removeCampaign } from './test-support.js';

let root: string;
let ctx: Ctx;
let categories: CampaignCategories;

before(async () => {
  root = await copyFixture();
  ctx = contextFor(root);
  categories = new CampaignCategories();
  categories.load(await loadCategoryEntries(ctx));
});

after(async () => {
  await ctx.closeAll();
  await removeCampaign(root);
});

describe('campaign categories', () => {
  it('maps the fixture folders to npc, enemy, item, location and pc', () => {
    assert.equal(categories.kindOf('Personaggi/Oria Valdes.md'), 'npc');
    assert.equal(categories.kindOf('Creature/Verme di brace.md'), 'enemy');
    assert.equal(categories.kindOf('Oggetti/Lanterna di Morvalle.md'), 'item');
    assert.equal(categories.kindOf('Mondo/Morvalle/Morvalle.md'), 'location');
    assert.equal(categories.kindOf('Giocatori/Neri Calce.md'), 'pc');
  });

  it('maps plot, session and lore files of the fixture', () => {
    assert.equal(categories.kindOf('Trama/Sessione 1/Sessione 1.md'), 'session');
    assert.equal(categories.kindOf('Trama/Sessione 1/Eventi/La strada verso la valle.md'), 'session');
    assert.equal(categories.kindOf('Cronaca/2026-10-03.md'), 'session');
    assert.equal(categories.kindOf('Storia/Voce del Pozzo.md'), 'lore');
  });

  it('answers other for paths outside every category', () => {
    assert.equal(categories.kindOf('Seme del mondo.md'), 'other');
    assert.equal(categories.kindOf('Appunti/Idee.md'), 'other');
  });

  it('gives the folders for each kind and the players folder', () => {
    assert.equal(categories.folderFor('npc'), 'Personaggi');
    assert.equal(categories.folderFor('enemy'), 'Creature');
    assert.equal(categories.folderFor('item'), 'Oggetti');
    assert.equal(categories.folderFor('location'), 'Mondo');
    assert.equal(categories.playersFolder(), 'Giocatori');
  });

  it('matches English ids and types, and leaves unknown subjects as other', () => {
    assert.equal(kindOfCategory({ id: 'characters', folder: 'People', type: 'subjects' }), 'npc');
    assert.equal(kindOfCategory({ id: 'monsters', folder: 'Beasts', type: 'subjects' }), 'enemy');
    assert.equal(kindOfCategory({ id: 'vault', folder: 'Vault', type: 'places' }), 'location');
    assert.equal(kindOfCategory({ id: 'x', folder: 'X', type: 'subjects' }), 'other');
    const table = new CampaignCategories();
    table.load(categoryEntries([{ id: 'x', folder: 'X/', type: 'subjects' }, 'bad', { folder: '.' }]));
    assert.equal(table.kindOf('X/a.md'), 'other');
    assert.equal(table.folderFor('npc'), null);
  });

  it('recognises session files by their own folder or an Eventi folder', () => {
    assert.equal(isSessionFile('Sessione 2/Sessione 2.md'), true);
    assert.equal(isSessionFile('Sessione 2/Eventi/Verso il pozzo.md'), true);
    assert.equal(isSessionFile('Arco.md'), false);
  });
});

describe('external categories', () => {
  const table = new CampaignCategories();
  table.load(
    categoryEntries([
      { id: 'shared', folder: 'shared', type: 'external' },
      { id: 'characters', folder: 'Personaggi', type: 'subjects' },
    ]),
  );

  it('infers the kind of a document from the first sub-folder under the external folder, case-insensitive', () => {
    assert.equal(table.kindOf('shared/Luoghi/Raatnagar.md'), 'location');
    assert.equal(table.kindOf('shared/luoghi/img/x.md'), 'location');
    assert.equal(table.kindOf('shared/NPC/Mara.md'), 'npc');
    assert.equal(table.kindOf('shared/Mostri/Verme.md'), 'enemy');
    assert.equal(table.kindOf('shared/Objects/Lanterna.md'), 'item');
    assert.equal(table.kindOf('shared/Lore/Voce.md'), 'lore');
    assert.equal(table.kindOf('shared/Giocatori/Neri.md'), 'pc');
  });

  it('gives lore for an unknown sub-folder, for a file directly in the folder, and never plot or session', () => {
    assert.equal(table.kindOf('shared/Sconosciuta/x.md'), 'lore');
    assert.equal(table.kindOf('shared/Raatnagar.md'), 'lore');
    assert.equal(table.kindOf('shared/Trama/Arco.md'), 'lore');
    assert.equal(table.kindOf('shared/Cronaca/2026-10-03.md'), 'lore');
    assert.equal(externalKindOf('Sessioni'), 'lore');
    assert.equal(externalKindOf(undefined), 'lore');
  });

  it('marks the documents of an external folder, and never offers it for new sheets', () => {
    assert.equal(table.isExternal('shared/Luoghi/Raatnagar.md'), true);
    assert.equal(table.isExternal('Personaggi/Mara.md'), false);
    assert.equal(table.isExternal('Seme.md'), false);
    assert.equal(table.folderFor('location'), null);
    assert.equal(table.playersFolder(), null);
  });

  it('still answers other for a path outside the external folder', () => {
    assert.equal(table.kindOf('sharedx/Luoghi/a.md'), 'other');
    assert.equal(table.kindOf('linked.md'), 'other');
  });
});
