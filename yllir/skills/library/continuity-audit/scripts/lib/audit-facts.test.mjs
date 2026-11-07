import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateFacts } from './audit-facts.mjs';
import { loadVocabulary } from './audit-vocabulary.mjs';

const AUDIT_VALIDATE = fileURLToPath(new URL('../audit-validate.mjs', import.meta.url));

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: people',
  '    folder: People',
  '    type: subjects',
  '  - id: places',
  '    folder: Places',
  '    type: places',
  '  - id: plot',
  '    folder: Plot',
  '    type: plot',
  '  - id: notes',
  '    folder: Notes',
  '    type: notes',
  '',
].join('\n');

const BASE_FILES = {
  'campaign.yaml': CAMPAIGN,
  'People/Oria Valdes.md': '---\nid: oria-valdes\n---\n\n# Oria Valdes\n\nUna guida.\n',
  'Places/Morvalle.md': '---\nid: morvalle\n---\n\n# Morvalle\n\nUn borgo.\n',
};

// Line 5 and line 6 hold the facts quoted by the tests.
const TRAMA = [
  '# Trama',
  '',
  '## Atto primo',
  '',
  'Oria Valdes trova la lanterna nel pozzo.',
  'Il lago è profondo e nero.',
  '',
].join('\n');

const TWICE = [
  '# Trama',
  '',
  '## Atto primo',
  '',
  'Oria Valdes trova la lanterna nel pozzo.',
  '',
  'Oria Valdes trova la lanterna nel pozzo.',
  '',
].join('\n');

const POZZO = '# Pozzo\n\n## Voce\n\nLa voce dell’Ascia parla piano.\n';

function fact(over = {}) {
  return {
    subject: 'oria-valdes',
    attribute: 'status.alive',
    value: 'yes',
    source_type: 'source-claim',
    quote: 'Oria Valdes trova la lanterna',
    ...over,
  };
}

function factsFile(fid, document, facts = [], read = true) {
  return { fid, document, read, facts };
}

/**
 * Writes a temporary campaign and a temporary facts folder, runs validateFacts,
 * and removes both. `docs` is the scope. `facts` maps a fid to the content of its
 * facts file: an object (written as JSON) or a string (written as is).
 */
function run({ files = {}, docs, facts = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  const factsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-facts-'));
  try {
    for (const [rel, content] of Object.entries({ ...BASE_FILES, ...files })) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    for (const [fid, content] of Object.entries(facts)) {
      fs.writeFileSync(
        path.join(factsDir, `${fid}.json`),
        typeof content === 'string' ? content : JSON.stringify(content),
      );
    }
    return validateFacts(
      root,
      { mode: 'pre', files: docs },
      factsDir,
      loadVocabulary(),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(factsDir, { recursive: true, force: true });
  }
}

const ONE = [{ fid: 'D001', document: 'Plot/Trama.md' }];

test('a valid fact is located by its unique quote', () => {
  const result = run({
    files: { 'Plot/Trama.md': TRAMA },
    docs: ONE,
    facts: { D001: factsFile('D001', 'Plot/Trama.md', [fact()]) },
  });
  assert.equal(result.facts.length, 1);
  const [f] = result.facts;
  assert.equal(f.id, 'F-D001-001');
  assert.equal(f.document, 'Plot/Trama.md');
  assert.equal(f.line, 5);
  assert.equal(f.subject, 'oria-valdes');
  assert.equal(f.attribute, 'status.alive');
  assert.equal(f.value, 'yes');
  assert.equal(f.from_metadata, false);
  assert.deepEqual(result.discarded, []);
  assert.deepEqual(result.coverage, [
    {
      fid: 'D001',
      document: 'Plot/Trama.md',
      status: 'extracted',
      facts_valid: 1,
      facts_discarded: 0,
      facts_ignored: 0,
    },
  ]);
  assert.deepEqual(result.ignored_frontmatter, []);
  assert.equal(result.complete, true);
});

test('a line hint resolves a quote that occurs twice, and without it the quote is ambiguous', () => {
  const hinted = run({
    files: { 'Plot/Trama.md': TWICE },
    docs: ONE,
    facts: { D001: factsFile('D001', 'Plot/Trama.md', [fact({ line: 7 })]) },
  });
  assert.equal(hinted.facts.length, 1);
  assert.equal(hinted.facts[0].line, 7);

  const plain = run({
    files: { 'Plot/Trama.md': TWICE },
    docs: ONE,
    facts: { D001: factsFile('D001', 'Plot/Trama.md', [fact()]) },
  });
  assert.equal(plain.facts.length, 0);
  assert.deepEqual(plain.discarded.map((d) => d.reason), ['quote ambiguous']);
});

test('a quote that does not occur is discarded as not found', () => {
  const result = run({
    files: { 'Plot/Trama.md': TRAMA },
    docs: ONE,
    facts: { D001: factsFile('D001', 'Plot/Trama.md', [fact({ quote: 'Oria Valdes vola sulla luna' })]) },
  });
  assert.deepEqual(result.discarded.map((d) => d.reason), ['quote not found']);
  assert.equal(result.coverage[0].status, 'read');
});

test('a quote that only occurs in the frontmatter is ignored, not discarded', () => {
  const doc = '---\nid: trama\nnote: Oria Valdes trova la lanterna\n---\n\n# Trama\n\nTesto.\n';
  const result = run({
    files: { 'Plot/Trama.md': doc },
    docs: ONE,
    facts: { D001: factsFile('D001', 'Plot/Trama.md', [fact()]) },
  });
  assert.deepEqual(result.discarded, []);
  assert.deepEqual(result.facts, []);
  assert.deepEqual(
    result.ignored_frontmatter.map((x) => [x.fid, x.index, x.fact.quote]),
    [['D001', 0, 'Oria Valdes trova la lanterna']],
  );
  assert.equal(result.coverage[0].status, 'read');
  assert.equal(result.coverage[0].facts_discarded, 0);
  assert.equal(result.coverage[0].facts_ignored, 1);
  assert.equal(result.complete, true);
});

test('a copied location line from a subject sheet is ignored and the metadata fact remains', () => {
  const sheet = '---\nid: oria-valdes\nlocation: [Morvalle, Borgo Cenere]\n---\n\n# Oria Valdes\n\nUna guida.\n';
  const result = run({
    files: { 'People/Oria Valdes.md': sheet },
    docs: [{ fid: 'D001', document: 'People/Oria Valdes.md' }],
    facts: {
      D001: factsFile('D001', 'People/Oria Valdes.md', [
        fact({
          attribute: 'location.current',
          value: 'Morvalle,Borgo Cenere',
          quote: 'location: [Morvalle, Borgo Cenere]',
        }),
      ]),
    },
  });
  assert.deepEqual(result.discarded, []);
  assert.deepEqual(result.facts.map((f) => f.id), ['M-D001']);
  assert.equal(result.ignored_frontmatter.length, 1);
  assert.equal(result.coverage[0].status, 'read');
  assert.equal(result.coverage[0].facts_ignored, 1);
});

test('a frontmatter ignore does not change the status of a document with valid facts', () => {
  const doc = '---\nid: trama\nnote: Oria Valdes trova la lanterna\n---\n\n# Trama\n\nIl lago è profondo e nero.\n';
  const result = run({
    files: { 'Plot/Trama.md': doc },
    docs: ONE,
    facts: {
      D001: factsFile('D001', 'Plot/Trama.md', [
        fact(),
        fact({ quote: 'Il lago è profondo e nero' }),
      ]),
    },
  });
  assert.equal(result.coverage[0].status, 'extracted');
  assert.equal(result.coverage[0].facts_valid, 1);
  assert.equal(result.coverage[0].facts_ignored, 1);
  assert.deepEqual(result.facts.map((f) => f.id), ['F-D001-002']);
});

test('a quote in both the body and the frontmatter is located in the body', () => {
  const doc = '---\nnote: Oria Valdes trova la lanterna\n---\n\n# Trama\n\nOria Valdes trova la lanterna nel pozzo.\n';
  const result = run({
    files: { 'Plot/Trama.md': doc },
    docs: ONE,
    facts: { D001: factsFile('D001', 'Plot/Trama.md', [fact()]) },
  });
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].line, 7);
  assert.deepEqual(result.ignored_frontmatter, []);
});

test('accent-insensitive and apostrophe-insensitive quotes match', () => {
  const result = run({
    files: { 'Plot/Trama.md': TRAMA, 'Plot/Pozzo.md': POZZO },
    docs: [
      { fid: 'D001', document: 'Plot/Trama.md' },
      { fid: 'D002', document: 'Plot/Pozzo.md' },
    ],
    facts: {
      D001: factsFile('D001', 'Plot/Trama.md', [fact({ quote: 'Il lago e profondo e nero' })]),
      D002: factsFile('D002', 'Plot/Pozzo.md', [
        fact({ subject: 'morvalle', attribute: 'status.alive', quote: "La voce dell'Ascia parla" }),
      ]),
    },
  });
  assert.deepEqual(result.discarded, []);
  assert.deepEqual(result.facts.map((f) => [f.document, f.line]), [
    ['Plot/Pozzo.md', 5],
    ['Plot/Trama.md', 6],
  ]);
});

test('section and in_master are derived from the located line', () => {
  const doc = [
    '# Trama',
    '',
    '## Atto primo',
    '',
    'Oria Valdes trova la lanterna nel pozzo.',
    '',
    '<!-- master -->',
    '## Master',
    '',
    "Oria Valdes e' il traitore segreto.",
    '<!-- /master -->',
    '',
  ].join('\n');
  const result = run({
    files: { 'Plot/Trama.md': doc },
    docs: ONE,
    facts: {
      D001: factsFile('D001', 'Plot/Trama.md', [
        fact(),
        fact({ quote: "Oria Valdes e' il traitore" }),
      ]),
    },
  });
  const [first, second] = result.facts;
  assert.equal(first.section, 'Atto primo');
  assert.equal(first.in_master, false);
  assert.equal(second.section, 'Master');
  assert.equal(second.in_master, true);
  assert.equal(second.id, 'F-D001-002');
});

test('each discard reason is reported with its index', () => {
  const result = run({
    files: { 'Plot/Trama.md': TRAMA },
    docs: ONE,
    facts: {
      D001: factsFile('D001', 'Plot/Trama.md', [
        'testo',
        { subject: 'oria-valdes', attribute: 'status.alive', value: 'yes', source_type: 'source-claim' },
        fact({ subject: 'nessuno' }),
        fact({ attribute: 'status.dead' }),
        fact({ attribute: 'date.founded', value: 'mille' }),
        fact({ source_type: 'rumor' }),
        fact({ quote: 'Oria' }),
        fact({ attribute: 'number.depth', value: 'molti' }),
        fact({ attribute: 'Status.alive' }),
        fact({ attribute: 'location.current', value: 'morvalle,' }),
      ]),
    },
  });
  const reasons = result.discarded.map((d) => [d.index, d.reason.split(' (')[0]]);
  assert.deepEqual(reasons, [
    [0, 'not an object'],
    [1, 'missing field: quote'],
    [2, 'unknown subject: nessuno'],
    [3, 'unknown attribute: status.dead'],
    [4, 'bad value: date needs a digit'],
    [5, 'unknown source type: rumor'],
    [6, 'quote too short'],
    [7, 'bad value: number must be digits, optionally with a decimal point'],
    [8, 'unknown attribute: Status.alive'],
    [9, 'bad value: every item of the list must be non-empty'],
  ]);
  assert.equal(result.discarded[1].fact.attribute, 'status.alive');
  assert.equal(result.facts.length, 0);
  assert.equal(result.coverage[0].status, 'read');
  assert.equal(result.coverage[0].facts_discarded, 10);
});

test('a numeric value is converted to text and the id keeps the position', () => {
  const result = run({
    files: { 'Plot/Trama.md': TRAMA },
    docs: ONE,
    facts: {
      D001: factsFile('D001', 'Plot/Trama.md', [
        'testo',
        fact({ attribute: 'number.depth', value: 30, quote: 'Il lago è profondo e nero' }),
      ]),
    },
  });
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].id, 'F-D001-002');
  assert.equal(result.facts[0].value, '30');
  assert.equal(result.facts[0].line, 6);
});

test('a note document forces the source type to hypothesis', () => {
  const result = run({
    files: { 'Notes/Idee.md': '# Idee\n\nForse Oria Valdes è la madre di Lino.\n' },
    docs: [{ fid: 'D001', document: 'Notes/Idee.md' }],
    facts: {
      D001: factsFile('D001', 'Notes/Idee.md', [
        fact({ source_type: 'editorial-summary', quote: 'Forse Oria Valdes è la madre' }),
      ]),
    },
  });
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].source_type, 'hypothesis');
  assert.equal(result.facts[0].forced_hypothesis, true);
});

test('the location list of a subject sheet adds a metadata fact', () => {
  const sheet = '---\nid: oria-valdes\nlocation: [Morvalle, Borgo Cenere]\n---\n\n# Oria Valdes\n\nUna guida.\n';
  const result = run({
    files: { 'People/Oria Valdes.md': sheet },
    docs: [{ fid: 'D001', document: 'People/Oria Valdes.md' }],
    facts: { D001: factsFile('D001', 'People/Oria Valdes.md') },
  });
  assert.equal(result.facts.length, 1);
  const [m] = result.facts;
  assert.equal(m.id, 'M-D001');
  assert.equal(m.subject, 'oria-valdes');
  assert.equal(m.attribute, 'location.current');
  assert.equal(m.value, 'Morvalle,Borgo Cenere');
  assert.equal(m.quote, 'location: [Morvalle, Borgo Cenere]');
  assert.equal(m.line, 3);
  assert.equal(m.section, 'metadata');
  assert.equal(m.from_metadata, true);
  assert.equal(result.coverage[0].status, 'read');
  assert.equal(result.coverage[0].facts_valid, 0);
});

test('documents that were not read are to-read and make the result incomplete', () => {
  const result = run({
    files: {
      'Plot/Trama.md': TRAMA,
      'Plot/Pozzo.md': POZZO,
      'Plot/Altro.md': '# Altro\n\nNiente.\n',
      'Plot/Ultimo.md': '# Ultimo\n\nAltro testo.\n',
    },
    docs: [
      { fid: 'D001', document: 'Plot/Trama.md' },
      { fid: 'D002', document: 'Plot/Pozzo.md' },
      { fid: 'D003', document: 'Plot/Altro.md' },
      { fid: 'D004', document: 'Plot/Ultimo.md' },
    ],
    facts: {
      D002: factsFile('D002', 'Plot/Pozzo.md', [], false),
      D003: factsFile('D003', 'Plot/Otro.md', []),
      D004: '{ non json',
    },
  });
  assert.deepEqual(
    result.coverage.map((c) => [c.fid, c.status]),
    [
      ['D001', 'to-read'],
      ['D002', 'to-read'],
      ['D003', 'to-read'],
      ['D004', 'to-read'],
    ],
  );
  assert.equal(result.complete, false);
});

test('a read document with no facts is read, and a complete scope is complete', () => {
  const result = run({
    files: { 'Plot/Pozzo.md': POZZO, 'Plot/Trama.md': TRAMA },
    docs: [
      { fid: 'D001', document: 'Plot/Trama.md' },
      { fid: 'D002', document: 'Plot/Pozzo.md' },
    ],
    facts: {
      D001: factsFile('D001', 'Plot/Trama.md', [fact()]),
      D002: factsFile('D002', 'Plot/Pozzo.md', []),
    },
  });
  assert.deepEqual(
    result.coverage.map((c) => c.status),
    ['extracted', 'read'],
  );
  assert.equal(result.complete, true);
});

test('a missing document is reported as an error and is to-read', () => {
  const result = run({
    docs: [{ fid: 'D001', document: 'Plot/Fantasma.md' }],
    facts: {},
  });
  assert.deepEqual(result.errors, [
    { fid: 'D001', document: 'Plot/Fantasma.md', message: 'document not found' },
  ]);
  assert.equal(result.coverage[0].status, 'to-read');
  assert.equal(result.complete, false);
});

test('audit-validate prints ignored frontmatter facts in the summary, not as discards', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-cli-'));
  try {
    const files = {
      ...BASE_FILES,
      'Plot/Trama.md': '---\nid: trama\nnote: Oria Valdes trova la lanterna\n---\n\n# Trama\n\nIl lago è profondo e nero.\n',
    };
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    const scopeFile = path.join(work, 'scope.json');
    fs.writeFileSync(
      scopeFile,
      JSON.stringify({ mode: 'pre', subjects: [], files: ONE, errors: [] }),
    );
    const factsDir = path.join(work, 'facts');
    fs.mkdirSync(factsDir);
    fs.writeFileSync(
      path.join(factsDir, 'D001.json'),
      JSON.stringify(
        factsFile('D001', 'Plot/Trama.md', [
          fact(),
          fact({ quote: 'Il lago è profondo e nero' }),
        ]),
      ),
    );
    const out = path.join(work, 'facts-out.json');

    const run = spawnSync(
      process.execPath,
      [AUDIT_VALIDATE, root, '--scope', scopeFile, '--facts-dir', factsDir, '--out', out],
      { encoding: 'utf8' },
    );
    const lines = run.stdout.trim().split('\n');
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      lines[0],
      'documents: 1, extracted: 1, read: 0, to-read: 0, facts: 1, discarded: 0, ignored (frontmatter): 1, complete: true',
    );
    assert.equal(lines.length, 1, 'no discard line is printed');
    const written = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(written.ignored_frontmatter.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});
