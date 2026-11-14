import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  norm,
  findEconomyDocument,
  parseEconomy,
  parsePrice,
  checkEconomyDocument,
  checkSheetPrices,
  priceReport,
  priceProposal,
} from './economy.mjs';

// ---------------------------------------------------------------------------
// Fixtures

function campaignYaml(lang) {
  const it = lang === 'it';
  return [
    'name: Test',
    'language:',
    `  main: ${lang}`,
    'structure:',
    '  - id: luoghi',
    '    folder: Mondo',
    '    type: places',
    '  - id: personaggi',
    `    folder: ${it ? 'Personaggi' : 'Characters'}`,
    '    type: subjects',
    '  - id: storia',
    `    folder: ${it ? 'Storia' : 'History'}`,
    '    type: free',
    '',
  ].join('\n');
}

const PLACES = {
  'Mondo/Capitale.md': '---\nid: capitale\nkind: place\nprovenance: master\n---\n\n# Capitale\n\nLa città.\n',
  'Mondo/Borgo.md': '---\nid: borgo\nkind: place\nprovenance: master\nlocation: [capitale]\n---\n\n# Borgo\n\nUn borgo.\n',
};

const HEAD = (...cols) => [`| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`];

const IT_DEFAULTS = {
  valute: [...HEAD('Valuta', 'Equivalenza', 'Nota'), '| scudo / scudi | unità di conto | |', '| corona / corone | 10 scudi | |'],
  prezzi: [...HEAD('Categoria', 'Minimo', 'Massimo', 'Unità'), '| Corda | 1 | 3 | scudo |', '| Pasto semplice | 0.5 | 1 | scudo |'],
  salari: HEAD('Mestiere', 'Paga', 'Periodo'),
  variazioni: HEAD('Luogo', 'Fattore', 'Motivo'),
};

/** Italian economy document. A part set to null is left out; an array replaces the default rows. */
function economyIt(parts = {}) {
  const p = { ...IT_DEFAULTS, ...parts };
  const sections = [
    ['## Valute', p.valute],
    ['## Prezzi base', p.prezzi],
    ['## Salari', p.salari],
    ['## Variazioni per luogo', p.variazioni],
  ];
  const out = ['---', 'id: economia', 'provenance: master', '---', '', '# Economia', ''];
  for (const [title, lines] of sections) {
    if (lines === null) continue;
    out.push(title, '', ...lines, '');
  }
  out.push('<!-- master -->', '## Master', '', 'Nel manuale Corda costa 100 scudi.', '<!-- /master -->', '');
  return out.join('\n');
}

const EN_ECONOMY = [
  '---',
  'id: economia',
  'provenance: master',
  '---',
  '',
  '# Economy',
  '',
  '## Currencies',
  '',
  ...HEAD('Currency', 'Equivalence', 'Note'),
  '| crown / crowns | unit of account | |',
  '| ducat / ducats | 2 crowns | |',
  '',
  '## Base prices',
  '',
  ...HEAD('Category', 'Minimum', 'Maximum', 'Unit'),
  '| Rope | 1 | 3 | crown |',
  '',
  '## Wages',
  '',
  ...HEAD('Trade', 'Pay', 'Period'),
  '',
  '## Variations by place',
  '',
  ...HEAD('Place', 'Factor', 'Reason'),
  '',
].join('\n');

/** Italian vendor sheet. `stock` are data rows of the Assortimento table. */
function vendorIt(name, stock, { location = '[borgo]', deroghe = null } = {}) {
  const lines = [
    '---',
    `id: ${name.toLowerCase()}`,
    'template: vendor',
    'kind: character',
    'provenance: master',
    `location: ${location}`,
    '---',
    '',
    `# ${name}`,
    '',
    '## Assortimento',
    '',
    ...HEAD('Oggetto', 'Prezzo', 'Nota'),
    ...stock,
    '',
  ];
  if (deroghe !== null) lines.push('## Deroghe', '', deroghe, '');
  lines.push('<!-- master -->', '## Master', '', 'Segreto: la corda vale 99 scudi.', '<!-- /master -->', '');
  return lines.join('\n');
}

function vendorEn(name, stock) {
  return [
    '---',
    `id: ${name.toLowerCase()}`,
    'template: vendor',
    'kind: character',
    'provenance: master',
    'location: [borgo]',
    '---',
    '',
    `# ${name}`,
    '',
    '## Stock',
    '',
    ...HEAD('Item', 'Price', 'Note'),
    ...stock,
    '',
  ].join('\n');
}

function notice(name, reward, section = 'Premio') {
  return [
    '---',
    `id: ${name.toLowerCase()}`,
    'template: notice',
    'kind: character',
    'provenance: master',
    '---',
    '',
    `# ${name}`,
    '',
    `## ${section}`,
    '',
    reward,
    '',
  ].join('\n');
}

/** Writes a temporary campaign, runs `fn` on its root and removes it afterwards. */
function withCampaign(files, fn, lang = 'it') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-economy-'));
  try {
    const all = { 'campaign.yaml': campaignYaml(lang), ...PLACES, ...files };
    for (const [rel, content] of Object.entries(all)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const ECON = 'Storia/Economia.md';
const MARA = 'Personaggi/Mara.md';
const TAGLIA = 'Personaggi/Taglia.md';

function codes(result) {
  return result.errors.map((e) => e.code);
}

// ---------------------------------------------------------------------------
// norm

test('norm folds the written forms of a currency to one key', () => {
  assert.equal(norm('scudo'), norm('scudi'));
  assert.equal(norm('scudi'), norm('Scudi'));
  assert.equal(norm('crown'), norm('crowns'));
  assert.equal(norm('corona'), norm('corone'));
  assert.equal(norm('Scudi'), 'scud');
  assert.equal(norm('corone'), 'coron');
});

test('norm does not shorten a 3-letter word', () => {
  assert.equal(norm('gas'), 'gas');
  assert.equal(norm('dom'), 'dom');
  assert.equal(norm('ora'), 'ora');
});

// ---------------------------------------------------------------------------
// parseEconomy

test('a valid Italian economy document parses into units, categories and no errors', () => {
  const econ = parseEconomy(economyIt(), 'it');
  assert.deepEqual(econ.errors, []);
  assert.equal(econ.unit, 'scudo');
  assert.deepEqual(
    econ.currencies.map((c) => [c.name, c.toUnit]),
    [
      ['scudo', 1],
      ['corona', 10],
    ],
  );
  assert.deepEqual(econ.categories[0], { name: 'Corda', min: 1, max: 3, unit: 'scudo', minInUnit: 1, maxInUnit: 3 });
  assert.deepEqual(econ.categories[1], { name: 'Pasto semplice', min: 0.5, max: 1, unit: 'scudo', minInUnit: 0.5, maxInUnit: 1 });
  assert.deepEqual(econ.wages, []);
  assert.deepEqual(econ.variations, []);
});

test('chained equivalences are resolved to the reference unit', () => {
  const text = economyIt({
    valute: [...HEAD('Valuta', 'Equivalenza', 'Nota'), '| scudo | unità di conto | |', '| corona | 10 scudi | |', '| perla | 2 corone | |'],
  });
  const econ = parseEconomy(text, 'it');
  assert.deepEqual(econ.errors, []);
  assert.equal(econ.currencies.find((c) => c.name === 'perla').toUnit, 20);
});

test('a missing section or a table without rows is an economy-table error', () => {
  const missing = parseEconomy(economyIt({ salari: null }), 'it');
  assert.deepEqual(codes(missing), ['economy-table']);

  const noTable = parseEconomy(economyIt({ prezzi: ['Nessuna tabella qui.'] }), 'it');
  assert.ok(noTable.errors.some((e) => e.code === 'economy-table' && /no table/.test(e.message)));
});

test('a table with the wrong columns is an economy-table error', () => {
  const text = economyIt({ prezzi: [...HEAD('Categoria', 'Min', 'Max', 'Unità'), '| Corda | 1 | 3 | scudo |'] });
  const econ = parseEconomy(text, 'it');
  assert.deepEqual(codes(econ), ['economy-table']);
});

test('a non-number or an inverted range is an economy-range error', () => {
  const text = economyIt({
    prezzi: [...HEAD('Categoria', 'Minimo', 'Massimo', 'Unità'), '| Corda | molto | 3 | scudo |', '| Pasto semplice | 3 | 1 | scudo |'],
  });
  const econ = parseEconomy(text, 'it');
  assert.deepEqual(econ.errors.map((e) => e.code), ['economy-range', 'economy-range']);
});

test('currency problems are economy-currency errors', () => {
  const twoUnits = parseEconomy(
    economyIt({ valute: [...HEAD('Valuta', 'Equivalenza', 'Nota'), '| scudo | unità di conto | |', '| corona | unità di conto | |'] }),
    'it',
  );
  assert.ok(twoUnits.errors.some((e) => e.code === 'economy-currency' && /found 2/.test(e.message)));

  const badEquivalence = parseEconomy(
    economyIt({ valute: [...HEAD('Valuta', 'Equivalenza', 'Nota'), '| scudo | unità di conto | |', '| corona | tanto | |'] }),
    'it',
  );
  assert.deepEqual(codes(badEquivalence), ['economy-currency']);

  const unknownTarget = parseEconomy(
    economyIt({ valute: [...HEAD('Valuta', 'Equivalenza', 'Nota'), '| scudo | unità di conto | |', '| corona | 10 dobloni | |'] }),
    'it',
  );
  assert.ok(unknownTarget.errors.some((e) => e.code === 'economy-currency' && /dobloni/.test(e.message)));

  const cycle = parseEconomy(
    economyIt({
      valute: [
        ...HEAD('Valuta', 'Equivalenza', 'Nota'),
        '| scudo | unità di conto | |',
        '| corona | 2 perla | |',
        '| perla | 2 corona | |',
      ],
    }),
    'it',
  );
  assert.ok(cycle.errors.some((e) => e.code === 'economy-currency' && /cycle/.test(e.message)));

  const unknownUnit = parseEconomy(
    economyIt({ prezzi: [...HEAD('Categoria', 'Minimo', 'Massimo', 'Unità'), '| Corda | 1 | 3 | dobloni |'] }),
    'it',
  );
  assert.deepEqual(codes(unknownUnit), ['economy-currency']);
});

test('a bad factor is an economy-place error', () => {
  for (const factor of ['0', '-1', 'molto']) {
    const econ = parseEconomy(economyIt({ variazioni: [...HEAD('Luogo', 'Fattore', 'Motivo'), `| borgo | ${factor} | x |`] }), 'it');
    assert.deepEqual(codes(econ), ['economy-place'], `factor ${factor}`);
  }
});

test('checkEconomyDocument reports an unknown place id as economy-place', () => {
  withCampaign(
    {
      [ECON]: economyIt({ variazioni: [...HEAD('Luogo', 'Fattore', 'Motivo'), '| inesistente | 2 | x |'] }),
    },
    (root) => {
      const result = checkEconomyDocument(root, ECON);
      assert.deepEqual(result.errors.map((e) => [e.file, e.code]), [[ECON, 'economy-place']]);
      assert.match(result.errors[0].message, /inesistente/);
    },
  );
});

test('a valid economy document with empty Salari and Variazioni tables passes', () => {
  withCampaign({ [ECON]: economyIt() }, (root) => {
    assert.equal(findEconomyDocument(root), ECON);
    assert.deepEqual(checkEconomyDocument(root, ECON).errors, []);
  });
});

test('a valid English economy document passes', () => {
  withCampaign(
    {
      'History/Economy.md': EN_ECONOMY,
      'Characters/Mara.md': vendorEn('Mara', ['| Rope coil | 2 crowns | |']),
    },
    (root) => {
      assert.equal(findEconomyDocument(root), 'History/Economy.md');
      assert.deepEqual(checkEconomyDocument(root, 'History/Economy.md').errors, []);
      assert.deepEqual(checkSheetPrices(root, { files: ['Characters/Mara.md'] }).errors, []);
    },
    'en',
  );
});

// ---------------------------------------------------------------------------
// parsePrice

test('parsePrice converts and sums the currency pairs of a cell', () => {
  const econ = parseEconomy(economyIt(), 'it');
  assert.deepEqual(parsePrice('2 scudi', econ), { value: 2, unknown: [] });
  assert.deepEqual(parsePrice('1 corona', econ), { value: 10, unknown: [] });
  assert.deepEqual(parsePrice('1 corona e 5 scudi', econ), { value: 15, unknown: [] });
  assert.deepEqual(parsePrice('0.5 scudo l\'uno', econ), { value: 0.5, unknown: [] });
  assert.deepEqual(parsePrice('3 corone (circa)', econ), { value: 30, unknown: [] });
});

test('parsePrice ignores parentheses and reads no value from a cell without digits', () => {
  const econ = parseEconomy(economyIt(), 'it');
  assert.deepEqual(parsePrice('(2 scudi)', econ), { value: null, unknown: [] });
  assert.deepEqual(parsePrice('Gratis', econ), { value: null, unknown: [] });
  assert.deepEqual(parsePrice('Trenta scudi', econ), { value: null, unknown: [] });
});

test('parsePrice lists the unknown currency words', () => {
  const econ = parseEconomy(economyIt(), 'it');
  assert.deepEqual(parsePrice('30 dobloni', econ), { value: null, unknown: ['dobloni'] });
});

// ---------------------------------------------------------------------------
// Vendor and notice checks

const CORDA_IN_RANGE = vendorIt('Mara', ['| Corda da 15 metri | 2 scudi | |']);

test('a vendor price in range has no error', () => {
  withCampaign({ [ECON]: economyIt(), [MARA]: CORDA_IN_RANGE }, (root) => {
    assert.deepEqual(checkSheetPrices(root, { files: [MARA] }).errors, []);
  });
});

test('a vendor price out of range is an economy-price error', () => {
  const sheet = vendorIt('Mara', ['| Corda da 15 metri | 5 scudi | |']);
  withCampaign({ [ECON]: economyIt(), [MARA]: sheet }, (root) => {
    const result = checkSheetPrices(root, { files: [MARA] });
    assert.deepEqual(result.errors.map((e) => [e.file, e.code]), [[MARA, 'economy-price']]);
    assert.match(result.errors[0].message, /Corda da 15 metri/);
    assert.match(result.errors[0].message, /1-3 scudo/);
  });
});

test('an item named in Deroghe is not an error even when out of range', () => {
  const sheet = vendorIt('Mara', ['| Corda da 15 metri | 5 scudi | |'], {
    deroghe: '- Corda da 15 metri: prezzo di corte.',
  });
  withCampaign({ [ECON]: economyIt(), [MARA]: sheet }, (root) => {
    assert.deepEqual(checkSheetPrices(root, { files: [MARA] }).errors, []);
  });
});

test('a price in corone is converted before the range check', () => {
  const sheet = vendorIt('Mara', ['| Corda da 15 metri | 1 corona | |']);
  withCampaign({ [ECON]: economyIt(), [MARA]: sheet }, (root) => {
    assert.deepEqual(codes(checkSheetPrices(root, { files: [MARA] })), ['economy-price']);
  });
});

test('a sum of currencies is added up before the range check', () => {
  const sheet = vendorIt('Mara', ['| Corda da 15 metri | 1 corona e 5 scudi | |']);
  withCampaign({ [ECON]: economyIt(), [MARA]: sheet }, (root) => {
    const result = checkSheetPrices(root, { files: [MARA] });
    assert.deepEqual(codes(result), ['economy-price']);
    assert.match(result.errors[0].message, /costs 15 scudo/);
  });
});

test('a place factor on the vendor place widens the range', () => {
  const econ = economyIt({ variazioni: [...HEAD('Luogo', 'Fattore', 'Motivo'), '| borgo | 2 | Mercato |'] });
  withCampaign({ [ECON]: econ, [MARA]: CORDA_IN_RANGE.replace('| 2 scudi |', '| 5 scudi |') }, (root) => {
    assert.deepEqual(checkSheetPrices(root, { files: [MARA] }).errors, []);
  });
  // The widened range is 2-6: 7 scudi is still out.
  const sheet = vendorIt('Mara', ['| Corda da 15 metri | 7 scudi | |']);
  withCampaign({ [ECON]: econ, [MARA]: sheet }, (root) => {
    assert.deepEqual(codes(checkSheetPrices(root, { files: [MARA] })), ['economy-price']);
  });
});

test('the factor of the parent place is used when the vendor place has none', () => {
  const econ = economyIt({ variazioni: [...HEAD('Luogo', 'Fattore', 'Motivo'), '| capitale | 2 | Capitale cara |'] });
  const sheet = vendorIt('Mara', ['| Corda da 15 metri | 5 scudi | |']);
  withCampaign({ [ECON]: econ, [MARA]: sheet }, (root) => {
    assert.deepEqual(checkSheetPrices(root, { files: [MARA] }).errors, []);
  });
});

test('an item that matches no category is not an error and is listed as unmatched', () => {
  const sheet = vendorIt('Mara', ['| Spada lunga | 40 scudi | |']);
  withCampaign({ [ECON]: economyIt(), [MARA]: sheet }, (root) => {
    assert.deepEqual(checkSheetPrices(root, { files: [MARA] }).errors, []);
    const report = priceReport(root);
    assert.equal(report.economy, 'present');
    assert.deepEqual(report.results, [
      { file: MARA, id: 'mara', item: 'Spada lunga', price: 40, status: 'unmatched', range: null, unit: 'scudo' },
    ]);
  });
});

test('the master-only block never changes a price', () => {
  // The master block of the vendor says 99 scudi for the rope, the public stock says 2.
  withCampaign({ [ECON]: economyIt(), [MARA]: CORDA_IN_RANGE }, (root) => {
    assert.deepEqual(checkSheetPrices(root, { files: [MARA] }).errors, []);
  });
});

test('notice rewards: money in known currency is ok, unknown currency is economy-currency, words and no reward are skipped', () => {
  withCampaign(
    {
      [ECON]: economyIt(),
      'Personaggi/Taglia.md': notice('Taglia', '30 scudi'),
      'Personaggi/Taglia Due.md': notice('Taglia Due', '30 dobloni'),
      'Personaggi/Taglia Tre.md': notice('Taglia Tre', 'Trenta scudi'),
      'Personaggi/Taglia Quattro.md': notice('Taglia Quattro', 'Nessun premio'),
    },
    (root) => {
      const files = [
        'Personaggi/Taglia.md',
        'Personaggi/Taglia Due.md',
        'Personaggi/Taglia Tre.md',
        'Personaggi/Taglia Quattro.md',
      ];
      const result = checkSheetPrices(root, { files });
      assert.deepEqual(result.errors.map((e) => [e.file, e.code]), [['Personaggi/Taglia Due.md', 'economy-currency']]);
      assert.match(result.errors[0].message, /dobloni/);
    },
  );
});

test('a notice reward in English is checked with crowns', () => {
  withCampaign(
    {
      'History/Economy.md': EN_ECONOMY,
      'Characters/Bounty.md': notice('Bounty', '30 crowns', 'Reward'),
      'Characters/Empty.md': notice('Empty', 'No reward', 'Reward'),
    },
    (root) => {
      const files = ['Characters/Bounty.md', 'Characters/Empty.md'];
      assert.deepEqual(checkSheetPrices(root, { files }).errors, []);
    },
    'en',
  );
});

test('an English vendor in range passes, out of range is economy-price with the English unit', () => {
  const sheet = vendorEn('Mara', ['| Rope coil | 1 ducat | |', '| Rope ladder | 2 ducats | |']);
  withCampaign(
    { 'History/Economy.md': EN_ECONOMY, 'Characters/Mara.md': sheet },
    (root) => {
      const result = checkSheetPrices(root, { files: ['Characters/Mara.md'] });
      assert.deepEqual(result.errors.map((e) => e.code), ['economy-price']);
      assert.match(result.errors[0].message, /Rope ladder/);
      assert.match(result.errors[0].message, /crown/);
    },
    'en',
  );
});

test('without an economy document there are no price errors and the report says missing', () => {
  const sheet = vendorIt('Mara', ['| Corda da 15 metri | 500 scudi | |']);
  withCampaign({ [MARA]: sheet }, (root) => {
    assert.deepEqual(checkSheetPrices(root, { files: [MARA] }), { errors: [] });
    assert.deepEqual(priceReport(root), { economy: 'missing', results: [] });
  });
});

test('checkSheetPrices ignores files that are not vendor or notice sheets', () => {
  const sheet = vendorIt('Mara', ['| Corda da 15 metri | 500 scudi | |']);
  withCampaign({ [ECON]: economyIt(), [MARA]: sheet }, (root) => {
    assert.deepEqual(checkSheetPrices(root, { files: [ECON, 'Mondo/Borgo.md'] }).errors, []);
  });
});

test('priceReport lists out-of-range rows with range, unit and price, sorted by file then item', () => {
  const mara = vendorIt('Mara', ['| Corda da 15 metri | 5 scudi | |', '| Pasto semplice | 1 scudo | |']);
  const taglia = notice('Taglia', '30 dobloni');
  withCampaign({ [ECON]: economyIt(), [MARA]: mara, [TAGLIA]: taglia }, (root) => {
    const report = priceReport(root);
    assert.equal(report.economy, 'present');
    assert.deepEqual(report.results, [
      { file: MARA, id: 'mara', item: 'Corda da 15 metri', price: 5, status: 'out-of-range', range: [1, 3], unit: 'scudo' },
      { file: TAGLIA, id: 'taglia', item: '30 dobloni', price: null, status: 'unknown-currency', range: null, unit: 'scudo' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// priceProposal

const RATION = ['Razione (un giorno)', 'Rations (one day)'];

/** Economy with one base price row for the reference food, in the given row cells. */
function rationEconomy(cells = ['2', '2', 'corona']) {
  return economyIt({
    prezzi: [...HEAD('Categoria', 'Minimo', 'Massimo', 'Unità'), `| Razione (un giorno) | ${cells.join(' | ')} |`, '| Corda | 1 | 3 | scudo |'],
  });
}

const PROPOSAL = { referenceValue: 50, referenceLabels: RATION, systemValue: 1500 };

test('priceProposal scales the reference food price by the ratio of the two values', () => {
  withCampaign({ [ECON]: rationEconomy() }, (root) => {
    assert.deepEqual(priceProposal(root, PROPOSAL), {
      status: 'ok',
      systemValue: 1500,
      referenceValue: 50,
      referenceCategory: 'Razione (un giorno)',
      referencePrice: 2,
      unit: 'corona',
      proposed: 60,
      unitOfAccount: 'scudo',
      proposedInUnitOfAccount: 600,
    });
  });
});

test('priceProposal uses the middle of a min-max range and converts it to the unit of account', () => {
  withCampaign({ [ECON]: rationEconomy(['2', '4', 'corona']) }, (root) => {
    const result = priceProposal(root, PROPOSAL);
    assert.equal(result.status, 'ok');
    assert.equal(result.referencePrice, 3);
    assert.equal(result.proposed, 90);
    // corona = 10 scudi: the row is 20-40 scudi, its middle 30 scudi.
    assert.equal(result.proposedInUnitOfAccount, 900);
  });
});

test('priceProposal rounds the proposed price to two decimals', () => {
  withCampaign({ [ECON]: rationEconomy(['1', '2', 'corona']) }, (root) => {
    // 100 / 3 * 1.5 is exactly 50.
    assert.equal(priceProposal(root, { referenceValue: 3, referenceLabels: RATION, systemValue: 100 }).proposed, 50);
    // 10 / 7 * 1.5 = 2.142857... is rounded to 2.14.
    assert.equal(priceProposal(root, { referenceValue: 7, referenceLabels: RATION, systemValue: 10 }).proposed, 2.14);
  });
});

test('priceProposal with the unit of account as the row currency gives the same number twice', () => {
  withCampaign({ [ECON]: rationEconomy(['1', '1', 'scudo']) }, (root) => {
    const result = priceProposal(root, { referenceValue: 50, referenceLabels: RATION, systemValue: 75 });
    assert.equal(result.status, 'ok');
    assert.equal(result.unit, 'scudo');
    assert.equal(result.proposed, 1.5);
    assert.equal(result.proposedInUnitOfAccount, 1.5);
  });
});

test('priceProposal matches the reference label folded, in either adapter language', () => {
  withCampaign({ [ECON]: rationEconomy() }, (root) => {
    assert.equal(priceProposal(root, { ...PROPOSAL, referenceLabels: ['  RAZIONE   (un giorno) '] }).status, 'ok');
    assert.equal(priceProposal(root, { ...PROPOSAL, referenceLabels: ['Rations (one day)'] }).status, 'no-reference-row');
  });
});

test('priceProposal without an economy document is no-economy', () => {
  withCampaign({}, (root) => {
    const result = priceProposal(root, PROPOSAL);
    assert.equal(result.status, 'no-economy');
    assert.equal(typeof result.message, 'string');
  });
});

test('priceProposal without a positive finite reference value is no-reference-value', () => {
  withCampaign({ [ECON]: rationEconomy() }, (root) => {
    for (const referenceValue of [undefined, null, 0, -50, NaN, Infinity, '50']) {
      assert.equal(priceProposal(root, { ...PROPOSAL, referenceValue }).status, 'no-reference-value', String(referenceValue));
    }
  });
});

test('priceProposal with a system value that is not a positive finite number is bad-system-value', () => {
  withCampaign({ [ECON]: rationEconomy() }, (root) => {
    for (const systemValue of [undefined, 0, -1, NaN, Infinity, '1500']) {
      assert.equal(priceProposal(root, { ...PROPOSAL, systemValue }).status, 'bad-system-value', String(systemValue));
    }
  });
});

test('priceProposal without a row for the reference food is no-reference-row', () => {
  withCampaign({ [ECON]: economyIt() }, (root) => {
    assert.equal(priceProposal(root, PROPOSAL).status, 'no-reference-row');
    assert.equal(priceProposal(root, { ...PROPOSAL, referenceLabels: [] }).status, 'no-reference-row');
  });
});

test('priceProposal with a reference row that has no usable range is no-reference-row', () => {
  withCampaign({ [ECON]: rationEconomy(['', '2', 'corona']) }, (root) => {
    assert.equal(priceProposal(root, PROPOSAL).status, 'no-reference-row');
  });
  withCampaign({ [ECON]: rationEconomy(['2', '2', 'fiorino']) }, (root) => {
    assert.equal(priceProposal(root, PROPOSAL).status, 'no-reference-row');
  });
});
