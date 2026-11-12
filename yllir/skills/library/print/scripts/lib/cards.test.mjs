import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  cardCategories, characterCategory, plainText, sectionBody, cardText, titleOf, imageBase,
  collectCards, selectCards, printStateOf, buildJob, readCardSheet, loadCardImages,
} from './cards.mjs';
import { readPrintSettings, normalizeBaseUrl, entryUrl } from './settings.mjs';
import { objectSheet, makeCampaign, removeCampaign } from './fixtures.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';

const structure = [
  { id: 'objects', folder: 'Oggetti', type: 'objects', cards: true },
  { id: 'plain', folder: 'Altro', type: 'objects' },
  { id: 'secret', folder: 'Segreti', type: 'master-only' },
  { id: 'characters', folder: 'Giocatori', type: 'master-only' },
];

test('card categories are objects categories with cards: true', () => {
  assert.deepEqual(cardCategories(structure).map((c) => c.folder), ['Oggetti']);
  assert.deepEqual(cardCategories([{ id: 'x', folder: 'X/', type: 'places', cards: true }]), []);
  assert.deepEqual(cardCategories([{ id: 'x', folder: 'X', type: 'objects', cards: false }]), []);
});

test('the characters category is found by id or by folder name', () => {
  assert.equal(characterCategory(structure), 'Giocatori');
  assert.equal(characterCategory([{ id: 'players', folder: 'PG', type: 'master-only' }]), 'PG');
  assert.equal(characterCategory([{ id: 'objects', folder: 'Oggetti', type: 'objects' }]), null);
});

test('plain text drops links, emphasis, headings and comments', () => {
  const text = plainText('# T\n\n*Lanterna* di [ottone](x.md) e ![pic](img/a.png)\nseconda riga\n\n> citazione\n- punto');
  assert.equal(text, 'T\n\nLanterna di ottone e seconda riga\n\ncitazione punto');
  assert.equal(plainText('<!-- nota -->  '), '');
});

test('section body stops at the next level-2 heading and ignores level 3', () => {
  const md = '# T\n## In breve\nuno\n### sotto\ndue\n## Descrizione\ntre\n';
  assert.equal(sectionBody(md, ['in breve']), 'uno\n### sotto\ndue');
  assert.equal(sectionBody(md, ['sotto']), null);
});

test('the card text is In breve, falls back to Descrizione, then empty', () => {
  assert.deepEqual(cardText('## In breve\nBreve.\n## Descrizione\nLunga.'), { text: 'Breve.', source: 'in-breve' });
  assert.deepEqual(cardText('## Descrizione\nLunga.'), { text: 'Lunga.', source: 'descrizione' });
  assert.deepEqual(cardText('## In brief\nShort.'), { text: 'Short.', source: 'in-breve' });
  assert.deepEqual(cardText('## In breve\n\n## Descrizione\n'), { text: '', source: null });
});

test('title and image base names', () => {
  assert.equal(titleOf('intro\n# Lanterna da bordo\n## In breve'), 'Lanterna da bordo');
  assert.equal(titleOf('## Solo sezione'), null);
  assert.equal(imageBase("Lanterna da bordo's.md"), 'lanterna-da-bordo-s');
  assert.equal(imageBase('Città di Selce.md'), 'citta-di-selce');
});

test('print state accepts the three values only', () => {
  assert.equal(printStateOf({ print: 'to-print' }), 'to-print');
  assert.equal(printStateOf({ print: 'done' }), null);
  assert.equal(printStateOf({}), null);
});

test('selection matrix: which sheets are cards and why the others are excluded', () => {
  const root = makeCampaign({
    sheets: {
      'Oggetti/Lanterna.md': objectSheet({ id: 'lanterna', title: 'Lanterna', shortText: 'Breve.', print: 'to-print' }),
      'Oggetti/Bussola.md': objectSheet({ id: 'bussola', title: 'Bussola', longText: 'Solo descrizione.', print: 'reprint' }),
      'Oggetti/Avviso.md': objectSheet({ id: 'avviso', title: 'Avviso', template: 'notice', shortText: 'Taglia.', print: 'to-print' }),
      'Oggetti/Vuota.md': objectSheet({ id: 'vuota', title: 'Vuota' }),
      'Oggetti/Senza id.md': '# Senza id\n\n## In breve\n\nTesto.\n',
      'Oggetti/Doppia 1.md': objectSheet({ id: 'doppia', title: 'Doppia 1', shortText: 'A.' }),
      'Oggetti/Doppia 2.md': objectSheet({ id: 'doppia', title: 'Doppia 2', shortText: 'B.' }),
      'Oggetti/Ritirata.md': objectSheet({ id: 'ritirata', title: 'Ritirata', shortText: 'C.' }),
      'Oggetti/Personale.md': objectSheet({ id: 'personale', title: 'Personale', shortText: 'Per il PG.', personal: true }),
      'Altro/Non carta.md': objectSheet({ id: 'non-carta', title: 'Non carta', shortText: 'No.' }),
      'Segreti/Segreto.md': objectSheet({ id: 'segreto', title: 'Segreto', shortText: 'No.' }),
    },
    extraFiles: {
      '.campaign/retired-ids.json': '{ "ids": ["ritirata"] }\n',
    },
  });
  try {
    const settings = readPrintSettings(parseConfig(root));
    const { records, errors } = collectCards(root, settings);
    assert.deepEqual(errors, []);
    const byPath = Object.fromEntries(records.map((r) => [r.path, r]));
    assert.equal(byPath['Oggetti/Lanterna.md'].reason, null);
    assert.equal(byPath['Oggetti/Lanterna.md'].text, 'Breve.');
    assert.equal(byPath['Oggetti/Bussola.md'].reason, null);
    assert.equal(byPath['Oggetti/Bussola.md'].textSource, 'descrizione');
    assert.equal(byPath['Oggetti/Avviso.md'].reason, null, 'a notice is a card too');
    assert.equal(byPath['Oggetti/Vuota.md'].reason, 'no-public-text');
    assert.equal(byPath['Oggetti/Senza id.md'].reason, 'no-id');
    assert.equal(byPath['Oggetti/Doppia 1.md'].reason, 'duplicate-id');
    assert.equal(byPath['Oggetti/Doppia 2.md'].reason, 'duplicate-id');
    assert.equal(byPath['Oggetti/Ritirata.md'].reason, 'retired-id');
    assert.equal(byPath['Oggetti/Personale.md'].personal, true);
    assert.equal(byPath['Oggetti/Personale.md'].reason, null);
    assert.equal(byPath['Altro/Non carta.md'], undefined, 'a category without cards: true is not a card category');
    assert.equal(byPath['Segreti/Segreto.md'], undefined, 'a master-only folder is not a card category');

    const toPrint = selectCards({ records, ids: null, copies: {}, personalCopies: 3 });
    assert.deepEqual(toPrint.selected.map((s) => s.record.id).sort(), ['avviso', 'bussola', 'lanterna']);
    assert.deepEqual(toPrint.excluded, [], 'only to-print and reprint are considered; the Vuota card has no state');
  } finally {
    removeCampaign(root);
  }
});

test('exclusions are listed with a plain reason when cards are requested by id', () => {
  const root = makeCampaign({
    sheets: {
      'Oggetti/Vuota.md': objectSheet({ id: 'vuota', title: 'Vuota' }),
      'Oggetti/Lanterna.md': objectSheet({ id: 'lanterna', title: 'Lanterna', shortText: 'Breve.' }),
    },
  });
  try {
    const { records } = collectCards(root, readPrintSettings(parseConfig(root)));
    const result = selectCards({ records, ids: ['vuota', 'lanterna', 'manca'], copies: {}, personalCopies: 1 });
    assert.deepEqual(result.excluded, [
      { id: 'vuota', reason: 'no-public-text' },
      { id: 'manca', reason: 'not-found' },
    ]);
    assert.deepEqual(result.selected.map((s) => [s.record.id, s.copies]), [['lanterna', 1]]);
  } finally {
    removeCampaign(root);
  }
});

test('copies: explicit counts win, personal cards default to the personal count', () => {
  const base = (id, personal) => ({ id, path: `Oggetti/${id}.md`, reason: null, print: 'to-print', personal });
  const records = [base('a', false), base('b', true)];
  const result = selectCards({ records, ids: null, copies: { b: 4 }, personalCopies: 3 });
  assert.deepEqual(result.selected.map((s) => [s.record.id, s.copies]), [['a', 1], ['b', 4]]);
  const defaulted = selectCards({ records, ids: null, copies: {}, personalCopies: 3 });
  assert.deepEqual(defaulted.selected.map((s) => s.copies), [1, 3]);
});

test('the job file holds only public data and the output paths', () => {
  const root = makeCampaign({
    sheets: { 'Oggetti/Lanterna.md': objectSheet({ id: 'lanterna', title: 'Lanterna', shortText: 'Breve.', master: 'SEGRETO-DEL-MASTER' }) },
  });
  try {
    const settings = readPrintSettings(parseConfig(root));
    const { records } = collectCards(root, settings);
    const job = buildJob(records[0], settings);
    const text = JSON.stringify(job);
    assert.equal(job.text, 'Breve.');
    assert.equal(job.output.png, 'Oggetti/img/lanterna.png');
    assert.equal(job.output.psd, 'Oggetti/img/lanterna.psd');
    assert.equal(job.entryUrl, 'http://localhost/e/lanterna/');
    assert.ok(!text.includes('SEGRETO-DEL-MASTER'), 'master-only text never reaches the job');
  } finally {
    removeCampaign(root);
  }
});

test('image files: a PNG is the face, a JPEG is an illustration', () => {
  const root = makeCampaign({
    sheets: { 'Oggetti/Lanterna.md': objectSheet({ id: 'lanterna', title: 'Lanterna', shortText: 'Breve.' }) },
  });
  try {
    const dir = path.join(root, 'Oggetti', 'img');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'lanterna.jpeg'), Buffer.from([0xff, 0xd8, 0xff]));
    const record = readCardSheet(root, 'Oggetti/Lanterna.md', { folder: 'Oggetti' });
    assert.equal(record.face, null);
    assert.equal(record.illustration, 'Oggetti/img/lanterna.jpeg');
    fs.writeFileSync(path.join(dir, 'lanterna.png'), Buffer.from([0x89, 0x50]));
    const withFace = readCardSheet(root, 'Oggetti/Lanterna.md', { folder: 'Oggetti' });
    assert.equal(withFace.face, 'Oggetti/img/lanterna.png');
    const images = loadCardImages(root, withFace);
    assert.equal(images.face.length, 2);
    assert.equal(images.illustration.length, 3);
  } finally {
    removeCampaign(root);
  }
});

test('settings: defaults, invalid values fall back with a warning, base address normalised', () => {
  const plain = readPrintSettings({});
  assert.deepEqual(
    { format: plain.format, cmyk: plain.cmyk, renderer: plain.renderer, baseUrl: plain.baseUrl },
    { format: '5x7', cmyk: false, renderer: 'auto', baseUrl: 'http://localhost/' },
  );
  const bad = readPrintSettings({ print: { format: 'letter', cmyk: 'yes', renderer: 'x' }, encyclopedia: { base_url: 'ftp://x' } });
  assert.equal(bad.format, '5x7');
  assert.equal(bad.warnings.length, 4);
  assert.equal(normalizeBaseUrl('https://example.org/site'), 'https://example.org/site/');
  assert.equal(normalizeBaseUrl('https://example.org/?q=1'), null);
  assert.equal(normalizeBaseUrl('https://example.org/#x'), null);
  assert.equal(entryUrl('https://example.org/site/', 'lanterna-da-bordo'), 'https://example.org/site/e/lanterna-da-bordo/');
});

function parseConfig(root) {
  return parseYamlLite(fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8')).data;
}
