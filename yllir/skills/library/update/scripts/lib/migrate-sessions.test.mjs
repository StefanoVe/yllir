import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateSessions } from './migrate-sessions.mjs';
import { plotMap } from '../../../../../scripts/lib/plot/plot-map.mjs';

const CAMPAIGN = [
  'schema: 1',
  'campaign:',
  '  name: "Prova"',
  'structure:',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '  - id: cronaca',
  '    folder: Cronaca',
  '    type: chronicle',
  '  - id: luoghi',
  '    folder: Mondo',
  '    type: places',
  '',
].join('\n');

function makeCampaign(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-migrate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const all = { 'campaign.yaml': CAMPAIGN, ...files };
  for (const [rel, content] of Object.entries(all)) {
    write(root, rel, content);
  }
  return root;
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

/** Every file of the campaign with its content, for comparing before and after. */
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out[path.relative(root, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
      }
    }
  };
  walk(root);
  return out;
}

const OLD_SESSION = [
  '---',
  'id: ombre-1',
  'depends_on: [prologo]',
  'location: [porto, faro]',
  '---',
  '',
  '# Arrivo',
  '',
  'I personaggi arrivano al porto.',
  '',
  '# Scoperta del diario',
  '',
  'Il diario parla di una fuga.',
  '',
  '# Fuga',
  '',
  'Fine della scena.',
  '',
].join('\n');

const MIGRATED_MAIN = [
  '<!-- yllir',
  'id: ombre-1',
  'depends_on: [prologo]',
  'location: [porto, faro]',
  'arc: "Ombre"',
  'generated: true',
  '-->',
  '',
  'Generated file. Do not edit by hand.',
  '',
].join('\n');

test('an old session with three scenes becomes a folder with a main file and three events', (t) => {
  const root = makeCampaign(t, { 'Trama/Ombre/Sessione 1.md': OLD_SESSION });
  const result = migrateSessions(root);

  assert.deepEqual(result, { migrated: ['Trama/Ombre/Sessione 1.md'], errors: [] });
  assert.equal(exists(root, 'Trama/Ombre/Sessione 1.md'), false);
  assert.equal(exists(root, 'Trama/Ombre'), false, 'the empty arc folder is removed');

  assert.equal(read(root, 'Trama/Sessione 1/Sessione 1.md'), MIGRATED_MAIN);

  assert.deepEqual(fs.readdirSync(path.join(root, 'Trama/Sessione 1/Eventi')).sort(), [
    'Arrivo.md',
    'Fuga.md',
    'Scoperta del diario.md',
  ]);
  assert.equal(
    read(root, 'Trama/Sessione 1/Eventi/Arrivo.md'),
    '<!-- yllir\nid: ombre-1-e01\nsession: ombre-1\ndepends_on: []\nlocation: []\n-->\n\nI personaggi arrivano al porto.\n',
  );
  assert.match(read(root, 'Trama/Sessione 1/Eventi/Scoperta del diario.md'), /^id: ombre-1-e02$/m);
  assert.match(read(root, 'Trama/Sessione 1/Eventi/Fuga.md'), /^id: ombre-1-e03$/m);
  assert.doesNotMatch(read(root, 'Trama/Sessione 1/Eventi/Fuga.md'), /^# Fuga/m);
});

test('text before the first heading goes into the first event', (t) => {
  const root = makeCampaign(t, {
    'Trama/Premessa.md': '---\nid: pre\ndepends_on: []\nlocation: []\n---\n\nNote generali.\n\n# Prima scena\n\nTesto.\n',
  });
  migrateSessions(root);
  assert.equal(read(root, 'Trama/Premessa/Eventi/Prima scena.md').split('-->\n\n')[1], 'Note generali.\n\nTesto.\n');
});

test('the files the migration writes start with the comment form', (t) => {
  const root = makeCampaign(t, { 'Trama/Ombre/Sessione 1.md': OLD_SESSION });
  migrateSessions(root);

  assert.ok(read(root, 'Trama/Sessione 1/Sessione 1.md').startsWith('<!-- yllir\n'));
  const events = fs.readdirSync(path.join(root, 'Trama/Sessione 1/Eventi'));
  assert.equal(events.length, 3);
  for (const name of events) {
    assert.ok(read(root, `Trama/Sessione 1/Eventi/${name}`).startsWith('<!-- yllir\n'), name);
  }
});

test('an old session already written in the comment form is migrated the same way', (t) => {
  const commented = OLD_SESSION.replace('---', '<!-- yllir').replace('---', '-->');
  const root = makeCampaign(t, { 'Trama/Ombre/Sessione 1.md': commented });
  const result = migrateSessions(root);

  assert.deepEqual(result, { migrated: ['Trama/Ombre/Sessione 1.md'], errors: [] });
  assert.equal(read(root, 'Trama/Sessione 1/Sessione 1.md'), MIGRATED_MAIN);
  assert.match(read(root, 'Trama/Sessione 1/Eventi/Arrivo.md'), /^<!-- yllir\nid: ombre-1-e01\n/);
});

test('a file with no heading becomes one event titled with the session name', (t) => {
  const root = makeCampaign(t, {
    'Trama/Sessione 2.md': '---\nid: due\ndepends_on: [1]\nlocation: []\n---\n\nSolo testo, nessun titolo.\n',
  });
  const result = migrateSessions(root);
  assert.deepEqual(result.migrated, ['Trama/Sessione 2.md']);
  assert.deepEqual(fs.readdirSync(path.join(root, 'Trama/Sessione 2/Eventi')), ['Sessione 2.md']);
  assert.match(read(root, 'Trama/Sessione 2/Eventi/Sessione 2.md'), /^id: due-e01$/m);
  assert.match(read(root, 'Trama/Sessione 2/Eventi/Sessione 2.md'), /Solo testo, nessun titolo\.\n$/);
});

test('duplicate titles get numbered file names, and illegal characters are removed', (t) => {
  const root = makeCampaign(t, {
    'Trama/Dup.md': [
      '---', 'id: dup', 'depends_on: []', 'location: []', '---', '',
      '# Scena', 'a', '# Scena', 'b', '# Scena', 'c', '# Dove/quando: ora?', 'd', '# ', 'e', '',
    ].join('\n'),
  });
  migrateSessions(root);
  assert.deepEqual(fs.readdirSync(path.join(root, 'Trama/Dup/Eventi')).sort(), [
    'Dovequando ora.md',
    'Evento 05.md',
    'Scena 2.md',
    'Scena 3.md',
    'Scena.md',
  ]);
  assert.match(read(root, 'Trama/Dup/Eventi/Scena 3.md'), /\n\nc$/);
});

test('a line starting with # inside a code fence is not an event', (t) => {
  const root = makeCampaign(t, {
    'Trama/Codice.md': [
      '---', 'id: codice', 'depends_on: []', 'location: []', '---', '',
      '# Vera scena', '', '```', '# not a heading', '```', '', 'Fine.', '',
    ].join('\n'),
  });
  migrateSessions(root);
  assert.deepEqual(fs.readdirSync(path.join(root, 'Trama/Codice/Eventi')), ['Vera scena.md']);
  assert.match(read(root, 'Trama/Codice/Eventi/Vera scena.md'), /^# not a heading$/m);
});

test('relative links are rewritten from the old place to the new one, with and without an anchor', (t) => {
  const root = makeCampaign(t, {
    'Trama/Ombre/Sessione 1.md': [
      '---', 'id: s1', 'depends_on: []', 'location: []', '---', '',
      '# Arrivo', '',
      'Vai al [porto](../../Mondo/porto.md) o alla [fuga](Sessione%201.md#fuga).',
      '',
      'Un [link esterno](https://example.com/a#b) e [ancora](#arrivo).',
      '',
      '# Fuga', '', 'Fine.', '',
    ].join('\n'),
    'Cronaca/Diario.md': [
      '---', 'id: diario', 'played: [s1]', '---', '',
      'Vedi [la sessione](../Trama/Ombre/Sessione%201.md),',
      '[la fuga](../Trama/Ombre/Sessione%201.md#fuga) e',
      '[un punto](../Trama/Ombre/Sessione%201.md#inesistente).',
      '',
    ].join('\n'),
    'Mondo/porto.md': '---\nid: porto\n---\n\nUn porto.\n',
  });
  const result = migrateSessions(root);
  assert.deepEqual(result.errors, []);

  const arrivo = read(root, 'Trama/Sessione 1/Eventi/Arrivo.md');
  assert.match(arrivo, /\[porto\]\(\.\.\/\.\.\/\.\.\/Mondo\/porto\.md\)/);
  assert.match(arrivo, /\[fuga\]\(Fuga\.md\)/);
  assert.match(arrivo, /\[link esterno\]\(https:\/\/example\.com\/a#b\)/);
  assert.match(arrivo, /\[ancora\]\(#arrivo\)/);

  const diario = read(root, 'Cronaca/Diario.md');
  assert.match(diario, /\[la sessione\]\(\.\.\/Trama\/Sessione%201\/Sessione%201\.md\)/);
  assert.match(diario, /\[la fuga\]\(\.\.\/Trama\/Sessione%201\/Eventi\/Fuga\.md\)/);
  assert.match(diario, /\[un punto\]\(\.\.\/Trama\/Sessione%201\/Sessione%201\.md\)/);
});

test('a link to a file that is not migrated is left as it is', (t) => {
  const root = makeCampaign(t, {
    'Cronaca/Diario.md': '---\nid: diario\nplayed: []\n---\n\n[x](../Trama/Altra.md#q)\n',
    'Trama/Altra.md': '---\nlocation: []\n---\n\n# A\n',
  });
  migrateSessions(root);
  assert.match(read(root, 'Cronaca/Diario.md'), /\[x\]\(\.\.\/Trama\/Altra\.md#q\)/);
});

test('a conflict is reported and the old file is kept', (t) => {
  const root = makeCampaign(t, {
    'Trama/Conflitto.md': '---\nid: c1\ndepends_on: []\nlocation: []\n---\n\n# A\n',
    'Trama/Conflitto/Conflitto.md': '---\nid: c2\ndepends_on: []\nlocation: []\n---\n\nNuova.\n',
  });
  const result = migrateSessions(root);
  assert.deepEqual(result.migrated, []);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'migrate-conflict');
  assert.equal(result.errors[0].file, 'Trama/Conflitto.md');
  assert.equal(exists(root, 'Trama/Conflitto.md'), true);
  assert.match(read(root, 'Trama/Conflitto/Conflitto.md'), /Nuova\./);
});

test('invalid frontmatter and a missing id are skipped and not moved', (t) => {
  const root = makeCampaign(t, {
    'Trama/Rotta.md': '---\nid: rotta\nthis is not yaml\n---\n\n# A\n',
    'Trama/Senza id.md': '---\ndepends_on: []\nlocation: []\n---\n\n# A\n',
    'Trama/Nessun frontmatter.md': '# A\n',
  });
  const result = migrateSessions(root);
  assert.deepEqual(result.migrated, []);
  assert.deepEqual(
    result.errors.map((e) => [e.code, e.file]),
    [
      ['migrate-skipped', 'Trama/Nessun frontmatter.md'],
      ['migrate-skipped', 'Trama/Rotta.md'],
      ['migrate-skipped', 'Trama/Senza id.md'],
    ],
  );
  assert.equal(exists(root, 'Trama/Rotta.md'), true);
  assert.equal(exists(root, 'Trama/Senza id'), false);
});

test('a dry run reports the same result and writes nothing', (t) => {
  const root = makeCampaign(t, {
    'Trama/Ombre/Sessione 1.md': OLD_SESSION,
    'Cronaca/Diario.md': '---\nid: diario\nplayed: []\n---\n\n[s](../Trama/Ombre/Sessione%201.md)\n',
  });
  const before = snapshot(root);
  const result = migrateSessions(root, { dryRun: true });
  assert.deepEqual(result, { migrated: ['Trama/Ombre/Sessione 1.md'], errors: [] });
  assert.deepEqual(snapshot(root), before);
});

test('a second run finds nothing to migrate', (t) => {
  const root = makeCampaign(t, {
    'Trama/Ombre/Sessione 1.md': OLD_SESSION,
    'Trama/Sessione 2.md': '---\nid: due\ndepends_on: []\nlocation: []\n---\n\nTesto.\n',
  });
  assert.equal(migrateSessions(root).migrated.length, 2);
  const after = snapshot(root);
  assert.deepEqual(migrateSessions(root), { migrated: [], errors: [] });
  assert.deepEqual(snapshot(root), after);
});

test('the migrated campaign is valid for plotMap', (t) => {
  const root = makeCampaign(t, {
    'Trama/Ombre/Sessione 1.md': OLD_SESSION.replace('depends_on: [prologo]', 'depends_on: []'),
    'Trama/Ombre/Sessione 2.md': '---\nid: ombre-2\ndepends_on: [ombre-1]\nlocation: []\n---\n\n# Ritorno\n\nTesto.\n',
    'Trama/Sessione 3.md': '---\nid: s3\ndepends_on: [ombre-2]\nlocation: []\n---\n\nSolo testo.\n',
  });
  assert.equal(migrateSessions(root).errors.length, 0);
  const map = plotMap(root);
  assert.deepEqual(map.errors, []);
  assert.deepEqual(
    map.sessions.map((s) => [s.id, s.arc, s.events.length]),
    [
      ['s3', '', 1],
      ['ombre-1', 'Ombre', 3],
      ['ombre-2', 'Ombre', 1],
    ],
  );
});

test('a symlink to an event file (geographic view) is never migrated as a legacy session', (t) => {
  const root = makeCampaign(t, {
    'Trama/Sessione 1/Sessione 1.md': '---\nid: s1\ndepends_on: []\nlocation: []\ngenerated: true\n---\n\nGenerated file. Do not edit by hand.\n',
    'Trama/Sessione 1/Eventi/sessione-1-e01.md': '---\nid: s1-e01\nsession: s1\ndepends_on: []\nlocation: []\n---\n\nIl porto.\n',
  });
  const target = '../../Sessione 1/Eventi/sessione-1-e01.md';
  const linkPath = path.join(root, 'Trama/Per luogo/Raatnagar/sessione-1-e01.md');
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath);

  const dry = migrateSessions(root, { dryRun: true });
  assert.deepEqual(dry.migrated, []);

  const result = migrateSessions(root);
  assert.deepEqual(result.migrated, []);
  assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
  assert.equal(exists(root, 'Trama/sessione-1-e01'), false);
  assert.equal(exists(root, 'Trama/Per luogo/Raatnagar/sessione-1-e01'), false);
});
