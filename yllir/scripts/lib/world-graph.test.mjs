import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  KINDS,
  PROVENANCES,
  STATUSES,
  RELATION_TYPES,
  buildWorldIndex,
  checkWorldGraph,
  writeWorldIndex,
} from './world-graph.mjs';

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

/** A Markdown document: frontmatter lines, then a level-1 title. */
function doc(frontmatter, title) {
  return ['---', ...frontmatter, '---', `# ${title}`, '', 'Testo.', ''].join('\n');
}

/** A small valid world. Test cases add or replace single files of it. */
const BASE = {
  'Mondo/borgo-cenere.md': doc(['id: borgo-cenere', 'kind: place', 'provenance: master'], 'Borgo Cenere'),
  'Mondo/lago-grigio.md': doc(['id: lago-grigio', 'kind: place', 'provenance: master', 'status: active'], 'Lago Grigio'),
  'Personaggi/teodo.md': doc(
    ['id: teodo-marr', 'kind: character', 'provenance: generated', 'status: alive', 'location: [borgo-cenere]', 'relations:', '  - to: borgo-cenere', '    type: member-of'],
    'Teodo Marr',
  ),
  'Personaggi/lino.md': doc(
    ['id: lino-valdes', 'kind: character', 'provenance: master', 'status: alive', 'relations:', '  - to: teodo-marr', '    type: ally-of'],
    'Lino Valdes',
  ),
  'Oggetti/lanterna.md': doc(
    ['id: lanterna-di-morvalle', 'kind: item', 'provenance: master', 'status: active', 'location: [lago-grigio]'],
    'Lanterna di Morvalle',
  ),
  'Storia/incontro.md': doc(
    ['id: incontro-molo', 'kind: event', 'provenance: played', 'when: 312', 'location: [lago-grigio]', 'participants: [teodo-marr, lino-valdes]'],
    'Incontro al molo',
  ),
  'Trama/sessione-1.md': doc(['id: sessione-1', 'provenance: played'], 'Sessione 1'),
  'Cronaca/2026-10-03.md': doc(['id: cronaca-2026-10-03', 'provenance: played'], 'Cronaca del 3 ottobre'),
  'Appunti/idee.md': doc(['id: idee', 'kind: bogus', 'when: noon'], 'Idee'),
};

/** Creates a temporary campaign: the base world, with `extra` files added or replaced. */
function makeCampaign(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'world-graph-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), CAMPAIGN_YAML);
  for (const [rel, content] of Object.entries({ ...BASE, ...extra })) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const codesOf = (index) => index.errors.map((err) => err.code);

test('the value lists are the ones of the spec', () => {
  assert.deepEqual(KINDS, ['place', 'character', 'creature', 'item', 'faction', 'event']);
  assert.deepEqual(PROVENANCES, ['master', 'played', 'generated']);
  assert.deepEqual(STATUSES, ['alive', 'dead', 'missing', 'active', 'destroyed', 'unknown']);
  assert.deepEqual(RELATION_TYPES, ['member-of', 'kin-of', 'ally-of', 'rival-of', 'depends-on']);
});

test('a valid small world gives no errors', (t) => {
  const index = buildWorldIndex(makeCampaign(t));
  assert.deepEqual(index.errors, []);
  assert.deepEqual(
    index.subjects.map((subject) => subject.id),
    [
      'borgo-cenere',
      'cronaca-2026-10-03',
      'incontro-molo',
      'lago-grigio',
      'lanterna-di-morvalle',
      'lino-valdes',
      'sessione-1',
      'teodo-marr',
    ],
  );
});

test('a subject entry carries the metadata of its document', (t) => {
  const index = buildWorldIndex(makeCampaign(t));
  const teodo = index.subjects.find((subject) => subject.id === 'teodo-marr');
  assert.deepEqual(teodo, {
    id: 'teodo-marr',
    kind: 'character',
    title: 'Teodo Marr',
    file: 'Personaggi/teodo.md',
    category: 'personaggi',
    categoryType: 'subjects',
    provenance: 'generated',
    sketch: false,
    status: 'alive',
    ended: null,
    when: null,
    location: ['borgo-cenere'],
    participants: [],
    aliases: [],
  });
  const incontro = index.subjects.find((subject) => subject.id === 'incontro-molo');
  assert.equal(incontro.when, 312);
  assert.deepEqual(incontro.participants, ['teodo-marr', 'lino-valdes']);
});

test('each relation becomes a from, to, type entry, sorted', (t) => {
  const index = buildWorldIndex(makeCampaign(t));
  assert.deepEqual(index.relations, [
    { from: 'lino-valdes', to: 'teodo-marr', type: 'ally-of' },
    { from: 'teodo-marr', to: 'borgo-cenere', type: 'member-of' },
  ]);
});

test('a sketch is marked and a title is optional', (t) => {
  const root = makeCampaign(t, {
    'Personaggi/schizzo.md': ['---', 'id: schizzo', 'kind: character', 'provenance: master', 'sketch: true', '---', 'Solo testo.', ''].join('\n'),
  });
  const index = buildWorldIndex(root);
  const sketch = index.subjects.find((subject) => subject.id === 'schizzo');
  assert.equal(sketch.sketch, true);
  assert.equal(sketch.title, null);
  assert.deepEqual(index.errors, []);
});

// Each case adds files to the valid world so that the named code is reported.
const FIELD_CASES = [
  ['missing-id', 'a document without id', {
    'Personaggi/anonimo.md': doc(['kind: character', 'provenance: master'], 'Anonimo'),
  }],
  ['duplicate-id', 'two documents with the same id', {
    'Personaggi/teodo-copia.md': doc(['id: teodo-marr', 'kind: character', 'provenance: master'], 'Copia'),
  }],
  ['missing-kind', 'no kind in a subjects category', {
    'Personaggi/anonimo.md': doc(['id: anonimo', 'provenance: master'], 'Anonimo'),
  }],
  ['bad-kind', 'a kind outside the list', {
    'Personaggi/anonimo.md': doc(['id: anonimo', 'kind: dragon', 'provenance: master'], 'Anonimo'),
  }],
  ['missing-provenance', 'no provenance in a plot category', {
    'Trama/sessione-2.md': doc(['id: sessione-2'], 'Sessione 2'),
  }],
  ['bad-provenance', 'a provenance outside the list', {
    'Trama/sessione-2.md': doc(['id: sessione-2', 'provenance: rumor'], 'Sessione 2'),
  }],
  ['bad-sketch', 'sketch with a value other than true', {
    'Personaggi/anonimo.md': doc(['id: anonimo', 'kind: character', 'provenance: master', 'sketch: yes'], 'Anonimo'),
  }],
  ['bad-status', 'a status outside the list', {
    'Personaggi/anonimo.md': doc(['id: anonimo', 'kind: character', 'provenance: master', 'status: sleeping'], 'Anonimo'),
  }],
  ['bad-ended', 'ended that is not a number', {
    'Personaggi/anonimo.md': doc(['id: anonimo', 'kind: character', 'provenance: master', 'status: dead', 'ended: soon'], 'Anonimo'),
  }],
  ['ended-without-end-status', 'ended with an alive subject', {
    'Personaggi/anonimo.md': doc(['id: anonimo', 'kind: character', 'provenance: master', 'status: alive', 'ended: 10'], 'Anonimo'),
  }],
  ['missing-when', 'an event without when', {
    'Storia/senza-tempo.md': doc(['id: senza-tempo', 'kind: event', 'provenance: played'], 'Senza tempo'),
  }],
  ['bad-when', 'when that is not a number', {
    'Storia/a-mezzogiorno.md': doc(['id: a-mezzogiorno', 'kind: event', 'provenance: played', 'when: noon'], 'A mezzogiorno'),
  }],
  ['when-not-event', 'when on a character', {
    'Personaggi/anonimo.md': doc(['id: anonimo', 'kind: character', 'provenance: master', 'when: 3'], 'Anonimo'),
  }],
  ['participants-not-event', 'participants on a character', {
    'Personaggi/anonimo.md': doc(['id: anonimo', 'kind: character', 'provenance: master', 'participants: [teodo-marr]'], 'Anonimo'),
  }],
  ['bad-relation', 'a relation without to', {
    'Personaggi/anonimo.md': doc(['id: anonimo', 'kind: character', 'provenance: master', 'relations:', '  - type: ally-of'], 'Anonimo'),
  }],
  ['bad-relation-type', 'a relation type outside the list', {
    'Personaggi/anonimo.md': doc(
      ['id: anonimo', 'kind: character', 'provenance: master', 'relations:', '  - to: teodo-marr', '    type: friend-of'],
      'Anonimo',
    ),
  }],
  ['self-relation', 'a relation to the subject itself', {
    'Personaggi/anonimo.md': doc(
      ['id: anonimo', 'kind: character', 'provenance: master', 'relations:', '  - to: anonimo', '    type: ally-of'],
      'Anonimo',
    ),
  }],
  ['place-outside-places', 'kind place in a subjects category', {
    'Personaggi/falso.md': doc(['id: falso', 'kind: place', 'provenance: master'], 'Falso'),
  }],
  ['place-outside-places', 'kind character in a places category', {
    'Mondo/falso.md': doc(['id: falso', 'kind: character', 'provenance: master'], 'Falso'),
  }],
  ['frontmatter', 'a frontmatter line that is not key: value', {
    'Personaggi/anonimo.md': doc(['id: anonimo', 'kind character', 'provenance: master'], 'Anonimo'),
  }],
  ['unknown-reference', 'a location that is not a subject', {
    'Personaggi/anonimo.md': doc(['id: anonimo', 'kind: character', 'provenance: master', 'location: [citta-fantasma]'], 'Anonimo'),
  }],
  ['unknown-reference', 'a relation to a subject that does not exist', {
    'Personaggi/anonimo.md': doc(
      ['id: anonimo', 'kind: character', 'provenance: master', 'relations:', '  - to: nessuno', '    type: ally-of'],
      'Anonimo',
    ),
  }],
  ['location-not-place', 'a location that is a character', {
    'Personaggi/anonimo.md': doc(['id: anonimo', 'kind: character', 'provenance: master', 'location: [lino-valdes]'], 'Anonimo'),
  }],
  ['acts-after-end', 'an event after a participant ended, or in a destroyed place', {
    'Personaggi/morto.md': doc(['id: morto-ieri', 'kind: character', 'provenance: master', 'status: dead', 'ended: 300'], 'Morto'),
    'Storia/evento-tardi.md': doc(['id: evento-tardi', 'kind: event', 'provenance: played', 'when: 400', 'participants: [morto-ieri]'], 'Tardi'),
    'Mondo/rovina.md': doc(['id: rovina', 'kind: place', 'provenance: master', 'status: destroyed', 'ended: 100'], 'Rovina'),
    'Storia/evento-rovina.md': doc(['id: evento-rovina', 'kind: event', 'provenance: played', 'when: 200', 'location: [rovina]'], 'Rovina'),
  }],
  ['two-places-at-once', 'two events at the same time in different places with a shared participant', {
    'Storia/a-molo.md': doc(['id: a-molo', 'kind: event', 'provenance: played', 'when: 312', 'location: [borgo-cenere]', 'participants: [teodo-marr]'], 'A molo'),
  }],
];

for (const [code, description, extra] of FIELD_CASES) {
  test(`reports ${code}: ${description}`, (t) => {
    const index = buildWorldIndex(makeCampaign(t, extra));
    assert.ok(codesOf(index).includes(code), `expected ${code}, got ${JSON.stringify(index.errors)}`);
  });
}

test('the two-places-at-once error is reported once, on the event with the smaller id', (t) => {
  const index = buildWorldIndex(makeCampaign(t, {
    'Storia/a-molo.md': doc(['id: a-molo', 'kind: event', 'provenance: played', 'when: 312', 'location: [borgo-cenere]', 'participants: [teodo-marr]'], 'A molo'),
  }));
  const errors = index.errors.filter((err) => err.code === 'two-places-at-once');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].file, 'Storia/a-molo.md');
  assert.deepEqual(errors[0].ids, ['a-molo', 'incontro-molo', 'teodo-marr']);
});

test('a relation does not need its reverse', (t) => {
  const index = buildWorldIndex(makeCampaign(t));
  assert.deepEqual(checkWorldGraph(index), []);
  assert.equal(index.relations.some((r) => r.from === 'teodo-marr' && r.to === 'lino-valdes'), false);
});

test('overlay content replaces a file on disk', (t) => {
  const root = makeCampaign(t);
  const replaced = doc(['id: teodo-marr', 'kind: character', 'provenance: generated', 'status: alive'], 'Teodo Nuovo');
  const index = buildWorldIndex(root, {
    overlayFiles: [{ path: 'Personaggi/teodo.md', content: replaced }],
  });
  assert.equal(index.subjects.find((s) => s.id === 'teodo-marr').title, 'Teodo Nuovo');
  assert.equal(index.subjects.find((s) => s.id === 'teodo-marr').location.length, 0);
  assert.equal(buildWorldIndex(root).subjects.find((s) => s.id === 'teodo-marr').title, 'Teodo Marr');
});

test('overlay content adds a file that is not on disk', (t) => {
  const root = makeCampaign(t);
  const content = doc(['id: nuovo-arrivo', 'kind: character', 'provenance: master'], 'Nuovo arrivo');
  const index = buildWorldIndex(root, {
    overlayFiles: [{ path: 'Personaggi/nuovo-arrivo.md', content }],
  });
  const added = index.subjects.find((s) => s.id === 'nuovo-arrivo');
  assert.equal(added.file, 'Personaggi/nuovo-arrivo.md');
  assert.equal(fs.existsSync(path.join(root, 'Personaggi', 'nuovo-arrivo.md')), false);
});

test('overlay null deletes a file, and the references to it are reported', (t) => {
  const root = makeCampaign(t);
  const index = buildWorldIndex(root, {
    overlayFiles: [{ path: 'Personaggi/lino.md', content: null }],
  });
  assert.equal(index.subjects.some((s) => s.id === 'lino-valdes'), false);
  assert.equal(index.relations.some((r) => r.from === 'lino-valdes'), false);
  const unknown = index.errors.find((err) => err.code === 'unknown-reference' && err.file === 'Storia/incontro.md');
  assert.ok(unknown, 'the event that lists lino-valdes must report it');
  assert.deepEqual(unknown.ids, ['incontro-molo', 'lino-valdes']);
  assert.ok(fs.existsSync(path.join(root, 'Personaggi', 'lino.md')));
});

test('files in the notes folder are ignored, on disk and in the overlay', (t) => {
  const root = makeCampaign(t);
  const index = buildWorldIndex(root, {
    overlayFiles: [{ path: 'Appunti/bozza.md', content: doc(['id: bozza', 'kind: bogus'], 'Bozza') }],
  });
  assert.deepEqual(index.errors, []);
  assert.equal(index.subjects.some((s) => s.id === 'idee' || s.id === 'bozza'), false);
  assert.equal(index.subjects.some((s) => s.file.startsWith('Appunti/')), false);
});

test('writeWorldIndex writes byte-identical output on repeated runs', (t) => {
  const root = makeCampaign(t);
  const overlayA = { path: 'Personaggi/nuovo.md', content: doc(['id: nuovo', 'kind: character', 'provenance: master'], 'Nuovo') };
  const overlayB = { path: 'Storia/altro.md', content: doc(['id: altro', 'kind: event', 'provenance: played', 'when: 1'], 'Altro') };

  const target = path.join(root, '.campaign', 'cache', 'world.json');
  const written = writeWorldIndex(root, buildWorldIndex(root, { overlayFiles: [overlayA, overlayB] }));
  assert.equal(written, target);
  const first = fs.readFileSync(target);

  writeWorldIndex(root, buildWorldIndex(root, { overlayFiles: [overlayB, overlayA] }));
  const second = fs.readFileSync(target);

  assert.ok(first.equals(second), 'the two runs must write the same bytes');
  assert.equal(first.toString('utf8').endsWith('}\n'), true);
  assert.equal(first.toString('utf8').includes('\n  "subjects": ['), true, 'two-space indent');
});

test('an internal symlink alias of a document gives one subject and no duplicate-id', (t) => {
  const root = makeCampaign(t);
  fs.symlinkSync('teodo.md', path.join(root, 'Personaggi', 'Alias.md'));
  const index = buildWorldIndex(root);
  assert.equal(index.subjects.filter((s) => s.id === 'teodo-marr').length, 1);
  assert.equal(index.errors.some((err) => err.code === 'duplicate-id'), false);
  assert.deepEqual(index.errors, []);
});

test('the timeline is sorted by when, then by id', (t) => {
  const root = makeCampaign(t, {
    'Storia/ev-c.md': doc(['id: ev-c', 'kind: event', 'provenance: played', 'when: 10'], 'C'),
    'Storia/ev-a.md': doc(['id: ev-a', 'kind: event', 'provenance: played', 'when: 10'], 'A'),
    'Storia/ev-b.md': doc(['id: ev-b', 'kind: event', 'provenance: played', 'when: -2.5'], 'B'),
    'Storia/ev-d.md': doc(['id: ev-d', 'kind: event', 'provenance: played', 'when: 3.5'], 'D'),
  });
  const index = buildWorldIndex(root);
  assert.deepEqual(index.errors, []);
  assert.deepEqual(
    index.timeline.map((entry) => entry.id),
    ['ev-b', 'ev-d', 'ev-a', 'ev-c', 'incontro-molo'],
  );
  assert.deepEqual(index.timeline.at(-1), {
    id: 'incontro-molo',
    when: 312,
    location: ['lago-grigio'],
    participants: ['teodo-marr', 'lino-valdes'],
  });
});

test('a free document needs no kind; a free event still needs its when', (t) => {
  const root = makeCampaign(t, {
    'Storia/concetto.md': doc(['id: concetto', 'provenance: master'], 'Un concetto della storia'),
  });
  const index = buildWorldIndex(root);
  assert.deepEqual(index.errors, []);
  assert.equal(index.subjects.find((subject) => subject.id === 'concetto').kind, null);
  assert.equal(index.subjects.find((subject) => subject.id === 'incontro-molo').kind, 'event');
});

test('a free document with kind event but no when is still an error', (t) => {
  const root = makeCampaign(t, {
    'Storia/caduta.md': doc(['id: caduta', 'kind: event', 'provenance: master'], 'La caduta'),
  });
  assert.ok(codesOf(buildWorldIndex(root)).includes('missing-when'));
});
