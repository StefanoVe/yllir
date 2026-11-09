import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTerms, searchCampaign, sourceClassFor } from './research-search.mjs';

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: luoghi',
  '    folder: Mondo',
  '    type: places',
  '  - id: personaggi',
  '    folder: Personaggi',
  '    type: subjects',
  '  - id: giocatori',
  '    folder: Giocatori',
  '    type: master-only',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '  - id: appunti',
  '    folder: Appunti',
  '    type: notes',
  '  - id: fonti',
  '    folder: Fonti',
  '    type: sources',
  '',
].join('\n');

const MASTER_BLOCK = ['<!-- master -->', '## Master', '', '### Segreto', 'Teodo ha il sigillo.', '<!-- /master -->', ''].join('\n');

const FILES = {
  // Line 9 is an alias hit ("Il Fabbro"); line 2 is the id, which also contains the word "teodo".
  'Personaggi/Teodo Marr.md': [
    '---',
    'id: teodo-marr',
    'aliases: [il Fabbro]',
    '---',
    '',
    '# Teodo Marr',
    '',
    'Teodo lavora alla forgia del borgo.',
    'Il Fabbro tace.',
    '',
    'Vedi [il pozzo](../Mondo/Pozzo%20di%20Nar.md) e [altrove](../Mondo/Nessuno.md) e [web](https://example.com).',
    '',
  ].join('\n'),
  // Two homonyms: both carry the alias "Oria".
  'Personaggi/Oria Brunel.md': [
    '---',
    'id: oria-brunel',
    'aliases: [Oria]',
    '---',
    '',
    '# Oria Brunel',
    '',
    'Oria Brunel parla poco.',
    '',
  ].join('\n'),
  'Personaggi/Oria Valdes.md': [
    '---',
    'id: oria-valdes',
    'aliases: [Oria]',
    '---',
    '',
    '# Oria Valdes',
    '',
    'Oria Valdes guarda il lago.',
    '',
  ].join('\n'),
  'Mondo/Pozzo di Nar.md': ['---', 'id: pozzo-di-nar', '---', '', '# Pozzo di Nar', '', 'Il pozzo risponde.', ''].join('\n'),
  // Line 1 is the title; the link on line 4 has an anchor and points at the sheet of Teodo.
  'Trama/Sessione 1.md': [
    '# Sessione 1',
    '',
    'Teodo entra in scena. Vedi [Teodo](../Personaggi/Teodo%20Marr.md#forgia).',
    "Teodore non c'entra.",
    '',
  ].join('\n'),
  // Master block lines are flagged even though the file is in a plot category.
  'Trama/Sessione 2.md': ['# Sessione 2', '', "La scena è pubblica.", '', MASTER_BLOCK].join('\n'),
  // The whole file is in a master-only category.
  'Giocatori/Neri Calce.md': ['---', 'id: neri-calce', '---', '', '# Neri Calce', '', 'Teodo deve un debito a Neri.', ''].join('\n'),
  'Appunti/Idee.md': ['# Idee', '', 'Teodo deve un favore al mugnaio.', ''].join('\n'),
  'Fonti/Libro.md': ['# Libro', '', 'Teodo appare in una cronaca antica.', ''].join('\n'),
};

const DOCUMENT_COUNT = 9;

/** Creates a temporary campaign folder (with campaign.yaml and the given files); returns its root. */
function makeCampaign(t, files = FILES) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'campaign');
  const all = { 'campaign.yaml': CAMPAIGN, ...files };
  for (const [rel, content] of Object.entries(all)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function hitAt(search, file, text) {
  return search.hits.find((hit) => hit.file === file && hit.text === text);
}

test('parseTerms splits on semicolons and drops blank terms', () => {
  assert.deepEqual(parseTerms(' Teodo ; ;il Fabbro;'), ['Teodo', 'il Fabbro']);
  assert.deepEqual(parseTerms(' ; '), []);
});

test('an alias finds its subject and the line that carries it', (t) => {
  const root = makeCampaign(t);
  const search = searchCampaign(root, ['il Fabbro']);
  assert.deepEqual(
    search.subjects.map((s) => s.id),
    ['teodo-marr'],
  );
  const hit = hitAt(search, 'Personaggi/Teodo Marr.md', 'Il Fabbro tace.');
  assert.ok(hit, 'alias line is a hit');
  assert.equal(hit.line, 9);
  assert.equal(hit.category, 'personaggi');
  assert.equal(hit.type, 'subjects');
  assert.equal(hit.source_class, 'canon');
  assert.equal(hit.master_only, false);
});

test('a term that contains a form of a subject matches that subject', (t) => {
  const root = makeCampaign(t);
  const search = searchCampaign(root, ['Il Fabbro tace']);
  assert.deepEqual(search.subjects.map((s) => s.id), ['teodo-marr']);
});

test('matches are whole words only', (t) => {
  const root = makeCampaign(t);
  const search = searchCampaign(root, ['Teodo']);
  assert.equal(hitAt(search, 'Trama/Sessione 1.md', "Teodore non c'entra."), undefined);
  assert.ok(hitAt(search, 'Trama/Sessione 1.md', "Teodo entra in scena. Vedi [Teodo](../Personaggi/Teodo%20Marr.md#forgia)."));
  assert.deepEqual(searchCampaign(root, ['Teodore']).hits.map((h) => h.text), ["Teodore non c'entra."]);
});

test('a homonym is reported with the subjects that share it', (t) => {
  const root = makeCampaign(t);
  const search = searchCampaign(root, ['Oria']);
  assert.deepEqual(search.subjects.map((s) => s.id), ['oria-brunel', 'oria-valdes']);
  assert.deepEqual(search.homonyms, [{ folded: 'oria', subjects: ['oria-brunel', 'oria-valdes'] }]);
});

test('a hit inside the master block is flagged, and so is a file in a master-only category', (t) => {
  const root = makeCampaign(t);
  const search = searchCampaign(root, ['Teodo']);
  const inBlock = hitAt(search, 'Trama/Sessione 2.md', 'Teodo ha il sigillo.');
  assert.ok(inBlock, 'master block line is searched');
  assert.equal(inBlock.line, 9);
  assert.equal(inBlock.master_only, true);
  assert.equal(hitAt(search, 'Trama/Sessione 2.md', 'La scena è pubblica.'), undefined);
  const category = hitAt(search, 'Giocatori/Neri Calce.md', 'Teodo deve un debito a Neri.');
  assert.equal(category.type, 'master-only');
  assert.equal(category.master_only, true);
});

test('notes and sources are searched and labelled with their source class', (t) => {
  const root = makeCampaign(t);
  const search = searchCampaign(root, ['Teodo']);
  const note = hitAt(search, 'Appunti/Idee.md', 'Teodo deve un favore al mugnaio.');
  assert.equal(note.source_class, 'notes');
  assert.equal(note.type, 'notes');
  const source = hitAt(search, 'Fonti/Libro.md', 'Teodo appare in una cronaca antica.');
  assert.equal(source.source_class, 'sources');
  assert.equal(source.category, 'fonti');
  assert.deepEqual(search.files_with_hits, [
    'Appunti/Idee.md',
    'Fonti/Libro.md',
    'Giocatori/Neri Calce.md',
    'Personaggi/Teodo Marr.md',
    'Trama/Sessione 1.md',
    'Trama/Sessione 2.md',
  ]);
});

test('a zero-hit search still lists every scanned document', (t) => {
  const root = makeCampaign(t);
  const search = searchCampaign(root, ['Inesistente']);
  assert.deepEqual(search.hits, []);
  assert.deepEqual(search.files_with_hits, []);
  assert.deepEqual(search.subjects, []);
  assert.equal(search.documents.length, DOCUMENT_COUNT);
  assert.ok(search.documents.includes('Personaggi/Teodo Marr.md'));
  assert.deepEqual(search.documents, [...search.documents].sort());
});

test('links out resolve relative targets to existing documents, links in list the linking files', (t) => {
  const root = makeCampaign(t);
  const search = searchCampaign(root, ['Teodo']);
  assert.deepEqual(search.links['Personaggi/Teodo Marr.md'], {
    out: ['Mondo/Pozzo di Nar.md'],
    in: ['Trama/Sessione 1.md'],
  });
});

test('the search result has the documented shape and is deterministic', (t) => {
  const root = makeCampaign(t);
  const first = JSON.stringify(searchCampaign(root, ['Teodo', 'Oria']));
  const second = JSON.stringify(searchCampaign(root, ['Teodo', 'Oria']));
  assert.equal(first, second);
  const search = JSON.parse(first);
  assert.deepEqual(Object.keys(search).slice(0, 7), [
    'terms',
    'subjects',
    'homonyms',
    'hits',
    'links',
    'documents',
    'files_with_hits',
  ]);
  assert.deepEqual(search.subjects[0], {
    id: 'oria-brunel',
    sheet: 'Personaggi/Oria Brunel.md',
    category: 'personaggi',
    type: 'subjects',
    forms: ['Oria Brunel', 'Oria'],
  });
});

test('an external category is labelled as sources, the other categories as before', () => {
  const structure = [
    { id: 'luoghi', folder: 'Mondo', type: 'places' },
    { id: 'esterno', folder: 'Esterno', type: 'external' },
    { id: 'appunti', folder: 'Appunti', type: 'notes' },
  ];
  assert.equal(sourceClassFor(structure, 'Esterno/Luoghi/Raatnagar.md'), 'sources');
  assert.equal(sourceClassFor(structure, 'Mondo/Pozzo.md'), 'canon');
  assert.equal(sourceClassFor(structure, 'Appunti/Idee.md'), 'notes');
  assert.equal(sourceClassFor(structure, 'Altrove/x.md'), null);
});

test('external documents reached through a symlink are not searched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-ext-'));
  try {
    const root = path.join(dir, 'campaign');
    const campaign = [
      'name: Test',
      'structure:',
      '  - id: luoghi',
      '    folder: Mondo',
      '    type: places',
      '  - id: esterno',
      '    folder: Esterno',
      '    type: external',
      '',
    ].join('\n');
    const canon = { 'campaign.yaml': campaign, 'Mondo/Pozzo.md': '# Pozzo\n\nLa Porta Nera custodisce il pozzo.\n' };
    for (const [rel, content] of Object.entries(canon)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    }
    fs.mkdirSync(path.join(source, 'Luoghi'), { recursive: true });
    fs.writeFileSync(path.join(source, 'Luoghi', 'Raatnagar.md'), '# Raatnagar\n\nLa Porta Nera è sigillata.\n');
    fs.symlinkSync(source, path.join(root, 'Esterno'), 'dir');

    const porta = searchCampaign(root, ['Porta Nera']);
    assert.deepEqual(porta.hits.map((h) => h.file), ['Mondo/Pozzo.md']);
    assert.deepEqual(porta.hits.map((h) => h.source_class), ['canon']);
    assert.equal(porta.documents.includes('Esterno/Luoghi/Raatnagar.md'), false);

    const raatnagar = searchCampaign(root, ['Raatnagar']);
    assert.deepEqual(raatnagar.hits, []);
    assert.equal(raatnagar.documents.some((d) => d.startsWith('Esterno/')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});
