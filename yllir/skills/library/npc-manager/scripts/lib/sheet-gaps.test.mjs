import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sheetGaps } from './sheet-gaps.mjs';

const CAMPAIGN = [
  'name: Test',
  'language:',
  '  main: it',
  'structure:',
  '  - id: luoghi',
  '    folder: Mondo',
  '    type: places',
  '  - id: personaggi',
  '    folder: Personaggi',
  '    type: subjects',
  '',
].join('\n');

// Public text well above the 120 characters of the thin-sheet rule.
const LONG =
  'La costa collega i villaggi di pesca al porto principale, con strade poche e spesso chiuse dalle mareggiate di autunno, quando il vento gira a levante.';

/** Builds an npc or vendor sheet from the text of its three sections. */
function npcSheet({ template = 'npc', role = LONG, appearance = `_${LONG}_`, table = LONG, tail = '' } = {}) {
  return [
    '---',
    'id: ilde-varno',
    `template: ${template}`,
    'location: [porto]',
    '---',
    '',
    '# Ilde Varno',
    '',
    '## Ruolo',
    '',
    role,
    '',
    '## Aspetto e modi',
    '',
    appearance,
    '',
    '## Al tavolo',
    '',
    table,
    '',
    tail,
  ].join('\n');
}

/** Writes a temporary campaign, runs `fn` on its root and removes it afterwards. */
function withCampaign(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-sheet-gaps-'));
  try {
    const all = { 'campaign.yaml': CAMPAIGN, ...files };
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

/** Codes and section keys of the gaps of one sheet, in order. */
function codesOf(sheet) {
  return sheet.gaps.map((gap) => `${gap.code} ${gap.section}`);
}

test('an npc with all three sections filled is usable', () => {
  withCampaign({ 'Personaggi/Ilde Varno.md': npcSheet() }, (root) => {
    const { sheets } = sheetGaps(root, { files: ['Personaggi/Ilde Varno.md'] });
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].template, 'npc');
    assert.equal(sheets[0].status, 'usable');
    assert.deepEqual(sheets[0].gaps, []);
  });
});

test('an npc whose sections say Da definire. has empty-section gaps and is to-complete', () => {
  const placeholder = npcSheet({
    role: 'Da definire.',
    appearance: 'To be defined.',
    table: 'da definire',
  });
  withCampaign({ 'Personaggi/Ilde Varno.md': placeholder }, (root) => {
    const [sheet] = sheetGaps(root, { files: ['Personaggi/Ilde Varno.md'] }).sheets;
    assert.equal(sheet.status, 'to-complete');
    assert.deepEqual(codesOf(sheet), [
      'empty-section role',
      'empty-section appearance',
      'empty-section table',
      'thin-sheet sheet',
    ]);
  });
});

test('an almost empty npc gives only thin-sheet', () => {
  const thin = npcSheet({ role: 'Locandiera.', appearance: '_Capelli grigi._', table: 'Parla poco.' });
  withCampaign({ 'Personaggi/Ilde Varno.md': thin }, (root) => {
    const [sheet] = sheetGaps(root, { files: ['Personaggi/Ilde Varno.md'] }).sheets;
    assert.equal(sheet.status, 'to-complete');
    assert.deepEqual(codesOf(sheet), ['thin-sheet sheet']);
    assert.match(sheet.gaps[0].message, /^public text has \d+ characters, at least 120 are needed$/);
  });
});

test('a vendor with a stock header only gives empty-stock, with a data row it is usable', () => {
  const header = npcSheet({
    template: 'vendor',
    tail: '## Assortimento\n\n| Oggetto | Prezzo | Nota |\n| --- | --- | --- |\n',
  });
  const filled = npcSheet({
    template: 'vendor',
    tail: '## Assortimento\n\n| Oggetto | Prezzo | Nota |\n| --- | --- | --- |\n| Chiodi | 1 scudo | |\n',
  });
  withCampaign({ 'Personaggi/Oria.md': header, 'Personaggi/Ilde.md': filled }, (root) => {
    const sheets = sheetGaps(root, { files: ['Personaggi/Oria.md', 'Personaggi/Ilde.md'] }).sheets;
    assert.deepEqual(codesOf(sheets[0]), ['empty-stock stock']);
    assert.equal(sheets[0].status, 'to-complete');
    assert.equal(sheets[1].status, 'usable');
  });
});

test('a place without an italic opening gives no-opening; an italic line under the title or at the start of the section is accepted', () => {
  const noOpening = `---\nid: porto\ntemplate: place\n---\n\n# Porto\n\n## Descrizione\n\n${LONG}\n`;
  const underTitle = `---\nid: porto\ntemplate: place\n---\n\n# Porto\n\n_${LONG}_\n\n## Descrizione\n\n${LONG}\n`;
  const atStart = `---\nid: porto\ntemplate: place\n---\n\n# Porto\n\n## Descrizione\n\n_${LONG}_\n\n${LONG}\n`;
  withCampaign(
    { 'Mondo/Porto.md': noOpening, 'Mondo/Costa.md': underTitle, 'Mondo/Faro.md': atStart },
    (root) => {
      const files = ['Mondo/Porto.md', 'Mondo/Costa.md', 'Mondo/Faro.md'];
      const sheets = sheetGaps(root, { files }).sheets;
      assert.equal(sheets[0].template, 'place');
      assert.deepEqual(codesOf(sheets[0]), ['no-opening description']);
      assert.equal(sheets[1].status, 'usable');
      assert.equal(sheets[2].status, 'usable');
    },
  );
});

test('an enemy with Da definire. statistics gives empty-section on statistics', () => {
  const enemy = [
    '---',
    'id: lupo',
    'template: enemy',
    'location: []',
    '---',
    '',
    '# Lupo',
    '',
    '## Natura',
    '',
    LONG,
    '',
    '## Statistiche',
    '',
    'Da definire.',
    '',
  ].join('\n');
  withCampaign({ 'Creature/Lupo.md': enemy }, (root) => {
    const [sheet] = sheetGaps(root, { files: ['Creature/Lupo.md'] }).sheets;
    assert.equal(sheet.template, 'enemy');
    assert.deepEqual(codesOf(sheet), ['empty-section statistics']);
    assert.equal(sheet.status, 'to-complete');
  });
});

test('a creature with the fixed statistics sentence is usable, and its statistics are never a gap', () => {
  const creature = [
    '---',
    'id: pesce',
    'template: creature',
    'location: []',
    '---',
    '',
    '# Pesce',
    '',
    '## Natura',
    '',
    LONG,
    '',
    '## Statistiche',
    '',
    'Nessuna statistica: non combatte.',
    '',
  ].join('\n');
  const withoutStatistics = creature.replace(/## Statistiche[\s\S]*$/, '');
  withCampaign({ 'Creature/Pesce.md': creature, 'Creature/Alga.md': withoutStatistics.replace('Pesce', 'Alga') }, (root) => {
    const sheets = sheetGaps(root, { files: ['Creature/Pesce.md', 'Creature/Alga.md'] }).sheets;
    assert.equal(sheets[0].status, 'usable');
    assert.equal(sheets[1].status, 'usable');
  });
});

test('--base reads the files from that folder instead of the campaign root', () => {
  const thin = npcSheet({ role: 'Locandiera.', appearance: '_Capelli grigi._', table: 'Parla poco.' });
  withCampaign(
    {
      'Personaggi/Ilde Varno.md': npcSheet(),
      '.campaign/state/write/draft/Personaggi/Ilde Varno.md': thin,
    },
    (root) => {
      const files = ['Personaggi/Ilde Varno.md'];
      const fromRoot = sheetGaps(root, { files }).sheets[0];
      assert.equal(fromRoot.status, 'usable');

      const fromDraft = sheetGaps(root, { files, base: '.campaign/state/write/draft' }).sheets[0];
      assert.equal(fromDraft.status, 'to-complete');
      assert.deepEqual(codesOf(fromDraft), ['thin-sheet sheet']);
    },
  );
});

test('the master block is ignored: it is never text and never printed', () => {
  const secret = 'SEGRETO-DEL-MASTER: il personaggio nasconde un debito con il re di Vaer, lungo e dettagliato.';
  const tail = [
    '<!-- master -->',
    '## Master',
    '',
    '### Indicazioni per il master',
    '',
    secret,
    '<!-- /master -->',
    '',
  ].join('\n');
  // The public `## Al tavolo` section is empty: the master text must not fill it.
  const sheet = npcSheet({ table: '', tail });
  withCampaign({ 'Personaggi/Ilde Varno.md': sheet }, (root) => {
    const result = sheetGaps(root, { files: ['Personaggi/Ilde Varno.md'] });
    const [only] = result.sheets;
    assert.deepEqual(codesOf(only), ['empty-section table']);
    assert.equal(only.status, 'to-complete');
    assert.equal(JSON.stringify(result).includes('SEGRETO'), false);
  });
});

test('a sheet of another template, or with no template and no description, is not-applicable', () => {
  withCampaign(
    {
      'Eventi/Scena.md': '---\nid: scena\ntemplate: scene\n---\n\n# Scena\n\nTesto.\n',
      'Eventi/Nota.md': '# Nota\n\nTesto senza descrizione.\n',
    },
    (root) => {
      const sheets = sheetGaps(root, { files: ['Eventi/Scena.md', 'Eventi/Nota.md'] }).sheets;
      assert.deepEqual(
        sheets.map((s) => [s.file, s.status, s.gaps.length]),
        [
          ['Eventi/Scena.md', 'not-applicable', 0],
          ['Eventi/Nota.md', 'not-applicable', 0],
        ],
      );
    },
  );
});

test('a file outside the campaign root, or a missing file, is an error', () => {
  withCampaign({ 'Personaggi/Ilde Varno.md': npcSheet() }, (root) => {
    assert.throws(() => sheetGaps(root, { files: ['../outside.md'] }), /outside the campaign root/);
    assert.throws(() => sheetGaps(root, { files: ['Personaggi/Nessuno.md'] }), /does not exist/);
    assert.throws(() => sheetGaps(root, { files: ['Personaggi/Ilde Varno.md'], base: '..' }), /outside the campaign root/);
  });
});
