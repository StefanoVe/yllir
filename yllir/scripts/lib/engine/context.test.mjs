import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContext, summaryOf } from './context.mjs';
import { buildWorldIndex } from '../world-graph.mjs';

const CAMPAIGN_YAML = `schema: 1

campaign:
  name: "Prova"
  slug: prova
  seed: seme.md

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
  'seme.md': '# Seme\n\nIl seme della campagna.\n',
  'Mondo/borgo.md': page(
    ['id: borgo-cenere', 'kind: place', 'provenance: master'],
    '# Borgo Cenere\n\nUn borgo sul lago.\n\n<!-- master -->\n## Master\n\n### Note\n\nSegreto del borgo.\n<!-- /master -->\n',
  ),
  'Mondo/lago.md': page(
    ['id: lago-grigio', 'kind: place', 'provenance: master', 'status: active', 'aliases: [Il Lago]'],
    '# Lago Grigio\n\nAcqua ferma e scura.\n',
  ),
  'Personaggi/teodo.md': page(
    ['id: teodo-marr', 'kind: character', 'provenance: generated', 'status: alive', 'aliases: [Mastro Teodo]', 'location: [borgo-cenere]', 'relations:', '  - to: borgo-cenere', '    type: member-of'],
    '# Teodo Marr\n\n![ritratto](ritratto.png)\n\nMastro   Teodo\nguida la locanda.\n\nSecondo paragrafo.\n',
  ),
  'Personaggi/lino.md': page(
    ['id: lino-valdes', 'kind: character', 'provenance: master', 'status: alive', 'relations:', '  - to: teodo-marr', '    type: ally-of'],
    `# Lino Valdes\n\n${'parola '.repeat(60).trim()}\n`,
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
  'Trama/Sessione 1/Eventi/Arrivo.md': page(
    ['id: sessione-1-arrivo', 'session: sessione-1', 'provenance: played', 'depends_on: []', 'location: [borgo-cenere]', 'characters: [teodo-marr]', 'items: [lanterna]', 'appearances:', '  - subject: oria-schizzo', '    location: [borgo-cenere]'],
    '# Arrivo al borgo\n\nIl gruppo arriva.\n',
  ),
  'Trama/Sessione 1/Eventi/Sul lago.md': page(
    ['id: sessione-1-lago', 'session: sessione-1', 'provenance: played', 'depends_on: []', 'location: [lago-grigio]', 'characters: [lino-valdes, fantasma]'],
    '# Sul lago\n\nIl lago è fermo.\n',
  ),
  'Trama/Sessione 2/Sessione 2.md': page(['id: sessione-2', 'provenance: played'], '# Sessione 2\n\nSeconda sessione.\n'),
  'Trama/Sessione 2/Eventi/Altro.md': page(
    ['id: sessione-2-altro', 'session: sessione-2', 'provenance: played', 'depends_on: []', 'characters: [lino-valdes]'],
    '# Altro\n\nUn altro evento.\n',
  ),
  'Cronaca/2026-10-02.md': page(['id: cronaca-02', 'provenance: played'], '# Cronaca del 2 ottobre\n\n## Fili aperti\n\n- Vecchio filo.\n'),
  'Cronaca/2026-10-03.md': page(
    ['id: cronaca-03', 'provenance: played', 'played: [sessione-1]'],
    '# Cronaca del 3 ottobre\n\n## Accaduto\n\nIl gruppo arriva al borgo.\n\n## Fili aperti\n\n- Chi ha lasciato la porta aperta?\n- Di chi è la barca?\n\n## Note\n\n- Non è un filo aperto.\n',
  ),
  '.campaign/state/work-note.md': 'Rivedere Teodo.\n',
};

/** Creates a temporary campaign from WORLD, with `extra` files added or replaced. */
function makeCampaign(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), CAMPAIGN_YAML);
  for (const [rel, content] of Object.entries({ ...WORLD, ...extra })) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const idsOf = (list) => list.map((item) => item.id);

test('the fixture world is valid, so the errors in the packs come only from the tests', (t) => {
  assert.deepEqual(buildWorldIndex(makeCampaign(t)).errors, []);
});

test('a requested subject becomes a focus card with its metadata and relations', (t) => {
  const pack = buildContext(makeCampaign(t), { subjects: ['teodo-marr'] });
  assert.deepEqual(pack.focus, [
    {
      id: 'teodo-marr',
      kind: 'character',
      title: 'Teodo Marr',
      file: 'Personaggi/teodo.md',
      provenance: 'generated',
      sketch: false,
      status: 'alive',
      location: ['borgo-cenere'],
      relations: [
        { to: 'borgo-cenere', type: 'member-of' },
        { from: 'lino-valdes', type: 'ally-of' },
      ],
      summary: 'Mastro Teodo guida la locanda.',
    },
  ]);
  assert.deepEqual(pack.unknown, []);
  assert.equal(pack.truncated, false);
  assert.deepEqual(pack.errors, []);
});

test('neighbours are relation partners, places of the focus and timeline participants and places, sorted', (t) => {
  const pack = buildContext(makeCampaign(t), { subjects: ['teodo-marr'] });
  assert.deepEqual(idsOf(pack.neighbours), ['borgo-cenere', 'lago-grigio', 'lino-valdes']);
  assert.equal(pack.neighbours[0].summary, 'Un borgo sul lago.');
});

test('the timeline keeps the events that touch the focus, sorted by when', (t) => {
  const pack = buildContext(makeCampaign(t), { subjects: ['teodo-marr'] });
  assert.deepEqual(pack.timeline, [
    {
      id: 'incontro-molo',
      title: 'Incontro al molo',
      when: 312,
      location: ['lago-grigio'],
      participants: ['teodo-marr', 'lino-valdes'],
    },
  ]);
});

test('a place pulls in the subjects located there and the events that touch them', (t) => {
  const pack = buildContext(makeCampaign(t), { place: 'borgo-cenere' });
  assert.deepEqual(idsOf(pack.focus), ['borgo-cenere', 'mercato', 'oria-schizzo', 'sessione-1-arrivo', 'teodo-marr']);
  assert.deepEqual(idsOf(pack.neighbours), ['lago-grigio', 'lino-valdes']);
  assert.deepEqual(
    pack.timeline.map((entry) => entry.id),
    ['mercato', 'incontro-molo'],
  );
});

test('sketches among focus and neighbours are listed, the other ones are not', (t) => {
  const pack = buildContext(makeCampaign(t), { subjects: ['borgo-cenere'] });
  assert.deepEqual(idsOf(pack.neighbours), ['mercato', 'oria-schizzo', 'sessione-1-arrivo', 'teodo-marr']);
  assert.deepEqual(pack.sketches, [
    { id: 'oria-schizzo', title: 'Oria Schizzo', kind: 'character', file: 'Personaggi/schizzo.md' },
  ]);
  const none = buildContext(makeCampaign(t), { subjects: ['teodo-marr'] });
  assert.deepEqual(none.sketches, []);
});

test('a session collects the ids of its plot documents and lists its event files', (t) => {
  const pack = buildContext(makeCampaign(t), { session: 'sessione-1' });
  assert.deepEqual(pack.session, {
    id: 'sessione-1',
    file: 'Trama/Sessione 1/Sessione 1.md',
    events: ['Trama/Sessione 1/Eventi/Arrivo.md', 'Trama/Sessione 1/Eventi/Sul lago.md'],
  });
  assert.deepEqual(idsOf(pack.focus), [
    'borgo-cenere',
    'lago-grigio',
    'lanterna',
    'lino-valdes',
    'oria-schizzo',
    'teodo-marr',
  ]);
  assert.deepEqual(pack.unknown, ['fantasma']);
  assert.equal(pack.focus.some((card) => card.id === 'sessione-1'), false, 'the session document is not a card');
  assert.equal(pack.neighbours.some((card) => card.id === 'sessione-2-altro'), false, 'another session is not in the tree');
});

test('a session that is not a plot document of the campaign is unknown and gives a null session', (t) => {
  const pack = buildContext(makeCampaign(t), { session: 'mercato' });
  assert.equal(pack.session, null);
  assert.deepEqual(pack.unknown, ['mercato']);
  assert.deepEqual(pack.focus, []);
});

test('a session without a requested id gives a null session', (t) => {
  assert.equal(buildContext(makeCampaign(t), { subjects: ['teodo-marr'] }).session, null);
});

test('the seed is read in full from the path given in campaign.yaml', (t) => {
  const pack = buildContext(makeCampaign(t));
  assert.deepEqual(pack.seed, { file: 'seme.md', text: '# Seme\n\nIl seme della campagna.\n' });
});

test('the seed is null when the key is absent or the file is missing', (t) => {
  const root = makeCampaign(t);
  fs.writeFileSync(path.join(root, 'campaign.yaml'), CAMPAIGN_YAML.replace('  seed: seme.md\n', ''));
  assert.equal(buildContext(root).seed, null);

  fs.writeFileSync(path.join(root, 'campaign.yaml'), CAMPAIGN_YAML.replace('seed: seme.md', 'seed: non-esiste.md'));
  assert.equal(buildContext(root).seed, null);
});

test('the work note is read when present and is null when missing', (t) => {
  const root = makeCampaign(t);
  assert.equal(buildContext(root).workNote, 'Rivedere Teodo.\n');
  fs.rmSync(path.join(root, '.campaign'), { recursive: true, force: true });
  assert.equal(buildContext(root).workNote, null);
});

test('open threads come from the latest chronicle page only, bullet items under Fili aperti', (t) => {
  const pack = buildContext(makeCampaign(t));
  assert.deepEqual(pack.openThreads, [
    {
      file: 'Cronaca/2026-10-03.md',
      items: ['Chi ha lasciato la porta aperta?', 'Di chi è la barca?'],
    },
  ]);
});

test('open threads are empty when the latest chronicle has no such section', (t) => {
  const root = makeCampaign(t, {
    'Cronaca/2026-10-04.md': page(['id: cronaca-04', 'provenance: played'], '# Quarta\n\n## Accaduto\n\nNiente.\n'),
  });
  assert.deepEqual(buildContext(root).openThreads, []);
});

test('the summary is the first public paragraph, without headings, images or the master block', (t) => {
  const pack = buildContext(makeCampaign(t), { subjects: ['teodo-marr', 'borgo-cenere'] });
  const teodo = pack.focus.find((card) => card.id === 'teodo-marr');
  assert.equal(teodo.summary, 'Mastro Teodo guida la locanda.');
  const borgo = pack.focus.find((card) => card.id === 'borgo-cenere');
  assert.equal(borgo.summary, 'Un borgo sul lago.');
  assert.equal(JSON.stringify(pack).includes('Segreto del borgo'), false, 'the master block never reaches the pack');
});

test('a summary longer than 300 characters is cut with an ellipsis', (t) => {
  const pack = buildContext(makeCampaign(t), { subjects: ['lino-valdes'] });
  const summary = pack.focus[0].summary;
  assert.equal([...summary].length, 300);
  assert.equal(summary.endsWith('…'), true);
});

test('summaryOf keeps only the first paragraph and collapses whitespace', () => {
  assert.equal(summaryOf('---\nid: x\n---\n# Titolo\n\n  Uno   due\n  tre.\n\nQuattro.\n'), 'Uno due tre.');
  assert.equal(summaryOf('---\nid: x\n---\n# Titolo\n\n<!-- master -->\n## Master\n<!-- /master -->\n'), '');
  assert.equal(summaryOf('---\nid: x\n---\n![foto](a.png)\n\nTesto dopo la foto.\n'), 'Testo dopo la foto.');
});

test('neighbours are capped at maxNeighbours, sorted by id, and truncated is set', (t) => {
  const root = makeCampaign(t);
  const full = buildContext(root, { subjects: ['teodo-marr'] });
  assert.equal(full.truncated, false);

  const cut = buildContext(root, { subjects: ['teodo-marr'], maxNeighbours: 2 });
  assert.equal(cut.truncated, true);
  assert.deepEqual(idsOf(cut.neighbours), ['borgo-cenere', 'lago-grigio']);

  const exact = buildContext(root, { subjects: ['teodo-marr'], maxNeighbours: 3 });
  assert.equal(exact.truncated, false);
});

test('unknown ids go to unknown, not to the cards', (t) => {
  const pack = buildContext(makeCampaign(t), { subjects: ['nessuno', 'teodo-marr', 'fantasma-2'] });
  assert.deepEqual(pack.unknown, ['fantasma-2', 'nessuno']);
  assert.deepEqual(idsOf(pack.focus), ['teodo-marr']);
});

test('errors are reported only when they name a focus id', (t) => {
  const root = makeCampaign(t, {
    'Personaggi/vago.md': page(['id: vago', 'kind: character', 'provenance: master', 'location: [luogo-perduto]'], '# Vago\n\nUn uomo vago.\n'),
  });
  const withError = buildContext(root, { subjects: ['vago'] });
  assert.equal(withError.errors.length, 1);
  assert.equal(withError.errors[0].code, 'unknown-reference');
  assert.deepEqual(withError.errors[0].ids, ['vago', 'luogo-perduto']);
  assert.deepEqual(buildContext(root, { subjects: ['teodo-marr'] }).errors, []);
});

test('the same campaign and arguments give identical packs, whatever the order of the subjects', (t) => {
  const root = makeCampaign(t);
  const first = buildContext(root, { subjects: ['teodo-marr', 'borgo-cenere'], session: 'sessione-1' });
  const second = buildContext(root, { subjects: ['teodo-marr', 'borgo-cenere'], session: 'sessione-1' });
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  const reordered = buildContext(root, { subjects: ['borgo-cenere', 'teodo-marr'], session: 'sessione-1' });
  assert.deepEqual(first, reordered);
});

test('the pack names the economy document, or null when the campaign has none', (t) => {
  assert.equal(buildContext(makeCampaign(t)).economy, null);
  const root = makeCampaign(t, {
    'Storia/Economia.md': page(['id: economia', 'provenance: master'], '# Economia\n\nValute e prezzi.\n'),
  });
  assert.equal(buildContext(root).economy, 'Storia/Economia.md');
});

test('an empty request gives an empty pack with the campaign-level fields', (t) => {
  const pack = buildContext(makeCampaign(t));
  assert.deepEqual(Object.keys(pack).sort(), [
    'economy',
    'errors',
    'focus',
    'neighbours',
    'openThreads',
    'seed',
    'session',
    'sketches',
    'timeline',
    'truncated',
    'unknown',
    'workNote',
  ]);
  assert.deepEqual(pack.focus, []);
  assert.deepEqual(pack.neighbours, []);
  assert.deepEqual(pack.timeline, []);
  assert.equal(pack.truncated, false);
});
