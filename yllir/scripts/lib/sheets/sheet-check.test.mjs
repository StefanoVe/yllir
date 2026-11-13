import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkSheets } from './sheet-check.mjs';

function campaign(language = 'it') {
  return [
    'name: Test',
    'language:',
    `  main: ${language}`,
    'structure:',
    '  - id: luoghi',
    '    folder: Mondo',
    '    type: places',
    '  - id: personaggi',
    '    folder: Personaggi',
    '    type: subjects',
    '  - id: creature',
    '    folder: Creature',
    '    type: subjects',
    '',
  ].join('\n');
}

const PLACE = '---\nid: borgo\n---\n\n# Borgo\n\nUn borgo di pietra.\n';

const IT_BODY_NO_STATS = [
  '# Oria Valdes',
  '',
  '## Ruolo',
  '',
  'Fabbra del borgo.',
  '',
  '## Aspetto e modi',
  '',
  'Alta, con le mani segnate.',
  '',
  '## Al tavolo',
  '',
  'Diffidente ma leale.',
  '',
].join('\n');

// The Statistics section of a character: one characteristics table and one action (combat row).
const IT_STATS_BLOCK = [
  '## Statistiche',
  '',
  '### Caratteristiche',
  '',
  '| Caratteristica | Valore |',
  '| --- | --- |',
  '| CA | 12 |',
  '',
  '### Attacchi e capacità',
  '',
  '| Attacco o capacità | Dettagli |',
  '| --- | --- |',
  '| Pugnale | Attacco in mischia: +4, portata 1,5 m. Colpisce: 1d4 + 2 danni perforanti. |',
  '',
].join('\n');

const IT_BODY = IT_BODY_NO_STATS + '\n' + IT_STATS_BLOCK;

const IT_VENDOR_BODY =
  IT_BODY +
  '\n## Assortimento\n\n| Oggetto | Prezzo | Nota |\n| --- | --- | --- |\n| Chiodi | 1 scudo | |\n';

const IT_ENEMY_BODY = [
  '# Lupo',
  '',
  '## Natura',
  '',
  'Un predatore grigio.',
  '',
  '## Statistiche',
  '',
  '### Caratteristiche',
  '',
  '| Caratteristica | Valore |',
  '| --- | --- |',
  '| CA | 12 |',
  '| PF | 11 |',
  '',
  '### Attacchi e capacità',
  '',
  '| Attacco o capacità | Dettagli |',
  '| --- | --- |',
  '| Morso | Colpisce: 1d6 + 2 danni perforanti. |',
  '',
  '## Bottino',
  '',
  'Pelliccia.',
  '',
].join('\n');

const IT_CREATURE_BODY = [
  '# Pesce',
  '',
  '## Natura',
  '',
  'Un pesce lento.',
  '',
  '## Statistiche',
  '',
  'Nessuna statistica: non combatte.',
  '',
].join('\n');

function sheet({
  id = 'oria-valdes',
  template = 'npc',
  location = '[borgo]',
  aliases = null,
  body = IT_BODY,
} = {}) {
  const fm = [];
  if (id !== null) fm.push(`id: ${id}`);
  if (template !== null) fm.push(`template: ${template}`);
  if (location !== null) fm.push(`location: ${location}`);
  if (aliases !== null) fm.push(`aliases: ${aliases}`);
  return `---\n${fm.join('\n')}\n---\n\n${body}`;
}

/** Writes a temporary campaign, runs `fn` on it and removes it afterwards. */
function withCampaign(files, fn, language = 'it') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  try {
    const all = { 'campaign.yaml': campaign(language), 'Mondo/Borgo.md': PLACE, ...files };
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

function codesOf(result) {
  return result.errors.map((e) => e.code);
}

test('a valid it sheet passes', () => {
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet() }, (root) => {
    const result = checkSheets(root);
    assert.deepEqual(result.checked, ['Personaggi/Oria Valdes.md']);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.errors, []);
  });
});

test('a valid sheet with a master block and optional sections passes', () => {
  const body = [
    '# Oria Valdes',
    '',
    '## Ruolo',
    '',
    'Fabbra.',
    '',
    '## Aspetto e modi',
    '',
    'Alta.',
    '',
    '## Al tavolo',
    '',
    'Leale.',
    '',
    '## Statistiche',
    '',
    '### Caratteristiche',
    '',
    '| Caratteristica | Valore |',
    '| --- | --- |',
    '| CA | 12 |',
    '',
    '### Attacchi e capacità',
    '',
    '| Attacco o capacità | Dettagli |',
    '| --- | --- |',
    '| Pugnale | Colpisce: 1d4 + 2 danni perforanti. |',
    '',
    '## Assortimento',
    '',
    'Chiodi.',
    '',
    '<!-- master -->',
    '## Master',
    '### Indicazioni per il master',
    '',
    'Non dire il segreto.',
    '<!-- /master -->',
    '',
  ].join('\n');
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body, aliases: '[Oria]' }) }, (root) => {
    assert.deepEqual(checkSheets(root).errors, []);
  });
});

test('missing-id: no id key, and no frontmatter at all', () => {
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ id: null }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['missing-id']);
  });
  withCampaign({ 'Personaggi/Oria Valdes.md': IT_BODY }, (root) => {
    const result = checkSheets(root);
    assert.deepEqual(result.checked, ['Personaggi/Oria Valdes.md']);
    assert.ok(codesOf(result).includes('missing-id'));
  });
});

test('invalid-location: location is not a list', () => {
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ location: 'borgo' }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['invalid-location']);
  });
});

test('unknown-location: an item is not a place id, and the message names it', () => {
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ location: '[nowhere]' }) }, (root) => {
    const result = checkSheets(root);
    assert.deepEqual(codesOf(result), ['unknown-location']);
    assert.match(result.errors[0].message, /nowhere/);
  });
});

test('an empty location list is allowed', () => {
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ location: '[]' }) }, (root) => {
    assert.deepEqual(checkSheets(root).errors, []);
  });
});

test('invalid-aliases: aliases present but not a list', () => {
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ aliases: 'Oria' }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['invalid-aliases']);
  });
});

test('title: differs from the file name, or is missing', () => {
  const body = IT_BODY.replace('# Oria Valdes', '# Altro nome');
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['title']);
  });
  const noTitle = IT_BODY.replace('# Oria Valdes\n\n', '');
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body: noTitle }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['title']);
  });
});

test('section-missing: a required section is absent, and the message names it', () => {
  const body = IT_BODY.replace('## Al tavolo\n\nDiffidente ma leale.\n', '');
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body }) }, (root) => {
    const result = checkSheets(root);
    assert.deepEqual(codesOf(result), ['section-missing']);
    assert.match(result.errors[0].message, /Al tavolo/);
  });
});

test('section-order: required sections swapped', () => {
  const body = [
    '# Oria Valdes',
    '',
    '## Aspetto e modi',
    '',
    'Alta.',
    '',
    '## Ruolo',
    '',
    'Fabbra.',
    '',
    '## Al tavolo',
    '',
    'Leale.',
    '',
  ].join('\n') + '\n' + IT_STATS_BLOCK;
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['section-order']);
  });
});

test('section-order: an optional section before a required one', () => {
  const body = IT_BODY_NO_STATS.replace(
    '## Ruolo\n',
    '## Statistiche\n\nCA 12.\n\n## Ruolo\n',
  );
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body }) }, (root) => {
    assert.ok(codesOf(checkSheets(root)).includes('section-order'));
  });
});

test('section-empty: a required section has no text', () => {
  const body = IT_BODY.replace('Fabbra del borgo.', '');
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body }) }, (root) => {
    const result = checkSheets(root);
    assert.deepEqual(codesOf(result), ['section-empty']);
    assert.match(result.errors[0].message, /Ruolo/);
  });
});

test('section-unknown: a ## section outside the model', () => {
  const body = IT_BODY + '\n## Note\n\nAltro.\n';
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body }) }, (root) => {
    const result = checkSheets(root);
    assert.deepEqual(codesOf(result), ['section-unknown']);
    assert.match(result.errors[0].message, /Note/);
  });
});

test('master-block: content after the master block', () => {
  const body = [
    IT_BODY,
    '<!-- master -->',
    '## Master',
    '### Indicazioni per il master',
    '',
    'Segreto.',
    '<!-- /master -->',
    '',
    '| Ultima | Testo dopo il blocco. |',
    '',
  ].join('\n');
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['master-block']);
  });
});

test('master-block: unclosed master block, and ## Master not first', () => {
  const unclosed = IT_BODY + '<!-- master -->\n## Master\n\nSegreto.\n';
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body: unclosed }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['master-block']);
  });
  const notFirst = IT_BODY + '<!-- master -->\n### Indicazioni\n\nSegreto.\n<!-- /master -->\n';
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body: notFirst }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['master-block']);
  });
});

test('a vendor sheet is checked like an npc, with its Stock section', () => {
  withCampaign(
    { 'Personaggi/Oria Valdes.md': sheet({ template: 'vendor', location: 'borgo', body: IT_VENDOR_BODY }) },
    (root) => {
      const result = checkSheets(root);
      assert.deepEqual(result.checked, ['Personaggi/Oria Valdes.md']);
      assert.deepEqual(codesOf(result), ['invalid-location']);
    },
  );
});

test('a valid vendor sheet with every optional section in order passes', () => {
  const body = [
    '# Oria Valdes',
    '',
    '## Ruolo',
    '',
    'Fabbra.',
    '',
    '## Aspetto e modi',
    '',
    'Alta.',
    '',
    '## Al tavolo',
    '',
    'Leale.',
    '',
    '## Statistiche',
    '',
    '### Caratteristiche',
    '',
    '| Caratteristica | Valore |',
    '| --- | --- |',
    '| CA | 12 |',
    '',
    '### Attacchi e capacità',
    '',
    '| Attacco o capacità | Dettagli |',
    '| --- | --- |',
    '| Pugnale | Colpisce: 1d4 + 2 danni perforanti. |',
    '',
    '## Assortimento',
    '',
    '| Oggetto | Prezzo | Nota |',
    '| --- | --- | --- |',
    '| Chiodi | 1 scudo | |',
    '',
    '## Trattare',
    '',
    'Duro.',
    '',
    '## Deroghe',
    '',
    'Nessuna.',
    '',
    '## Da definire',
    '',
    'Il porto.',
    '',
  ].join('\n');
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ template: 'vendor', body }) }, (root) => {
    assert.deepEqual(checkSheets(root).errors, []);
  });
});

test('vendor without a Stock section: section-missing', () => {
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ template: 'vendor' }) }, (root) => {
    const result = checkSheets(root);
    assert.deepEqual(codesOf(result), ['section-missing']);
    assert.match(result.errors[0].message, /Assortimento/);
  });
});

test('vendor: a Stock section without a table is stock-table', () => {
  const body = IT_BODY + '\n## Assortimento\n\nChiodi.\n';
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ template: 'vendor', body }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['stock-table']);
  });
});

test('vendor: a table with the wrong columns is stock-table, folded case is accepted', () => {
  const wrong = IT_BODY + '\n## Assortimento\n\n| Oggetto | Prezzo | Note extra |\n| --- | --- | --- |\n| Chiodi | 1 | |\n';
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ template: 'vendor', body: wrong }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['stock-table']);
  });
  const reordered = IT_BODY + '\n## Assortimento\n\n| Prezzo | Oggetto | Nota |\n| --- | --- | --- |\n| 1 | Chiodi | |\n';
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ template: 'vendor', body: reordered }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['stock-table']);
  });
  const folded = IT_BODY + '\n## Assortimento\n\n|  oggetto | PREZZO | nota |\n| --- | --- | --- |\n| Chiodi | 1 | |\n';
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ template: 'vendor', body: folded }) }, (root) => {
    assert.deepEqual(checkSheets(root).errors, []);
  });
});

test('vendor: Haggling before Stock is section-order', () => {
  const body = IT_BODY + '\n## Trattare\n\nDuro.\n\n## Assortimento\n\n| Oggetto | Prezzo | Nota |\n| --- | --- | --- |\n';
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ template: 'vendor', body }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['section-order']);
  });
});

test('an enemy sheet is checked, not skipped', () => {
  withCampaign(
    {
      'Creature/Lupo.md': sheet({
        id: 'lupo',
        template: 'enemy',
        body: '# Lupo\n\n## Natura\n\nTesto.\n',
      }),
    },
    (root) => {
      const result = checkSheets(root);
      assert.deepEqual(result.checked, ['Creature/Lupo.md']);
      assert.deepEqual(result.skipped, []);
      assert.deepEqual(codesOf(result), ['section-missing']);
    },
  );
});

test('a valid enemy sheet passes, with its optional Loot section', () => {
  withCampaign({ 'Creature/Lupo.md': sheet({ id: 'lupo', template: 'enemy', body: IT_ENEMY_BODY }) }, (root) => {
    const result = checkSheets(root);
    assert.deepEqual(result.checked, ['Creature/Lupo.md']);
    assert.deepEqual(result.errors, []);
  });
});

test('enemy: a missing Statistics section is section-missing', () => {
  const body = IT_ENEMY_BODY.replace(/## Statistiche\n\n[\s\S]*?\n## Bottino\n/, '## Bottino\n');
  withCampaign({ 'Creature/Lupo.md': sheet({ id: 'lupo', template: 'enemy', body }) }, (root) => {
    const result = checkSheets(root);
    assert.deepEqual(codesOf(result), ['section-missing']);
    assert.match(result.errors[0].message, /Statistiche/);
  });
});

test('enemy: a location absent is invalid-location, an empty list is valid', () => {
  withCampaign(
    { 'Creature/Lupo.md': sheet({ id: 'lupo', template: 'enemy', location: null, body: IT_ENEMY_BODY }) },
    (root) => {
      assert.deepEqual(codesOf(checkSheets(root)), ['invalid-location']);
    },
  );
  withCampaign(
    { 'Creature/Lupo.md': sheet({ id: 'lupo', template: 'enemy', location: '[]', body: IT_ENEMY_BODY }) },
    (root) => {
      assert.deepEqual(checkSheets(root).errors, []);
    },
  );
});

test('enemy: Loot before Nature is section-order', () => {
  const body = [
    '# Lupo',
    '',
    '## Bottino',
    '',
    'Pelliccia.',
    '',
    '## Natura',
    '',
    'Un predatore grigio.',
    '',
    '## Statistiche',
    '',
    '### Caratteristiche',
    '',
    '| Caratteristica | Valore |',
    '| --- | --- |',
    '| CA | 12 |',
    '',
    '### Attacchi e capacità',
    '',
    '| Attacco o capacità | Dettagli |',
    '| --- | --- |',
    '| Morso | Colpisce: 1d6 + 2 danni perforanti. |',
    '',
  ].join('\n');
  withCampaign({ 'Creature/Lupo.md': sheet({ id: 'lupo', template: 'enemy', body }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['section-order']);
  });
});

test('creature: a valid sheet with the phrase passes, without it is creature-statistics', () => {
  withCampaign({ 'Creature/Pesce.md': sheet({ id: 'pesce', template: 'creature', body: IT_CREATURE_BODY }) }, (root) => {
    assert.deepEqual(checkSheets(root).errors, []);
  });
  const body = IT_CREATURE_BODY.replace('Nessuna statistica: non combatte.', 'CA 12.');
  withCampaign({ 'Creature/Pesce.md': sheet({ id: 'pesce', template: 'creature', body }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['creature-statistics']);
  });
});

test('creature: the phrase is checked in English too, and other languages skip it', () => {
  const en = [
    '# Fish',
    '',
    '## Nature',
    '',
    'A slow fish.',
    '',
    '## Statistics',
    '',
    '### Characteristics',
    '',
    '| Characteristic | Value |',
    '| --- | --- |',
    '| AC | 12 |',
    '',
  ].join('\n');
  withCampaign(
    { 'Creature/Fish.md': sheet({ id: 'fish', template: 'creature', body: en }) },
    (root) => {
      assert.deepEqual(codesOf(checkSheets(root)), ['creature-statistics']);
    },
    'en',
  );
  withCampaign(
    {
      'Creature/Fish.md': sheet({
        id: 'fish',
        template: 'creature',
        body: en.replace('| AC | 12 |', 'No statistics: it does not fight.'),
      }),
    },
    (root) => {
      assert.deepEqual(checkSheets(root).errors, []);
    },
    'en',
  );
  const fr = '# Pesce\n\n## Natura\n\nUn pesce.\n\n## Statistiche\n\nCA 12.\n';
  withCampaign({ 'Creature/Pesce.md': sheet({ id: 'pesce', template: 'creature', body: fr }) }, (root) => {
    assert.deepEqual(checkSheets(root).errors, []);
  }, 'fr');
});

test('an en campaign works for an enemy with English headings', () => {
  const body = [
    '# Wolf',
    '',
    '## Nature',
    '',
    'A grey hunter.',
    '',
    '## Statistics',
    '',
    '### Characteristics',
    '',
    '| Characteristic | Value |',
    '| --- | --- |',
    '| AC | 12 |',
    '',
    '### Attacks and abilities',
    '',
    '| Attack or ability | Details |',
    '| --- | --- |',
    '| Bite | Hits: 1d6 + 1 piercing damage. |',
    '',
    '## Loot',
    '',
    'Fur.',
    '',
  ].join('\n');
  withCampaign(
    { 'Creature/Wolf.md': sheet({ id: 'wolf', template: 'enemy', body }) },
    (root) => {
      const result = checkSheets(root);
      assert.deepEqual(result.checked, ['Creature/Wolf.md']);
      assert.deepEqual(result.errors, []);
    },
    'en',
  );
});

test('an image under the title is allowed in every model and is not a section', () => {
  const image = '![Ritratto di prova](img/ritratto.png)\n\n';
  const cases = [
    ['Personaggi/Oria Valdes.md', 'npc', IT_BODY],
    ['Personaggi/Oria Valdes.md', 'vendor', IT_VENDOR_BODY],
    ['Creature/Lupo.md', 'enemy', IT_ENEMY_BODY],
    ['Creature/Pesce.md', 'creature', IT_CREATURE_BODY],
  ];
  for (const [rel, template, body] of cases) {
    const titled = body.replace(/^(# .*\n\n)/, `$1${image}`);
    assert.notEqual(titled, body);
    withCampaign({ [rel]: sheet({ template, body: titled, id: 'x' }) }, (root) => {
      assert.deepEqual(checkSheets(root).errors.map((e) => e.code), [], template);
    });
  }
});

test('files restricts the check to the listed sheets', () => {
  const bad = sheet({ location: 'borgo' });
  withCampaign(
    {
      'Personaggi/Oria Valdes.md': bad,
      'Personaggi/Lino Valdes.md': sheet({ id: 'lino-valdes', location: 'borgo' }).replace(
        '# Oria Valdes',
        '# Lino Valdes',
      ),
    },
    (root) => {
      const result = checkSheets(root, { files: ['Personaggi/Oria Valdes.md'] });
      assert.deepEqual(result.checked, ['Personaggi/Oria Valdes.md']);
      assert.ok(result.errors.every((e) => e.file === 'Personaggi/Oria Valdes.md'));
      assert.ok(!result.checked.includes('Personaggi/Lino Valdes.md'));
      assert.ok(!result.skipped.includes('Personaggi/Lino Valdes.md'));
    },
  );
});

test('files: a path that is not a candidate goes to skipped', () => {
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet() }, (root) => {
    const result = checkSheets(root, { files: ['Mondo/Borgo.md', 'Personaggi/Nessuno.md'] });
    assert.deepEqual(result.checked, []);
    assert.deepEqual(result.skipped, ['Mondo/Borgo.md', 'Personaggi/Nessuno.md']);
  });
});

test('an en campaign uses the English section names', () => {
  const body = [
    '# Oria Valdes',
    '',
    '## Role',
    '',
    'Smith.',
    '',
    '## Appearance and manner',
    '',
    'Tall.',
    '',
    '## At the table',
    '',
    'Loyal.',
    '',
    '## Statistics',
    '',
    '### Characteristics',
    '',
    '| Characteristic | Value |',
    '| --- | --- |',
    '| AC | 12 |',
    '',
    '### Attacks and abilities',
    '',
    '| Attack or ability | Details |',
    '| --- | --- |',
    '| Dagger | Hits: 1d4 + 2 piercing damage. |',
    '',
    '## Stock',
    '',
    'Nails.',
    '',
  ].join('\n');
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body }) }, (root) => {
    assert.deepEqual(checkSheets(root).errors, []);
  }, 'en');

  withCampaign({ 'Personaggi/Oria Valdes.md': sheet() }, (root) => {
    const codes = codesOf(checkSheets(root));
    assert.ok(codes.includes('section-missing'));
    assert.ok(codes.includes('section-unknown'));
  }, 'en');
});

test('a campaign in another language skips the section names', () => {
  const body = '# Oria Valdes\n\n## Qualcosa\n\nTesto libero.\n';
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body }) }, (root) => {
    assert.deepEqual(checkSheets(root).errors, []);
  }, 'fr');

  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body: '# Altro\n\nTesto.\n' }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['title']);
  }, 'fr');
});

test('statistics must use the localized tables, including optional npc statistics', () => {
  const npcWithStats = IT_BODY;
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body: npcWithStats }) }, (root) => {
    assert.deepEqual(checkSheets(root).errors, []);
  });
  const legacy = IT_ENEMY_BODY.replace(/### Caratteristiche[\s\S]*?(?=\n## Bottino)/, 'CA 12, 11 PF.\n');
  withCampaign({ 'Creature/Lupo.md': sheet({ id: 'lupo', template: 'enemy', body: legacy }) }, (root) => {
    assert.ok(codesOf(checkSheets(root)).includes('statistics-table'));
  });
  const noFightEnemy = IT_ENEMY_BODY.replace(/### Caratteristiche[\s\S]*?(?=\n## Bottino)/, 'Nessuna statistica: non combatte.\n');
  withCampaign({ 'Creature/Lupo.md': sheet({ id: 'lupo', template: 'enemy', body: noFightEnemy }) }, (root) => {
    assert.ok(codesOf(checkSheets(root)).includes('statistics-table'));
  });
  const badHeading = IT_ENEMY_BODY.replace('### Caratteristiche', '#### Note');
  withCampaign({ 'Creature/Lupo.md': sheet({ id: 'lupo', template: 'enemy', body: badHeading }) }, (root) => {
    assert.ok(codesOf(checkSheets(root)).includes('statistics-table'));
  });
});

test('a sheet with template item is still skipped', () => {
  withCampaign(
    {
      'Creature/Lanterna.md': '---\nid: lanterna\ntemplate: item\n---\n\n# Lanterna\n\nTesto.\n',
    },
    (root) => {
      const result = checkSheets(root);
      assert.deepEqual(result.checked, []);
      assert.deepEqual(result.skipped, ['Creature/Lanterna.md']);
      assert.deepEqual(result.errors, []);
    },
  );
});

test('npc: a Statistics section is required, and the message names it', () => {
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body: IT_BODY_NO_STATS }) }, (root) => {
    const result = checkSheets(root);
    assert.deepEqual(codesOf(result), ['section-missing']);
    assert.match(result.errors[0].message, /Statistiche/);
  });
});

test('npc: a Statistics section with a characteristics table and one action row passes', () => {
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet() }, (root) => {
    assert.deepEqual(checkSheets(root).errors, []);
  });
});

test('npc: an actions table with only header and separator is statistics-no-actions', () => {
  const body = IT_BODY.replace(
    '| Pugnale | Attacco in mischia: +4, portata 1,5 m. Colpisce: 1d4 + 2 danni perforanti. |\n',
    '',
  );
  assert.notEqual(body, IT_BODY);
  withCampaign({ 'Personaggi/Oria Valdes.md': sheet({ body }) }, (root) => {
    const result = checkSheets(root);
    assert.deepEqual(codesOf(result), ['statistics-no-actions']);
    assert.match(result.errors[0].message, /Attacchi e capacità/);
  });
});

test('npc sketch: only the title and the first required section are checked', () => {
  const text = '---\nid: oria-valdes\ntemplate: npc\nlocation: [borgo]\nsketch: true\n---\n\n# Oria Valdes\n\n## Ruolo\n\nFabbra del borgo.\n';
  withCampaign({ 'Personaggi/Oria Valdes.md': text }, (root) => {
    const result = checkSheets(root);
    assert.deepEqual(codesOf(result), []);
  });
});

test('enemy: a Statistics section with only the placeholder is statistics-no-actions', () => {
  const body = '# Lupo\n\n## Natura\n\nUn predatore grigio.\n\n## Statistiche\n\nDa definire.\n';
  withCampaign({ 'Creature/Lupo.md': sheet({ id: 'lupo', template: 'enemy', body }) }, (root) => {
    assert.deepEqual(codesOf(checkSheets(root)), ['statistics-no-actions']);
  });
});

test('creature: a sheet without combat actions is not asked for an action', () => {
  const body = '# Pesce\n\n## Natura\n\nUn pesce lento.\n\n## Statistiche\n\nNessuna statistica: non combatte.\n';
  withCampaign({ 'Creature/Pesce.md': sheet({ id: 'pesce', template: 'creature', body }) }, (root) => {
    assert.deepEqual(checkSheets(root).errors, []);
  });
});
