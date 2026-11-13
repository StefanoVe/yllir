import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runQuery } from './query.mjs';

const CAMPAIGN_YAML = `schema: 1

campaign:
  name: "Prova"
  slug: prova

structure:
  - id: trama
    folder: Trama
    type: plot
  - id: cronaca
    folder: Cronaca
    type: chronicle
  - id: mondo
    folder: Mondo
    type: places
  - id: personaggi
    folder: Personaggi
    type: subjects
  - id: oggetti
    folder: Oggetti
    type: objects
  - id: storia
    folder: Storia
    type: free
  - id: appunti
    folder: Appunti
    type: notes
`;

/** A document: frontmatter lines, then a body (already Markdown). */
const page = (frontmatter, body) => ['---', ...frontmatter, '---', body, ''].join('\n');

/** A small synthetic world. Each entry is one file, relative to the campaign. */
const WORLD = {
  'Mondo/borgo.md': page(
    ['id: borgo-cenere', 'kind: place', 'provenance: master'],
    '# Borgo Cenere\n\nUn borgo sul lago.\n',
  ),
  'Mondo/lago.md': page(
    ['id: lago-grigio', 'kind: place', 'provenance: master', 'status: active', 'aliases: [Il Lago]'],
    '# Lago Grigio\n\nAcqua ferma e scura.\n',
  ),
  'Personaggi/teodo.md': page(
    ['id: teodo-marr', 'kind: character', 'provenance: generated', 'status: alive', 'aliases: [Mastro Teodo]', 'location: [borgo-cenere]', 'relations:', '  - to: borgo-cenere', '    type: member-of'],
    '# Teodo Marr\n\nMastro Teodo guida la locanda.\n',
  ),
  'Personaggi/lino.md': page(
    ['id: lino-valdes', 'kind: character', 'provenance: master', 'status: alive', 'relations:', '  - to: teodo-marr', '    type: ally-of'],
    '# Lino Valdes\n\nUn pescatore.\n',
  ),
  'Personaggi/schizzo.md': page(
    ['id: oria-schizzo', 'kind: character', 'provenance: master', 'sketch: true', 'location: [borgo-cenere]'],
    '# Oria Schizzo\n\nDa definire.\n',
  ),
  'Oggetti/lanterna.md': page(
    ['id: lanterna', 'kind: item', 'provenance: master', 'status: active', 'location: [lago-grigio]'],
    '# Lanterna\n\nLanterna di ferro.\n',
  ),
  'Storia/incontro.md': page(
    ['id: incontro-molo', 'kind: event', 'provenance: played', 'when: 312', 'location: [lago-grigio]', 'participants: [teodo-marr, lino-valdes]'],
    '# Incontro al molo\n\nIl gruppo incontra due uomini.\n',
  ),
  'Storia/mercato.md': page(
    ['id: mercato', 'kind: event', 'provenance: played', 'when: 100', 'location: [borgo-cenere]', 'participants: [oria-schizzo]'],
    '# Mercato\n\nIl mercato del borgo.\n',
  ),
  'Storia/lontano.md': page(
    ['id: lontano', 'kind: event', 'provenance: played', 'when: 900', 'participants: []'],
    '# Lontano\n\nUn fatto lontano.\n',
  ),
  'Trama/Sessione 1/Sessione 1.md': page(['id: sessione-1', 'provenance: played'], '# Sessione 1\n\nPrima sessione.\n'),
  'Trama/Sessione 1/Eventi/Sul lago.md': page(
    ['id: sessione-1-lago', 'session: sessione-1', 'provenance: played', 'depends_on: []', 'location: [lago-grigio]', 'characters: [lino-valdes]'],
    '# Sul lago\n\nIl lago è fermo.\n',
  ),
  'Cronaca/2026-10-03.md': page(
    ['id: cronaca-03', 'provenance: played'],
    '# Cronaca del 3 ottobre\n\n## Fili aperti\n\n- Di chi è la barca?\n',
  ),
};

/** Creates a temporary campaign from WORLD, with `extra` files added or replaced. */
function makeCampaign(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-query-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), CAMPAIGN_YAML);
  for (const [rel, content] of Object.entries({ ...WORLD, ...extra })) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const USAGE_NAMES = ['find', 'at', 'where', 'related', 'timeline', 'sketches', 'errors'];

test('a result has the query name, the arguments and the results', (t) => {
  const result = runQuery(makeCampaign(t), 'sketches');
  assert.deepEqual(result, {
    query: 'sketches',
    args: [],
    results: [{ id: 'oria-schizzo', title: 'Oria Schizzo', kind: 'character', file: 'Personaggi/schizzo.md' }],
  });
});

test('find returns an exact match of a title or alias, accents and case folded', (t) => {
  const root = makeCampaign(t);
  assert.deepEqual(runQuery(root, 'find', ['Teodo Marr']).results, [
    { id: 'teodo-marr', title: 'Teodo Marr', kind: 'character', file: 'Personaggi/teodo.md', match: 'exact' },
  ]);
  assert.deepEqual(runQuery(root, 'find', ['  MASTRO   teodo ']).results, [
    { id: 'teodo-marr', title: 'Teodo Marr', kind: 'character', file: 'Personaggi/teodo.md', match: 'exact' },
  ]);
  assert.deepEqual(runQuery(root, 'find', ['il lago']).results, [
    { id: 'lago-grigio', title: 'Lago Grigio', kind: 'place', file: 'Mondo/lago.md', match: 'exact' },
  ]);
});

test('find returns folded substring matches as partial, and an exact match before them', (t) => {
  const root = makeCampaign(t, {
    'Mondo/aaa.md': page(['id: aaa-lago-sopra', 'kind: place', 'provenance: master'], '# Lago Grigio di Sopra\n\nAltrove.\n'),
  });
  const result = runQuery(root, 'find', ['lago grigio']);
  assert.deepEqual(result.results, [
    { id: 'lago-grigio', title: 'Lago Grigio', kind: 'place', file: 'Mondo/lago.md', match: 'exact' },
    { id: 'aaa-lago-sopra', title: 'Lago Grigio di Sopra', kind: 'place', file: 'Mondo/aaa.md', match: 'partial' },
  ]);
});

test('find reports a partial match on a title or an alias, sorted by id', (t) => {
  const result = runQuery(makeCampaign(t), 'find', ['lago']);
  assert.deepEqual(result.results.map((item) => [item.id, item.match]), [
    ['lago-grigio', 'partial'],
    ['sessione-1-lago', 'partial'],
  ]);
});

test('find with an empty text is an error', (t) => {
  const result = runQuery(makeCampaign(t), 'find', ['   ']);
  assert.equal(typeof result.error, 'string');
  assert.equal(result.results, undefined);
});

test('at lists the subjects located at a place, sorted by id', (t) => {
  assert.deepEqual(runQuery(makeCampaign(t), 'at', ['lago-grigio']).results, [
    { id: 'incontro-molo', title: 'Incontro al molo', kind: 'event', file: 'Storia/incontro.md' },
    { id: 'lanterna', title: 'Lanterna', kind: 'item', file: 'Oggetti/lanterna.md' },
    { id: 'sessione-1-lago', title: 'Sul lago', kind: null, file: 'Trama/Sessione 1/Eventi/Sul lago.md' },
  ]);
});

test('at with a place that is not a subject is an error', (t) => {
  const result = runQuery(makeCampaign(t), 'at', ['nessuno']);
  assert.equal(result.error, 'unknown subject id "nessuno"');
});

test('where lists the places of a subject', (t) => {
  const root = makeCampaign(t);
  assert.deepEqual(runQuery(root, 'where', ['teodo-marr']).results, [
    { id: 'borgo-cenere', title: 'Borgo Cenere', file: 'Mondo/borgo.md' },
  ]);
  assert.deepEqual(runQuery(root, 'where', ['sessione-1-lago']).results, [
    { id: 'lago-grigio', title: 'Lago Grigio', file: 'Mondo/lago.md' },
  ]);
  assert.deepEqual(runQuery(root, 'where', ['borgo-cenere']).results, []);
});

test('where with an unknown id is an error', (t) => {
  assert.equal(runQuery(makeCampaign(t), 'where', ['nessuno']).error, 'unknown subject id "nessuno"');
});

test('related lists the relations in both directions with the other subject', (t) => {
  assert.deepEqual(runQuery(makeCampaign(t), 'related', ['teodo-marr']).results, [
    {
      from: 'lino-valdes',
      to: 'teodo-marr',
      type: 'ally-of',
      other: { id: 'lino-valdes', title: 'Lino Valdes', kind: 'character' },
    },
    {
      from: 'teodo-marr',
      to: 'borgo-cenere',
      type: 'member-of',
      other: { id: 'borgo-cenere', title: 'Borgo Cenere', kind: 'place' },
    },
  ]);
});

test('related of a subject without relations is an empty list, and of an unknown id an error', (t) => {
  const root = makeCampaign(t);
  assert.deepEqual(runQuery(root, 'related', ['lanterna']).results, []);
  assert.equal(runQuery(root, 'related', ['nessuno']).error, 'unknown subject id "nessuno"');
});

test('timeline lists every event sorted by when, with open bounds', (t) => {
  const root = makeCampaign(t);
  assert.deepEqual(
    runQuery(root, 'timeline').results.map((item) => [item.id, item.when]),
    [
      ['mercato', 100],
      ['incontro-molo', 312],
      ['lontano', 900],
    ],
  );
  assert.deepEqual(
    runQuery(root, 'timeline', ['200']).results.map((item) => item.id),
    ['incontro-molo', 'lontano'],
  );
  assert.deepEqual(
    runQuery(root, 'timeline', ['0', '312']).results.map((item) => item.id),
    ['mercato', 'incontro-molo'],
  );
  assert.deepEqual(runQuery(root, 'timeline', ['1000']).results, []);
});

test('a timeline entry has the id, title, when, location and participants', (t) => {
  assert.deepEqual(runQuery(makeCampaign(t), 'timeline', ['312', '312']).results, [
    {
      id: 'incontro-molo',
      title: 'Incontro al molo',
      when: 312,
      location: ['lago-grigio'],
      participants: ['teodo-marr', 'lino-valdes'],
    },
  ]);
});

test('timeline with a bound that is not a number is an error', (t) => {
  const result = runQuery(makeCampaign(t), 'timeline', ['presto']);
  assert.match(result.error, /must be a number/);
});

test('sketches lists the sketches of the campaign', (t) => {
  assert.deepEqual(runQuery(makeCampaign(t), 'sketches').results, [
    { id: 'oria-schizzo', title: 'Oria Schizzo', kind: 'character', file: 'Personaggi/schizzo.md' },
  ]);
});

test('errors lists the world-graph errors, and is empty for a valid world', (t) => {
  assert.deepEqual(runQuery(makeCampaign(t), 'errors').results, []);

  const root = makeCampaign(t, {
    'Personaggi/vago.md': page(['id: vago', 'kind: character', 'provenance: master', 'location: [luogo-perduto]'], '# Vago\n\nUn uomo vago.\n'),
  });
  assert.deepEqual(runQuery(root, 'errors').results, [
    {
      file: 'Personaggi/vago.md',
      code: 'unknown-reference',
      message: 'vago is located at unknown luogo-perduto',
      ids: ['vago', 'luogo-perduto'],
    },
  ]);
});

test('an unknown query name is an error that lists all the queries', (t) => {
  const result = runQuery(makeCampaign(t), 'trova', ['x']);
  assert.equal(result.query, 'trova');
  assert.equal(result.results, undefined);
  assert.equal(result.error.includes('unknown query "trova"'), true);
  assert.equal(result.error.includes('\n'), false, 'the usage is one line');
  for (const name of USAGE_NAMES) {
    assert.equal(result.error.includes(name), true, `usage must name ${name}`);
  }
});

test('a wrong number of arguments is an error with the usage', (t) => {
  const root = makeCampaign(t);
  const missing = runQuery(root, 'find');
  assert.equal(missing.error.startsWith('find takes 1 argument.'), true);
  assert.equal(missing.error.includes('usage:'), true);

  const extra = runQuery(root, 'sketches', ['x']);
  assert.equal(extra.error.startsWith('sketches takes no arguments.'), true);

  const tooMany = runQuery(root, 'timeline', ['1', '2', '3']);
  assert.equal(tooMany.error.startsWith('timeline takes 0 to 2 arguments.'), true);
});

test('the same campaign gives identical results on repeated calls', (t) => {
  const root = makeCampaign(t);
  for (const args of [['find', ['lago']], ['at', ['lago-grigio']], ['related', ['teodo-marr']], ['timeline', []], ['errors', []]]) {
    assert.deepEqual(runQuery(root, args[0], args[1]), runQuery(root, args[0], args[1]));
  }
});

const ECONOMY = page(
  ['id: economia', 'provenance: master'],
  [
    '# Economia',
    '',
    '## Valute',
    '',
    '| Valuta | Equivalenza | Nota |',
    '| --- | --- | --- |',
    '| scudo / scudi | unità di conto | moneta comune |',
    '',
    '## Prezzi base',
    '',
    '| Categoria | Minimo | Massimo | Unità |',
    '| --- | --- | --- | --- |',
    '| Corda | 1 | 3 | scudi |',
    '',
    '## Salari',
    '',
    '| Mestiere | Paga | Periodo |',
    '| --- | --- | --- |',
    '',
    '## Variazioni per luogo',
    '',
    '| Luogo | Fattore | Motivo |',
    '| --- | --- | --- |',
    '',
  ].join('\n'),
);

const BOTTEGA = page(
  ['id: bottega-sale', 'template: vendor', 'kind: character', 'provenance: master', 'location: [borgo-cenere]'],
  [
    '# Bottega del Sale',
    '',
    '## Assortimento',
    '',
    '| Oggetto | Prezzo | Nota |',
    '| --- | --- | --- |',
    '| Corda di canapa | 10 scudi | dieci braccia |',
    '| Corda di crine | 2 scudi | leggera |',
    '| Sale grosso | 5 scudi | sacco |',
    '',
  ].join('\n'),
);

test('prices lists the out-of-range and unmatched rows, next to the economy state', (t) => {
  const root = makeCampaign(t, { 'Storia/Economia.md': ECONOMY, 'Personaggi/Bottega.md': BOTTEGA });
  const result = runQuery(root, 'prices');
  assert.equal(result.error, undefined);
  assert.equal(result.economy, 'present');
  assert.deepEqual(result.results, [
    {
      file: 'Personaggi/Bottega.md',
      id: 'bottega-sale',
      item: 'Corda di canapa',
      price: 10,
      status: 'out-of-range',
      range: [1, 3],
      unit: 'scudo',
    },
    {
      file: 'Personaggi/Bottega.md',
      id: 'bottega-sale',
      item: 'Sale grosso',
      price: 5,
      status: 'unmatched',
      range: null,
      unit: 'scudo',
    },
  ]);
});

test('prices without an economy document gives economy missing and no results', (t) => {
  const result = runQuery(makeCampaign(t, { 'Personaggi/Bottega.md': BOTTEGA }), 'prices');
  assert.deepEqual(result, { query: 'prices', args: [], economy: 'missing', results: [] });
});

test('prices takes no arguments', (t) => {
  assert.equal(typeof runQuery(makeCampaign(t), 'prices', ['x']).error, 'string');
});

test('unreachable lists a plot node whose dependency does not exist', (t) => {
  const root = makeCampaign(t, {
    'Trama/Sessione 1/Eventi/Perduto.md': page(
      ['id: sessione-1-perduto', 'session: sessione-1', 'provenance: played', 'depends_on: [evento-mai-esistito]'],
      '# Perduto\n\nUn evento che non può accadere.\n',
    ),
  });
  const result = runQuery(root, 'unreachable');
  assert.equal(result.error, undefined);
  assert.deepEqual(result.results, [
    {
      id: 'sessione-1-perduto',
      file: 'Trama/Sessione 1/Eventi/Perduto.md',
      kind: 'event',
      reason: 'missing-dependency',
      via: ['evento-mai-esistito'],
    },
  ]);
});

test('unreachable of a campaign with a reachable plot is empty', (t) => {
  assert.deepEqual(runQuery(makeCampaign(t), 'unreachable').results, []);
});

test('forgotten lists a character that no plot or chronicle document mentions', (t) => {
  const result = runQuery(makeCampaign(t), 'forgotten');
  assert.equal(result.error, undefined);
  const ids = result.results.map((entry) => entry.id);
  assert.equal(ids.includes('oria-schizzo'), true, JSON.stringify(result.results));
  assert.equal(ids.includes('lino-valdes'), false);
  const schizzo = result.results.find((entry) => entry.id === 'oria-schizzo');
  assert.equal(schizzo.sketch, true);
  assert.equal(schizzo.file, 'Personaggi/schizzo.md');
});

test('usage names the three new queries and encounters', (t) => {
  const result = runQuery(makeCampaign(t), 'nosuch');
  for (const name of ['prices', 'unreachable', 'forgotten', 'encounters']) {
    assert.equal(result.error.includes(name), true, `usage must name ${name}`);
  }
});
