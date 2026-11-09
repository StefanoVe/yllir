import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plotCast } from './plot-cast.mjs';

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: people',
  '    folder: Personaggi',
  '    type: subjects',
  '  - id: places',
  '    folder: Mondo',
  '    type: places',
  '  - id: plot',
  '    folder: Trama',
  '    type: plot',
  '',
].join('\n');

const NPC = (id, title) => `---\nid: ${id}\ntemplate: npc\n---\n\n# ${title}\n\nUn testo.\n`;

const BASE = {
  'Personaggi/Ilde Varno.md': NPC('ilde-varno', 'Ilde Varno'),
  'Personaggi/Teodo Marr.md': NPC('teodo-marr', 'Teodo Marr'),
  'Personaggi/Oria Valdes.md': NPC('oria-valdes', 'Oria Valdes'),
  'Personaggi/Lino.md': '---\nid: lino\n---\n\n# Lino\n\nUn testo.\n',
  'Mondo/Porto.md': '---\nid: porto\ntemplate: place\n---\n\n# Porto\n\nUn testo.\n',
};

const MAIN = '---\nid: sessione-1\ngenerated: true\n---\n\n# Sessione 1\n\nRiepilogo.\n';

/** Event sheet with a session key and optional extra frontmatter lines. */
function event(id, extra = '', body = '# Scena\n\nNarrazione.\n') {
  return `---\nid: ${id}\nsession: 1\n${extra}---\n\n${body}`;
}

/** Writes a temporary campaign, runs `fn` on it and removes it afterwards. */
function withCampaign(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-cast-'));
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

const EVENT_PATH = 'Trama/Sessione 1/Eventi/Arrivo.md';

test('declared character with an npc sheet gives no error', () => {
  withCampaign(
    {
      ...BASE,
      'Trama/Sessione 1/Sessione 1.md': MAIN,
      [EVENT_PATH]: event('arrivo', 'characters: [ilde-varno]\n'),
    },
    (root) => {
      const result = plotCast(root);
      assert.deepEqual(result.errors, []);
      assert.equal(result.events, 1);
      assert.equal(result.declared, 1);
    },
  );
});

test('id without a sheet gives character-no-sheet', () => {
  withCampaign(
    {
      ...BASE,
      [EVENT_PATH]: event('arrivo', 'characters: [nessuno]\n'),
    },
    (root) => {
      const result = plotCast(root);
      assert.deepEqual(result.errors, [
        { code: 'character-no-sheet', file: EVENT_PATH, message: 'no sheet for character nessuno' },
      ]);
    },
  );
});

test('id of a place sheet gives character-not-npc', () => {
  withCampaign(
    {
      ...BASE,
      [EVENT_PATH]: event('arrivo', 'characters: [porto]\n'),
    },
    (root) => {
      const result = plotCast(root);
      assert.deepEqual(result.errors, [
        {
          code: 'character-not-npc',
          file: EVENT_PATH,
          message: 'porto is not a character sheet (template: place)',
        },
      ]);
    },
  );
});

test('id of a sheet with no template gives character-not-npc with template none', () => {
  withCampaign(
    {
      ...BASE,
      [EVENT_PATH]: event('arrivo', 'characters: [lino]\n'),
    },
    (root) => {
      const result = plotCast(root);
      assert.deepEqual(result.errors, [
        {
          code: 'character-not-npc',
          file: EVENT_PATH,
          message: 'lino is not a character sheet (template: none)',
        },
      ]);
    },
  );
});

test('characters that is not a list gives invalid-characters', () => {
  withCampaign(
    {
      ...BASE,
      [EVENT_PATH]: event('arrivo', 'characters: oria\n'),
    },
    (root) => {
      const result = plotCast(root);
      assert.deepEqual(result.errors, [
        { code: 'invalid-characters', file: EVENT_PATH, message: 'characters must be a list' },
      ]);
      assert.equal(result.declared, 0);
    },
  );
});

test('duplicate id gives one character-duplicate per extra copy', () => {
  withCampaign(
    {
      ...BASE,
      [EVENT_PATH]: event('arrivo', 'characters: [ilde-varno, ilde-varno, ilde-varno]\n'),
    },
    (root) => {
      const result = plotCast(root);
      assert.deepEqual(
        result.errors.map((e) => e.code),
        ['character-duplicate', 'character-duplicate'],
      );
      assert.equal(result.declared, 3);
    },
  );
});

test('event without characters gives no error and declared 0', () => {
  withCampaign(
    {
      ...BASE,
      [EVENT_PATH]: event('arrivo'),
    },
    (root) => {
      const result = plotCast(root);
      assert.deepEqual(result.errors, []);
      assert.equal(result.declared, 0);
      assert.equal(result.events, 1);
    },
  );
});

test('files restricts the check to the listed events', () => {
  withCampaign(
    {
      ...BASE,
      [EVENT_PATH]: event('arrivo', 'characters: [nessuno]\n'),
      'Trama/Sessione 1/Eventi/Porto.md': event('porto-scena', 'characters: [ilde-varno]\n'),
    },
    (root) => {
      const onlyGood = plotCast(root, { files: ['Trama/Sessione 1/Eventi/Porto.md'] });
      assert.deepEqual(onlyGood.errors, []);
      assert.equal(onlyGood.events, 1);
      assert.equal(onlyGood.declared, 1);

      const onlyBad = plotCast(root, { files: [EVENT_PATH] });
      assert.equal(onlyBad.errors.length, 1);
      assert.equal(onlyBad.events, 1);
    },
  );
});

test('generated session main file is not counted as an event', () => {
  withCampaign(
    {
      ...BASE,
      'Trama/Sessione 1/Sessione 1.md': MAIN,
    },
    (root) => {
      const result = plotCast(root);
      assert.equal(result.events, 0);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.candidates, []);
    },
  );
});

test('missing campaign.yaml structure returns a campaign-config error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-cast-'));
  try {
    const result = plotCast(root);
    assert.equal(result.events, 0);
    assert.equal(result.declared, 0);
    assert.deepEqual(result.candidates, []);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].code, 'campaign-config');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('candidates: unknown capitalised names in prose, skipping known and excluded text', () => {
  const body = [
    '# Arrivo',
    '',
    'Il gruppo parla con Brenna Orsi alla locanda.',
    '',
    'Brenna cammina piano.',
    '',
    'Parla con Teodo Marr e anche Teodo al banco.',
    '',
    '## Piazza Grande',
    '',
    '```',
    'Foo Bar qui',
    '```',
    '',
    '<!-- master -->',
    '## Master',
    '',
    '### Note',
    '',
    'Segreto Nome.',
    '<!-- /master -->',
    '',
  ].join('\n');
  withCampaign(
    {
      ...BASE,
      [EVENT_PATH]: event('arrivo', '', body),
    },
    (root) => {
      const result = plotCast(root);
      assert.deepEqual(result.candidates, [
        { file: EVENT_PATH, line: 8, text: 'Brenna Orsi' },
      ]);
    },
  );
});

test('candidates: a single capitalised word at sentence start is not a candidate', () => {
  const body = '# Arrivo\n\nIl gruppo arriva. Brenna sorride.\n\n- Ilde Varno guarda.\n- Il cane vede Lupo.\n';
  withCampaign(
    {
      ...BASE,
      [EVENT_PATH]: event('arrivo', '', body),
    },
    (root) => {
      const result = plotCast(root);
      assert.deepEqual(
        result.candidates.map((c) => c.text),
        ['Lupo'],
      );
    },
  );
});
