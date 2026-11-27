// Tests of the plan draft (convert-draft-plan.mjs, spec issue #138 section 8.2). Each test builds a
// small input folder and a campaign folder in the OS temp directory. The testbench fixture is used
// when present.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { draftPlan, validateRules } from './convert-draft-plan.mjs';
import { buildReport } from './convert-structure.mjs';
import { applyPlan, validatePlan } from './convert-apply.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'convert-draft-plan.mjs');
const FIXTURE = path.resolve(here, '../../../../../testbench/fixtures/convert-linked-input');
const MASTER_HEADING = 'Indicazioni per il master';

const CAMPAIGN_YAML = `name: Test
language:
  main: it
structure:
  - id: luoghi
    type: places
    folder: Luoghi
  - id: personaggi
    type: subjects
    folder: Personaggi
`;

function makeCampaign() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-draft-root-'));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), CAMPAIGN_YAML);
  return root;
}

/** An input folder with the given files (text, or Buffer for binary). */
function makeInput(files) {
  const input = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-draft-in-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(input, rel)), { recursive: true });
    fs.writeFileSync(path.join(input, rel), content);
  }
  return input;
}

/** Builds the report of the input and drafts the plan. */
function draft(files, { folders = [], plotFolder, masterConventions = {}, headingAliases, overrides = {} }) {
  const input = makeInput(files);
  const root = makeCampaign();
  const report = buildReport(input);
  const rules = {
    input,
    masterHeading: MASTER_HEADING,
    masterConventions,
    folders,
    ...(plotFolder !== undefined ? { plotFolder } : {}),
    ...(headingAliases !== undefined ? { headingAliases } : {}),
  };
  const result = draftPlan({ campaignRoot: root, report, rules, overrides });
  return { input, root, report, rules, result };
}

function docOf(plan, target) {
  const doc = plan.documents.find((d) => d.target === target);
  assert.ok(doc, `no document ${target}: ${plan.documents.map((d) => d.target).join(', ')}`);
  return doc;
}

function exceptionsOf(summary, reason) {
  return summary.exceptions.filter((e) => e.reason === reason).map((e) => e.file);
}

const FENVALE = '# Fenvale\n\nTesto pubblico.\n\n> [!secret] Il pozzo\n> segreto\n\nFine.\n';

test('move place: one document, title from the H1, one part from bodyStart, exact meta', () => {
  const { result } = draft(
    { 'Mondo/Fenvale.md': '---\naliases: [Porto Grigio]\n---\n# Fenvale\n\nUn porto.\n' },
    { folders: [{ path: 'Mondo', route: 'move', kind: 'place', target: 'Luoghi' }] },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const { plan, summary } = result;
  assert.equal(plan.documents.length, 1);
  const doc = plan.documents[0];
  assert.equal(doc.target, 'Luoghi/Fenvale.md');
  assert.equal(doc.title, 'Fenvale');
  assert.deepEqual(doc.meta, {
    id: 'fenvale', kind: 'place', provenance: 'master', location: [], aliases: ['Porto Grigio'],
  });
  assert.deepEqual(doc.parts, [{ file: 'Mondo/Fenvale.md', from: 4, to: 6, heading: null, shift: 0 }]);
  assert.deepEqual(plan.routes, { source: [], skip: [], full: [], atlas: [] });
  assert.equal(summary.counts.move, 1);
});

test('move npc: mapped parts get their heading, the extra section keeps its own, missing ones make a sketch', () => {
  const { result } = draft(
    {
      'NPCs/Marta.md': [
        '# Marta', '', 'Introduzione.', '', '## Ruolo', 'Locandiera.', '', '## Aspetto e modi', 'Alta.', '',
        '## Origine', 'Nata a Fenvale.', '',
      ].join('\n'),
    },
    { folders: [{ path: 'NPCs', route: 'move', kind: 'character', template: 'npc', target: 'Personaggi' }] },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const doc = docOf(result.plan, 'Personaggi/Marta.md');
  assert.equal(doc.meta.sketch, true);
  assert.deepEqual(doc.parts.map((p) => [p.from, p.to, p.heading]), [
    [2, 4, '## Ruolo'],
    [6, 7, null],
    [9, 10, '## Aspetto e modi'],
    [11, 12, null],
  ]);
  // The unmapped section keeps its heading line and is shifted one level down.
  assert.equal(doc.parts[3].shift, 1);
  assert.deepEqual(exceptionsOf(result.summary, 'missing-first-section'), []);
});

test('move enemy: a heading alias maps to the required section, pre-section text takes the heading when unmapped', () => {
  const { result } = draft(
    {
      'Enemies/Lupo.md': '# Lupo\n\nUna bestia.\n\n## Identità\n\nGrigio.\n',
      'Enemies/Orso.md': '# Orso\n\nUn orso grande.\n',
    },
    {
      folders: [{ path: 'Enemies', route: 'move', kind: 'creature', template: 'enemy', target: 'Personaggi' }],
      headingAliases: { enemy: { 'Identità': 'Natura' } },
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const lupo = docOf(result.plan, 'Personaggi/Lupo.md');
  assert.deepEqual(lupo.parts.map((p) => [p.from, p.to, p.heading]), [[2, 4, '## Natura'], [6, 7, null]]);
  assert.equal(lupo.meta.sketch, true);
  const orso = docOf(result.plan, 'Personaggi/Orso.md');
  assert.deepEqual(orso.parts.map((p) => [p.from, p.to, p.heading]), [[2, 3, '## Natura']]);
});

test('homonyms: same title in two folders get the parent folder name and their own ids', () => {
  const { result } = draft(
    { 'NPCs/A/Selva.md': 'Selva di alberi.\n', 'NPCs/B/Selva.md': 'Selva di rovi.\n' },
    { folders: [{ path: 'NPCs', route: 'move', kind: 'place', target: 'Luoghi' }] },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const targets = result.plan.documents.map((d) => d.target);
  assert.deepEqual(targets, ['Luoghi/Selva (A).md', 'Luoghi/Selva (B).md']);
  assert.deepEqual(result.plan.documents.map((d) => d.meta.id), ['selva-a', 'selva-b']);
  assert.deepEqual(exceptionsOf(result.summary, 'homonym'), ['NPCs/A/Selva.md', 'NPCs/B/Selva.md']);
  assert.deepEqual(result.plan.documents.map((d) => d.title), ['Selva (A)', 'Selva (B)']);
});

test('plot: stub with depends_on, scenes chained, first scene keeps the preamble; no headings gives no-scenes', () => {
  const session = [
    '**Dipende da:** [S0](S0.md)', '', 'Preambolo.', '# Apertura', 'Testo uno.',
    '# Combattimento', 'Testo due.', '# Epilogo', 'Testo tre.', '',
  ].join('\n');
  const { result } = draft(
    { 'Trama/S0.md': '# S0\n\nIntro.\n', 'Trama/Sessione 2.md': session, 'Trama/Vuota.md': 'Solo testo.\n' },
    { folders: [{ path: 'Trama', route: 'plot' }], plotFolder: 'Trama' },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const { plan } = result;
  const stub = docOf(plan, 'Trama/Sessione 2/Sessione 2.md');
  assert.equal(stub.title, null);
  assert.deepEqual(stub.parts, []);
  assert.deepEqual(stub.meta, { id: 'sessione-2', depends_on: ['s0'], provenance: 'master' });

  const scenes = plan.documents.filter((d) => d.target.startsWith('Trama/Sessione 2/Eventi/'));
  assert.equal(scenes.length, 3);
  assert.deepEqual(scenes.map((d) => d.meta.depends_on), [[], [scenes[0].meta.id], [scenes[1].meta.id]]);
  assert.deepEqual(scenes.map((d) => d.meta.session), ['sessione-2', 'sessione-2', 'sessione-2']);
  assert.deepEqual(scenes[0].parts.map((p) => [p.from, p.to, p.heading]), [[1, 3, null], [5, 5, null]]);
  assert.deepEqual(scenes[1].parts.map((p) => [p.from, p.to]), [[7, 7]]);

  const vuota = docOf(plan, 'Trama/Vuota/Eventi/Vuota.md');
  assert.equal(vuota.meta.session, 'vuota');
  assert.deepEqual(exceptionsOf(result.summary, 'no-scenes'), ['Trama/S0.md', 'Trama/Vuota.md']);
});

test('images: one entry per image, in the folder of the first document that embeds it', () => {
  const { result } = draft(
    {
      'img/mappa porto.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      'Mondo/Lago.md': '# Lago\n\n![[mappa porto.png]]\n',
      'Mondo/Porto.md': '# Porto\n\n![[mappa porto.png]]\n',
    },
    { folders: [{ path: 'Mondo', route: 'move', kind: 'place', target: 'Luoghi' }] },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.plan.images, [{ file: 'img/mappa porto.png', target: 'Luoghi/img/mappa-porto.png' }]);
});

test('overrides: documents replace, meta merges, masterRanges split, setAside removes the documents', () => {
  const { result } = draft(
    {
      'Mondo/Fenvale.md': FENVALE,
      'Gente/Personaggi minori.md': '# Minori\n\nTesto.\n',
      'Mondo/Vecchio.md': '# Vecchio\n\nTesto.\n',
    },
    {
      folders: [
        { path: 'Mondo', route: 'move', kind: 'place', target: 'Luoghi' },
        { path: 'Gente', route: 'move', kind: 'character', template: 'npc', target: 'Personaggi' },
      ],
      masterConventions: { 'callout:secret': 'public' },
      overrides: {
        files: {
          'Mondo/Fenvale.md': { meta: { status: 'attivo' } },
          'Gente/Personaggi minori.md': {
            documents: [{
              target: 'Personaggi/Minori.md',
              title: 'Minori',
              meta: { id: 'minori', kind: 'character', provenance: 'master' },
              parts: [{ file: 'Gente/Personaggi minori.md', from: 1, to: 2, heading: null, shift: 0 }],
            }],
          },
        },
        masterRanges: [{ file: 'Mondo/Fenvale.md', from: 5, to: 6 }],
        setAside: ['Mondo/Vecchio.md'],
      },
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const { plan } = result;
  const targets = plan.documents.map((d) => d.target);
  assert.ok(targets.includes('Personaggi/Minori.md'));
  assert.equal(targets.filter((t) => t.includes('Minori') && t !== 'Personaggi/Minori.md').length, 0);
  assert.ok(!targets.includes('Luoghi/Vecchio.md'));
  assert.deepEqual(plan.routes.source, ['Mondo/Vecchio.md']);

  const fenvale = docOf(plan, 'Luoghi/Fenvale.md');
  assert.equal(fenvale.meta.status, 'attivo');
  assert.equal(fenvale.meta.kind, 'place');
  assert.deepEqual(fenvale.parts.map((p) => [p.from, p.to, p.master === true]), [
    [1, 4, false],
    [5, 6, true],
    [7, 8, false],
  ]);
});

test('the plan of the cases above passes validatePlan and applies', () => {
  const files = {
    'img/mappa porto.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    'Mondo/Fenvale.md': FENVALE,
    'Mondo/Lago.md': '# Lago\n\n![[mappa porto.png]]\n',
    'Mondo/Vecchio.md': '# Vecchio\n\nTesto.\n',
    'NPCs/Marta.md': '# Marta\n\nIntro.\n\n## Ruolo\nLocandiera.\n\n## Origine\nNata qui.\n',
    'NPCs/A/Selva.md': 'Selva di alberi.\n',
    'NPCs/B/Selva.md': 'Selva di rovi.\n',
    'Enemies/Lupo.md': '# Lupo\n\nUna bestia.\n\n## Identità\n\nGrigio.\n',
    'Gente/Personaggi minori.md': '# Minori\n\nTesto.\n',
    'Trama/S0.md': '# S0\n\nIntro.\n',
    'Trama/Sessione 2.md': '**Dipende da:** [S0](S0.md)\n\nPreambolo.\n# Apertura\nUno.\n# Fine\nDue.\n',
  };
  const { root, result } = draft(files, {
    folders: [
      { path: 'NPCs', route: 'move', kind: 'character', template: 'npc', target: 'Personaggi' },
      { path: 'Enemies', route: 'move', kind: 'creature', template: 'enemy', target: 'Personaggi' },
      { path: 'Mondo', route: 'move', kind: 'place', target: 'Luoghi' },
      { path: 'Gente', route: 'move', kind: 'character', template: 'npc', target: 'Personaggi' },
      { path: 'Trama', route: 'plot' },
    ],
    plotFolder: 'Trama',
    masterConventions: { 'callout:secret': 'public' },
    headingAliases: { enemy: { 'Identità': 'Natura' } },
    overrides: {
      files: {
        'Gente/Personaggi minori.md': {
          documents: [{
            target: 'Personaggi/Minori.md',
            title: 'Minori',
            meta: { id: 'minori', kind: 'character', provenance: 'master' },
            parts: [{ file: 'Gente/Personaggi minori.md', from: 1, to: 2, heading: null, shift: 0 }],
          }],
        },
      },
      masterRanges: [{ file: 'Mondo/Fenvale.md', from: 5, to: 6 }],
      setAside: ['Mondo/Vecchio.md'],
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(validatePlan(root, result.plan), []);
  const applied = applyPlan(root, result.plan);
  assert.equal(applied.ok, true, JSON.stringify(applied.errors));
  assert.deepEqual(applied.errors, []);
  assert.ok(fs.existsSync(path.join(root, '.campaign', 'drafts', 'Luoghi', 'Fenvale.md')));
  assert.ok(fs.existsSync(path.join(root, 'Luoghi', 'img', 'mappa-porto.png')));
});

test('the same input gives byte-identical plan and summary', () => {
  const input = makeInput({
    'NPCs/A/Selva.md': 'Selva di alberi.\n',
    'NPCs/B/Selva.md': 'Selva di rovi.\n',
    'Trama/S0.md': '# S0\n\nIntro.\n',
  });
  const root = makeCampaign();
  const report = buildReport(input);
  const rules = {
    input,
    masterHeading: MASTER_HEADING,
    masterConventions: {},
    plotFolder: 'Trama',
    folders: [
      { path: 'NPCs', route: 'move', kind: 'place', target: 'Luoghi' },
      { path: 'Trama', route: 'plot' },
    ],
  };
  const first = draftPlan({ campaignRoot: root, report, rules });
  const second = draftPlan({ campaignRoot: root, report, rules });
  assert.equal(JSON.stringify(first.plan), JSON.stringify(second.plan));
  assert.equal(JSON.stringify(first.summary), JSON.stringify(second.summary));
});

test('validateRules rejects bad rules and overrides, and draftPlan rejects overrides of unknown files', () => {
  assert.equal(validateRules(null)[0].code, 'bad-rules');
  const base = { input: '/tmp/x', masterHeading: 'M', masterConventions: {}, folders: [] };
  const unknownRoute = validateRules({ ...base, folders: [{ path: 'A', route: 'bogus' }] });
  assert.equal(unknownRoute.length, 1);
  assert.match(unknownRoute[0].message, /unknown route/);
  assert.equal(validateRules({ ...base, folders: [{ path: 'A', route: 'move', target: 'Luoghi' }] }).length, 1);
  assert.equal(validateRules({ ...base, folders: [{ path: 'A', route: 'move', kind: 'place' }] }).length, 1);
  assert.equal(validateRules(base, { masterRanges: [{ file: 'A.md', from: 5, to: 2 }] })[0].code, 'bad-overrides');

  const notInReport = draft(
    { 'Mondo/A.md': '# A\n' },
    { folders: [{ path: 'Mondo', route: 'move', kind: 'place', target: 'Luoghi' }],
      overrides: { files: { 'Altro.md': { route: 'skip' } } } },
  );
  assert.equal(notInReport.result.ok, false);
  assert.equal(notInReport.result.errors[0].code, 'bad-overrides');
  const rangeNotInReport = draft(
    { 'Mondo/A.md': '# A\n' },
    { folders: [{ path: 'Mondo', route: 'move', kind: 'place', target: 'Luoghi' }],
      overrides: { masterRanges: [{ file: 'Altro.md', from: 1, to: 2 }] } },
  );
  assert.equal(rangeNotInReport.result.ok, false);
});

test('CLI: writes the plan and summary, prints one line, exits 0; bad rules exit 1 and write nothing', () => {
  const input = makeInput({ 'Mondo/Fenvale.md': '# Fenvale\n\nUn porto.\n', 'Trama/S0.md': '# S0\n\nIntro.\n' });
  const root = makeCampaign();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-draft-cli-'));
  const report = path.join(work, 'structure.json');
  fs.writeFileSync(report, `${JSON.stringify(buildReport(input), null, 2)}\n`);
  const rulesFile = path.join(work, 'rules.json');
  const rules = {
    input,
    masterHeading: MASTER_HEADING,
    masterConventions: {},
    plotFolder: 'Trama',
    folders: [
      { path: 'Mondo', route: 'move', kind: 'place', target: 'Luoghi' },
      { path: 'Trama', route: 'plot' },
    ],
  };
  fs.writeFileSync(rulesFile, `${JSON.stringify(rules, null, 2)}\n`);
  const out = path.join(work, 'plan.json');
  const summary = path.join(work, 'summary.json');
  const ok = spawnSync(process.execPath, [cli, root, '--report', report, '--rules', rulesFile, '--out', out, '--summary', summary], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const lines = ok.stdout.trimEnd().split('\n');
  assert.equal(lines.at(-1), 'exit: 0');
  assert.match(lines.at(-2), /^documents: 3, move: 1, plot: 1, scenes: 1, source: 0, skip: 0, full: 0, exceptions: 1$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')).documents.length, 3);
  assert.ok(JSON.parse(fs.readFileSync(summary, 'utf8')).counts);

  const badRules = path.join(work, 'bad.json');
  fs.writeFileSync(badRules, JSON.stringify({ ...rules, folders: [{ path: 'Mondo', route: 'bogus' }] }));
  const badOut = path.join(work, 'bad-plan.json');
  const bad = spawnSync(process.execPath, [cli, root, '--report', report, '--rules', badRules, '--out', badOut, '--summary', summary], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /"ok": false/);
  assert.equal(fs.existsSync(badOut), false);

  const usage = spawnSync(process.execPath, [cli, root, '--report', report], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});

test('testbench linked fixture: drafts ok, the session has three scenes, and the plan passes validatePlan', (t) => {
  if (!fs.existsSync(FIXTURE)) {
    t.skip('testbench fixture not present');
    return;
  }
  const report = buildReport(FIXTURE);
  const masterConventions = {};
  for (const conv of report.conventions) masterConventions[conv.id] = conv.id === 'html-comment' ? 'public' : 'master';
  const root = makeCampaign();
  const rules = {
    input: FIXTURE,
    masterHeading: MASTER_HEADING,
    masterConventions,
    plotFolder: 'Trama',
    folders: [
      { path: 'Mondo', route: 'move', kind: 'place', target: 'Luoghi' },
      { path: 'Gente', route: 'move', kind: 'character', template: 'npc', target: 'Personaggi' },
      { path: 'Cose', route: 'move', kind: 'item', template: 'item', item_type: 'other', target: 'Oggetti' },
      { path: 'Trama', route: 'plot' },
      { path: 'Riferimenti', route: 'source' },
      { path: 'Da fare', route: 'skip' },
      { path: '', route: 'skip' },
    ],
  };
  const result = draftPlan({ campaignRoot: root, report, rules, overrides: {} });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const scenes = result.plan.documents.filter((d) => d.target.startsWith('Trama/Sessione 1/Eventi/'));
  assert.equal(scenes.length, 3);
  assert.deepEqual(validatePlan(root, result.plan), []);
});

test('item: mapped sections in template order, an unmapped section attaches after its predecessor with shift 1', () => {
  const spada = [
    '# Spada di Brina', '', '## In breve', 'Una spada.', '', '## Effetti', 'Taglia bene.', '',
    '## Descrizione', 'Lunga e lucida.', '', '## Note', 'Nota.', '',
  ].join('\n');
  const { result } = draft(
    { 'Cose/Spada.md': spada, 'Cose/Scudo.md': '# Scudo\n\n## Descrizione\nRotondo.\n' },
    { folders: [{ path: 'Cose', route: 'move', kind: 'item', template: 'item', item_type: 'other', target: 'Oggetti' }] },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const doc = docOf(result.plan, 'Oggetti/Spada di Brina.md');
  assert.deepEqual(doc.parts.map((p) => [p.from, p.to, p.heading, p.shift]), [
    [4, 5, '## In breve', 0],
    [10, 11, '## Descrizione', 0],
    [12, 13, null, 1],
    [7, 8, '## Effetti', 0],
  ]);
  assert.equal(doc.meta.sketch, undefined);
  assert.deepEqual(exceptionsOf(result.summary, 'missing-first-section'), ['Cose/Scudo.md']);
  assert.deepEqual(exceptionsOf(result.summary, 'missing-section'), ['Cose/Scudo.md']);
  const scudo = docOf(result.plan, 'Oggetti/Scudo.md');
  assert.equal(scudo.meta.sketch, undefined);
});

test('plot: a single level-1 heading first in the body is the title and the cut is at level 2', () => {
  const { result } = draft(
    { 'Trama/Titolo.md': '# La torre\n\n## Primo\nA.\n## Secondo\nB.\n' },
    { folders: [{ path: 'Trama', route: 'plot' }], plotFolder: 'Trama' },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const scenes = result.plan.documents.filter((d) => d.target.startsWith('Trama/Titolo/Eventi/'));
  assert.deepEqual(scenes.map((d) => d.target), ['Trama/Titolo/Eventi/Primo.md', 'Trama/Titolo/Eventi/Secondo.md']);
  assert.deepEqual(scenes[0].parts.map((p) => [p.from, p.to]), [[4, 4]]);
  assert.deepEqual(scenes[1].parts.map((p) => [p.from, p.to]), [[6, 6]]);
  assert.deepEqual(exceptionsOf(result.summary, 'no-scenes'), []);
});

const MARTA_STATS = [
  '# Marta', '', 'Introduzione.', '', '## Ruolo', 'Locandiera.', '', '## Statistiche', 'HP 10.', 'AC 12.', '',
  '## Origine', 'Nata qui.', '',
].join('\n');

test('replace: lines of the statistics section become a text part in place, the rest of the part is kept', () => {
  const { result } = draft(
    { 'NPCs/Marta.md': MARTA_STATS },
    {
      folders: [{ path: 'NPCs', route: 'move', kind: 'character', template: 'npc', target: 'Personaggi' }],
      overrides: { files: { 'NPCs/Marta.md': { replace: [{ from: 9, to: 10, text: '| HP | 10 |\n| AC | 12 |' }] } } },
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const doc = docOf(result.plan, 'Personaggi/Marta.md');
  const texts = doc.parts.filter((p) => p.text !== undefined);
  assert.deepEqual(texts, [{ text: '| HP | 10 |\n| AC | 12 |', heading: '## Statistiche' }]);
  const index = doc.parts.indexOf(texts[0]);
  assert.deepEqual([doc.parts[index - 1].from, doc.parts[index - 1].to, doc.parts[index - 1].heading], [6, 7, null]);
  assert.deepEqual(doc.parts[index + 1], { file: 'NPCs/Marta.md', from: 11, to: 11, heading: null, shift: 0 });
});

test('replace outside the statistics section, overlapping or in a non-sheet is bad-overrides', () => {
  const rule = [{ path: 'NPCs', route: 'move', kind: 'character', template: 'npc', target: 'Personaggi' }];
  const outside = draft(
    { 'NPCs/Marta.md': MARTA_STATS },
    { folders: rule, overrides: { files: { 'NPCs/Marta.md': { replace: [{ from: 3, to: 3, text: 'x' }] } } } },
  );
  assert.equal(outside.result.ok, false);
  assert.equal(outside.result.errors[0].code, 'bad-overrides');
  const overlap = draft(
    { 'NPCs/Marta.md': MARTA_STATS },
    { folders: rule, overrides: { files: { 'NPCs/Marta.md': { replace: [{ from: 9, to: 10, text: 'a' }, { from: 10, to: 10, text: 'b' }] } } } },
  );
  assert.equal(overlap.result.ok, false);
  assert.equal(overlap.result.errors[0].code, 'bad-overrides');
  const notSheet = draft(
    { 'Mondo/Fenvale.md': '# Fenvale\n\nTesto.\n' },
    { folders: [{ path: 'Mondo', route: 'move', kind: 'place', target: 'Luoghi' }],
      overrides: { files: { 'Mondo/Fenvale.md': { replace: [{ from: 3, to: 3, text: 'x' }] } } } },
  );
  assert.equal(notSheet.result.ok, false);
  assert.equal(notSheet.result.errors[0].code, 'bad-overrides');
  assert.equal(validateRules({ input: '/tmp/x', masterHeading: 'M', masterConventions: {}, folders: [] },
    { files: { 'a.md': { replace: [{ from: 3, to: 2, text: 'x' }] } } })[0].code, 'bad-overrides');
});

test('replace plan: validatePlan accepts the text part', () => {
  const { root, result } = draft(
    { 'NPCs/Marta.md': MARTA_STATS },
    {
      folders: [{ path: 'NPCs', route: 'move', kind: 'character', template: 'npc', target: 'Personaggi' }],
      overrides: { files: { 'NPCs/Marta.md': { replace: [{ from: 9, to: 10, text: '| HP | 10 |' }] } } },
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(validatePlan(root, result.plan), []);
});

const PLACE = [{ path: 'Mondo', route: 'move', kind: 'place', target: 'Luoghi' }];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test('image under-title: the embed first after the H1 is left out of the parts, the image goes under the title', () => {
  const { result } = draft(
    { 'img/porto.png': PNG, 'Mondo/Fenvale.md': '# Fenvale\n\n![[porto.png]]\n\nTesto.\n' },
    { folders: PLACE, overrides: { images: { 'img/porto.png': { role: 'under-title', document: 'Mondo/Fenvale.md', alt: 'Il porto' } } } },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const doc = docOf(result.plan, 'Luoghi/Fenvale.md');
  assert.deepEqual(doc.image, { file: 'img/porto.png', target: 'Luoghi/img/porto.png', alt: 'Il porto' });
  assert.deepEqual(doc.parts.map((p) => [p.from, p.to]), [[1, 2], [4, 5]]);
  assert.deepEqual(result.plan.images, []);
});

test('image under-title: an embed that is not the first line stays where it is, the image still goes under the title', () => {
  const { result } = draft(
    { 'img/lago.png': PNG, 'Mondo/Lago.md': '# Lago\n\nTesto.\n\n![[lago.png]]\n' },
    { folders: PLACE, overrides: { images: { 'img/lago.png': { role: 'under-title', document: 'Mondo/Lago.md', alt: 'Il lago' } } } },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const doc = docOf(result.plan, 'Luoghi/Lago.md');
  assert.equal(doc.image.target, 'Luoghi/img/lago.png');
  assert.deepEqual(doc.parts.map((p) => [p.from, p.to]), [[1, 5]]);
});

test('image battlemap: copied, its embed line left out, and a Mappa text part with the relative href appended', () => {
  const { result } = draft(
    { 'img/pianta.png': PNG, 'Mondo/Torre.md': '# Torre\n\n![[pianta.png]]\n\nTesto.\n' },
    { folders: PLACE, overrides: { images: { 'img/pianta.png': { role: 'battlemap', document: 'Mondo/Torre.md', alt: 'Pianta della torre' } } } },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const doc = docOf(result.plan, 'Luoghi/Torre.md');
  assert.deepEqual(result.plan.images, [{ file: 'img/pianta.png', target: 'Luoghi/img/pianta.png' }]);
  assert.deepEqual(doc.parts.slice(0, 2).map((p) => [p.from, p.to]), [[1, 2], [4, 5]]);
  assert.deepEqual(doc.parts[2], { text: '## Mappa\n\n![Pianta della torre](img/pianta.png)', heading: null });
});

test('image atlas: not copied, listed in routes.atlas, its embeds stay for the apply to make plain text', () => {
  const { result } = draft(
    { 'img/mappa-del-mondo.png': PNG, 'Mondo/Mondo.md': '# Mondo\n\n![[mappa-del-mondo.png]]\n' },
    { folders: PLACE, overrides: { images: { 'img/mappa-del-mondo.png': { role: 'atlas' } } } },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.plan.images, []);
  assert.deepEqual(result.plan.routes.atlas, ['img/mappa-del-mondo.png']);
  assert.equal(result.summary.counts.atlas, 1);
  assert.deepEqual(docOf(result.plan, 'Luoghi/Mondo.md').parts.map((p) => [p.from, p.to]), [[1, 3]]);
});

test('image none: not copied and not routed, its embed stays for the apply', () => {
  const { result } = draft(
    { 'Items/img/bozza.png': PNG, 'Mondo/Bozza.md': '# Bozza\n\n![[bozza.png]]\n' },
    { folders: PLACE, overrides: { images: { 'Items/img/bozza.png': { role: 'none' } } } },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.plan.images, []);
  assert.deepEqual(result.plan.routes.atlas, []);
});

test('image roles: bad entries are bad-overrides', () => {
  const base = { input: '/tmp/x', masterHeading: 'M', masterConventions: {}, folders: [] };
  assert.equal(validateRules(base, { images: { 'a.png': { role: 'bogus' } } })[0].code, 'bad-overrides');
  assert.equal(validateRules(base, { images: { 'a.png': { role: 'under-title' } } })[0].code, 'bad-overrides');
  const notMove = draft(
    { 'Riferimenti/Note.md': '# Note\n', 'img/x.png': PNG },
    { folders: [{ path: 'Riferimenti', route: 'source' }], overrides: { images: { 'img/x.png': { role: 'battlemap', document: 'Riferimenti/Note.md' } } } },
  );
  assert.equal(notMove.result.ok, false);
  assert.equal(notMove.result.errors[0].code, 'bad-overrides');
  const notInReport = draft(
    { 'Mondo/A.md': '# A\n' },
    { folders: PLACE, overrides: { images: { 'img/missing.png': { role: 'none' } } } },
  );
  assert.equal(notInReport.result.ok, false);
  assert.equal(notInReport.result.errors[0].code, 'bad-overrides');
});

test('image roles: the plan with each role passes validatePlan', () => {
  const { root, result } = draft(
    {
      'img/porto.png': PNG,
      'Mondo/Fenvale.md': '# Fenvale\n\n![[porto.png]]\n\nTesto.\n',
      'img/pianta.png': PNG,
      'Mondo/Torre.md': '# Torre\n\n![[pianta.png]]\n\nTesto.\n',
      'img/mappa-del-mondo.png': PNG,
      'Mondo/Mondo.md': '# Mondo\n\n![[mappa-del-mondo.png]]\n',
    },
    {
      folders: PLACE,
      overrides: {
        images: {
          'img/porto.png': { role: 'under-title', document: 'Mondo/Fenvale.md', alt: 'Il porto' },
          'img/pianta.png': { role: 'battlemap', document: 'Mondo/Torre.md', alt: 'Pianta' },
          'img/mappa-del-mondo.png': { role: 'atlas' },
        },
      },
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(validatePlan(root, result.plan), []);
});
