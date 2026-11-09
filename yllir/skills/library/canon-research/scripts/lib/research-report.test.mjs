import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTerms, searchCampaign } from './research-search.mjs';
import { writeResearchReport } from './research-report.mjs';

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
  // Line 8 is "Teodo lavora alla forgia del borgo."
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
  'Personaggi/Oria Brunel.md': ['---', 'id: oria-brunel', 'aliases: [Oria]', '---', '', '# Oria Brunel', '', 'Oria Brunel parla poco.', ''].join('\n'),
  'Personaggi/Oria Valdes.md': ['---', 'id: oria-valdes', 'aliases: [Oria]', '---', '', '# Oria Valdes', '', 'Oria Valdes guarda il lago.', ''].join('\n'),
  'Mondo/Pozzo di Nar.md': ['---', 'id: pozzo-di-nar', '---', '', '# Pozzo di Nar', '', 'Il pozzo risponde.', ''].join('\n'),
  'Trama/Sessione 1.md': ['# Sessione 1', '', 'Teodo entra in scena. Vedi [Teodo](../Personaggi/Teodo%20Marr.md#forgia).', "Teodore non c'entra.", ''].join('\n'),
  // Line 9 is inside the master block.
  'Trama/Sessione 2.md': ['# Sessione 2', '', 'La scena è pubblica.', '', MASTER_BLOCK].join('\n'),
  'Giocatori/Neri Calce.md': ['---', 'id: neri-calce', '---', '', '# Neri Calce', '', 'Teodo deve un debito a Neri.', ''].join('\n'),
  // Line 3 is "Teodo deve un favore al mugnaio."
  'Appunti/Idee.md': ['# Idee', '', 'Teodo deve un favore al mugnaio.', ''].join('\n'),
  'Fonti/Libro.md': ['# Libro', '', 'Teodo appare in una cronaca antica.', ''].join('\n'),
};

/**
 * Creates a temporary campaign (and a work folder next to it), runs the search and
 * the report, and returns the report text and result.
 */
function runReport(t, { terms = 'Teodo', answer, raw, read, continueWith = 'ask the master' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'campaign');
  const work = path.join(dir, 'work');
  fs.mkdirSync(work, { recursive: true });
  for (const [rel, content] of Object.entries({ 'campaign.yaml': CAMPAIGN, ...FILES })) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  const search = searchCampaign(root, parseTerms(terms));
  const searchFile = path.join(work, 'search.json');
  fs.writeFileSync(searchFile, JSON.stringify(search));

  const answerFile = path.join(work, 'answer.json');
  if (raw !== undefined) {
    fs.writeFileSync(answerFile, raw);
  } else {
    const value = answer ?? {};
    fs.writeFileSync(answerFile, JSON.stringify({ read: read ?? search.files_with_hits, unverified_leads: [], ...value }));
  }

  const outFile = path.join(work, 'report.txt');
  const result = writeResearchReport({ root, searchFile, answerFile, continueWith, outFile });
  return { ...result, text: fs.readFileSync(outFile, 'utf8') };
}

const FACT_ON_LINE_8 = {
  answer: 'Teodo lavora alla forgia.',
  claims: [
    {
      class: 'fact',
      text: 'Teodo lavora alla forgia del borgo.',
      evidence: [{ file: 'Personaggi/Teodo Marr.md', line: 8, quote: 'lavora alla forgia' }],
    },
  ],
};

test('a valid answer that covers every hit file is DONE', (t) => {
  const { status, problems, text } = runReport(t, { answer: FACT_ON_LINE_8 });
  assert.equal(status, 'DONE');
  assert.deepEqual(problems, []);
  assert.match(text, /^RESEARCH REPORT\nstatus: DONE\nquestion terms: Teodo\n/);
  assert.match(text, /covered: 9 documents scanned, \d+ hits in 6 files, 6 files read/);
  assert.match(text, /not read: none\n/);
  assert.match(text, /contains master-only content: no\n/);
  assert.match(text, /homonyms: none\n/);
  assert.match(text, /- \[fact\] Teodo lavora alla forgia del borgo\. \(Personaggi\/Teodo Marr\.md:8\)\n/);
  assert.match(text, /continue with: ask the master\n$/);
});

test('a quote that is not on the cited line is a problem and needs attention', (t) => {
  const answer = {
    ...FACT_ON_LINE_8,
    claims: [{ ...FACT_ON_LINE_8.claims[0], evidence: [{ file: 'Personaggi/Teodo Marr.md', line: 8, quote: 'forgia del pozzo' }] }],
  };
  const { status, problems, text } = runReport(t, { answer });
  assert.equal(status, 'NEEDS_ATTENTION');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^claim 1, Personaggi\/Teodo Marr\.md:8: quote not found on that line$/);
  assert.match(text, /^problems:\n- claim 1, Personaggi\/Teodo Marr\.md:8: quote not found on that line\n/m);
});

test('a fact supported only by a notes file is a problem, and a hypothesis on the same file is accepted', (t) => {
  const notesEvidence = [{ file: 'Appunti/Idee.md', line: 3, quote: 'deve un favore' }];
  const asFact = runReport(t, {
    answer: { answer: 'Teodo deve un favore.', claims: [{ class: 'fact', text: 'Teodo deve un favore.', evidence: notesEvidence }] },
  });
  assert.equal(asFact.status, 'NEEDS_ATTENTION');
  assert.ok(asFact.problems.includes('claim 1: a fact supported only by notes or sources; use hypothesis or source-claim'));

  const asHypothesis = runReport(t, {
    answer: { answer: 'Forse Teodo deve un favore.', claims: [{ class: 'hypothesis', text: 'Forse Teodo deve un favore.', evidence: notesEvidence }] },
  });
  assert.equal(asHypothesis.status, 'DONE');
});

test('a file with hits that was not read makes the report NEEDS_ATTENTION and lists it', (t) => {
  const { status, problems, text } = runReport(t, {
    answer: FACT_ON_LINE_8,
    read: runSearchFiles().filter((file) => file !== 'Fonti/Libro.md'),
  });
  assert.equal(status, 'NEEDS_ATTENTION');
  assert.deepEqual(problems, []);
  assert.match(text, /^not read: Fonti\/Libro\.md$/m);
});

test('a read entry that is not a scanned document is a problem', (t) => {
  const { status, problems } = runReport(t, {
    answer: FACT_ON_LINE_8,
    read: [...runSearchFiles(), 'Inesistente.md'],
  });
  assert.equal(status, 'NEEDS_ATTENTION');
  assert.deepEqual(problems, ['read: Inesistente.md is not a scanned document']);
});

test('an answer file that is not valid JSON gives FAILED and still writes the report', (t) => {
  const { status, problems, text } = runReport(t, { raw: '{"answer": ' });
  assert.equal(status, 'FAILED');
  assert.deepEqual(problems, ['answer file is not valid JSON']);
  assert.match(text, /^status: FAILED$/m);
  assert.match(text, /^covered: 9 documents scanned, /m);
});

test('evidence in the master block sets contains master-only content to yes', (t) => {
  const answer = {
    answer: 'Teodo ha il sigillo.',
    claims: [
      {
        class: 'fact',
        text: 'Teodo custodisce il sigillo.',
        evidence: [{ file: 'Trama/Sessione 2.md', line: 9, quote: 'Teodo ha il sigillo' }],
      },
    ],
  };
  const { status, problems, text } = runReport(t, { answer });
  assert.equal(status, 'DONE');
  assert.deepEqual(problems, []);
  assert.match(text, /^contains master-only content: yes$/m);
});

test('evidence from an external folder is named as read-only shared world in the report', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-ext-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  });
  const root = path.join(dir, 'campaign');
  const work = path.join(dir, 'work');
  fs.mkdirSync(work, { recursive: true });
  const campaign = `${CAMPAIGN}  - id: mondo-condiviso\n    folder: Esterno\n    type: external\n`;
  for (const [rel, content] of Object.entries({
    'campaign.yaml': campaign,
    'Mondo/Pozzo di Nar.md': ['---', 'id: pozzo-di-nar', '---', '', '# Pozzo di Nar', '', 'Il pozzo risponde.', ''].join('\n'),
  })) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  fs.mkdirSync(path.join(source, 'Luoghi'), { recursive: true });
  fs.writeFileSync(path.join(source, 'Luoghi', 'Raatnagar.md'), '# Raatnagar\n\nTeodo lavora alla forgia di Raatnagar.\n');
  fs.symlinkSync(source, path.join(root, 'Esterno'), 'dir');

  const search = searchCampaign(root, parseTerms('forgia'));
  assert.deepEqual(search.external_documents, ['Esterno/Luoghi/Raatnagar.md']);
  const searchFile = path.join(work, 'search.json');
  fs.writeFileSync(searchFile, JSON.stringify(search));
  const answerFile = path.join(work, 'answer.json');
  fs.writeFileSync(answerFile, JSON.stringify({
    answer: 'La forgia è di Teodo.',
    read: ['Esterno/Luoghi/Raatnagar.md'],
    unverified_leads: [],
    claims: [
      {
        class: 'fact',
        text: 'Teodo lavora alla forgia di Raatnagar.',
        evidence: [{ file: 'Esterno/Luoghi/Raatnagar.md', line: 3, quote: 'lavora alla forgia' }],
      },
    ],
  }));
  const outFile = path.join(work, 'report.txt');
  const { status, problems } = writeResearchReport({ root, searchFile, answerFile, continueWith: 'ask the master', outFile });
  const text = fs.readFileSync(outFile, 'utf8');
  assert.equal(status, 'DONE');
  assert.deepEqual(problems, []);
  assert.match(text, /^from the shared world \(external, read only\): Esterno\/Luoghi\/Raatnagar\.md$/m);
  assert.match(text, /^- \[fact\] Teodo lavora alla forgia di Raatnagar\. \(Esterno\/Luoghi\/Raatnagar\.md:3\)$/m);
});

test('a report with no external evidence says none for the shared world', (t) => {
  const { text } = runReport(t, { answer: FACT_ON_LINE_8 });
  assert.match(text, /^from the shared world \(external, read only\): none$/m);
});

test('a zero-hit search with a silence claim is DONE, and covered proves the coverage', (t) => {
  const answer = {
    answer: 'Nessun riscontro.',
    claims: [{ class: 'silence', text: 'Nessun documento cita il termine.' }],
    read: [],
  };
  const { status, problems, text } = runReport(t, { terms: 'Inesistente', answer });
  assert.equal(status, 'DONE');
  assert.deepEqual(problems, []);
  assert.match(text, /covered: 9 documents scanned, 0 hits in 0 files, 0 files read/);
  assert.match(text, /^- \[silence\] Nessun documento cita il termine\.$/m);
});

test('a homonym is listed in the report', (t) => {
  const answer = {
    answer: 'Non so chi sia Oria.',
    claims: [{ class: 'silence', text: 'Nessun riscontro sul nome.' }],
  };
  const { status, text } = runReport(t, { terms: 'Oria', answer });
  assert.equal(status, 'DONE');
  assert.match(text, /^homonyms: oria: oria-brunel, oria-valdes$/m);
});

test('an unknown claim class is a shape problem', (t) => {
  const answer = {
    answer: 'Boh.',
    claims: [{ class: 'opinion', text: 'Teodo è simpatico.' }],
  };
  const { status, problems } = runReport(t, { answer });
  assert.equal(status, 'NEEDS_ATTENTION');
  assert.ok(problems.some((p) => p.startsWith('claim 1: class must be one of')));
});

/** The files with hits for the default search ("Teodo"), in the order the search writes them. */
function runSearchFiles() {
  return [
    'Appunti/Idee.md',
    'Fonti/Libro.md',
    'Giocatori/Neri Calce.md',
    'Personaggi/Teodo Marr.md',
    'Trama/Sessione 1.md',
    'Trama/Sessione 2.md',
  ];
}
