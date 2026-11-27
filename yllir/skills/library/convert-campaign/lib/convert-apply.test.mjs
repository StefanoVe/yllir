// Tests of the structured convert apply (convert-apply.mjs, spec issue #138 sections 4-6).
// Each test builds a temporary campaign root and a temporary input folder with small Markdown files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyPlan, validatePlan } from './convert-apply.mjs';
import { checkLinks } from '../../../../scripts/lib/links/check-links.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'convert-apply.mjs');
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
  - id: pg
    type: master-only
    folder: Giocatori
`;

/** Campaign root and input folder, with the input files written (string or Buffer values). */
function setup(inputFiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-apply-'));
  const input = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-apply-in-'));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), CAMPAIGN_YAML);
  for (const [rel, content] of Object.entries(inputFiles)) {
    fs.mkdirSync(path.dirname(path.join(input, rel)), { recursive: true });
    fs.writeFileSync(path.join(input, rel), content);
  }
  return { root, input };
}

function planFor(input, { documents, images = [], routes = {}, masterConventions = {} }) {
  return {
    input,
    masterHeading: MASTER_HEADING,
    masterConventions,
    documents,
    images,
    routes: { source: [], skip: [], full: [], ...routes },
  };
}

function draftOf(root, target) {
  return fs.readFileSync(path.join(root, '.campaign', 'drafts', target), 'utf8');
}

/**
 * Public text of a draft, as the invariant of spec section 6 reads it: the metadata block, the title,
 * the image line and the reserved block removed; every link replaced by its text. Blank borders dropped.
 */
function publicLines(draft) {
  const lines = draft.split('\n');
  let body = lines.slice(lines.indexOf('-->') + 1);
  const master = body.indexOf('<!-- master -->');
  if (master >= 0) body = body.slice(0, master);
  const title = body.findIndex((l) => /^# /.test(l));
  if (title >= 0) body = body.filter((_, i) => i !== title);
  body = body.filter((l) => !/^!\[[^\]]*\]\([^)]*\)$/.test(l));
  const plain = body.map((l) => l.replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, '$1'));
  let a = 0;
  let b = plain.length;
  while (a < b && plain[a].trim() === '') a++;
  while (b > a && plain[b - 1].trim() === '') b--;
  return plain.slice(a, b);
}

function cleanup(...dirs) {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}

const BASE_A = '---\naliases: [X]\n---\n# A\nTesto.\n';

test('move: front-matter dropped, title and metadata written, first H1 dropped', () => {
  const { root, input } = setup({
    'Luoghi/Fenvale.md': '---\naliases: [Porto Grigio]\ncssclass: tabella\ntags: [luogo]\n---\n# Fenvale\nIl porto è piccolo.\n',
  });
  try {
    const result = applyPlan(root, planFor(input, {
      documents: [{
        target: 'Luoghi/Fenvale.md',
        title: 'Fenvale',
        meta: { id: 'fenvale', kind: 'place', provenance: 'master', location: [], aliases: ['Porto Grigio'] },
        parts: [{ file: 'Luoghi/Fenvale.md', from: 6, to: 7, heading: null, shift: 0 }],
      }],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(
      draftOf(root, 'Luoghi/Fenvale.md'),
      '<!-- yllir\nid: fenvale\nkind: place\nprovenance: master\nlocation: []\naliases: [Porto Grigio]\n-->\n\n# Fenvale\n\nIl porto è piccolo.\n',
    );
    assert.deepEqual(result.droppedKeys, [{ file: 'Luoghi/Fenvale.md', keys: ['cssclass', 'tags'] }]);
    assert.deepEqual(result.files, ['Luoghi/Fenvale.md']);
    assert.deepEqual(result.sources, []);
  } finally {
    cleanup(root, input);
  }
});

test('split: one file with three sections gives three documents, shift and uncovered lines', () => {
  const { root, input } = setup({
    'Note/Mondo.md': '# Mondo\n## Porto\nIl porto è vivo.\n### Banchine\nLe banchine sono lunghe.\n## Foresta\nGli alberi.\n## Montagna\nLa vetta.\nNota fuori.\n',
  });
  try {
    const doc = (target, title, from, to, shift) => ({
      target,
      title,
      meta: { id: title.toLowerCase(), kind: 'place', provenance: 'master' },
      parts: [{ file: 'Note/Mondo.md', from, to, heading: null, shift }],
    });
    const result = applyPlan(root, planFor(input, {
      documents: [
        doc('Luoghi/Porto.md', 'Porto', 3, 5, -1),
        doc('Luoghi/Foresta.md', 'Foresta', 7, 7, 0),
        doc('Luoghi/Montagna.md', 'Montagna', 9, 9, 0),
      ],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.files, ['Luoghi/Foresta.md', 'Luoghi/Montagna.md', 'Luoghi/Porto.md']);
    assert.equal(
      draftOf(root, 'Luoghi/Porto.md'),
      '<!-- yllir\nid: porto\nkind: place\nprovenance: master\n-->\n\n# Porto\n\nIl porto è vivo.\n## Banchine\nLe banchine sono lunghe.\n',
    );
    assert.deepEqual(publicLines(draftOf(root, 'Luoghi/Foresta.md')), ['Gli alberi.']);
    assert.deepEqual(result.uncovered, [{ file: 'Note/Mondo.md', lines: [1, 2, 6, 8, 10] }]);
  } finally {
    cleanup(root, input);
  }
});

test('links: wiki, label, anchor, self, markdown, missing, ambiguous, skipped, master-only', () => {
  const { root, input } = setup({
    'Luoghi/A.md': '# A\nVedi [[B]], [[B|etichetta]] e [[B#Il molo]].\n[[#Sezione]] qui.\n## Sezione\nTesto [x](../Personaggi/B%20c.md) e [[Nessuno]] e [[Dup]] e [[Indice]].\nPg [[Pg]].\n',
    'Personaggi/B.md': '# B\nTesto di B.\n## Il molo\nSul molo.\n',
    'Personaggi/B c.md': '# B c\nAltro.\n',
    'Giocatori/Pg.md': '# Pg\nSegreto del pg.\n',
    'Luoghi/Dup.md': '# Dup\n',
    'Personaggi/Dup.md': '# Dup\n',
    'Indice.md': '# Indice\n',
  });
  const targets = ['Luoghi/A.md', 'Personaggi/B.md', 'Personaggi/B c.md', 'Giocatori/Pg.md'];
  try {
    const result = applyPlan(root, planFor(input, {
      routes: { skip: ['Indice.md'] },
      documents: [
        { target: 'Luoghi/A.md', title: 'A', meta: { id: 'a', kind: 'place', provenance: 'master' }, parts: [{ file: 'Luoghi/A.md', from: 2, to: 6, heading: null, shift: 0 }] },
        { target: 'Personaggi/B.md', title: 'B', meta: { id: 'b', kind: 'character', provenance: 'master' }, parts: [{ file: 'Personaggi/B.md', from: 2, to: 4, heading: null, shift: 0 }] },
        { target: 'Personaggi/B c.md', title: 'B c', meta: { id: 'bc', kind: 'character', provenance: 'master' }, parts: [{ file: 'Personaggi/B c.md', from: 2, to: 2, heading: null, shift: 0 }] },
        { target: 'Giocatori/Pg.md', title: 'Pg', meta: { id: 'pg', provenance: 'master' }, parts: [{ file: 'Giocatori/Pg.md', from: 2, to: 2, heading: null, shift: 0 }] },
      ],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(publicLines(draftOf(root, 'Luoghi/A.md')), [
      'Vedi B, etichetta e B.',
      'Sezione qui.',
      '## Sezione',
      'Testo x e Nessuno e Dup e Indice.',
      'Pg Pg.',
    ]);
    const a = draftOf(root, 'Luoghi/A.md');
    assert.ok(a.includes('[B](../Personaggi/B.md), [etichetta](../Personaggi/B.md)'), a);
    assert.ok(a.includes('[B](../Personaggi/B.md#il-molo)'), a);
    assert.ok(a.includes('[Sezione](A.md#sezione) qui.'), a);
    assert.ok(a.includes('[x](../Personaggi/B%20c.md)'), a);
    const reasons = result.plainLinks.map((l) => `${l.text}:${l.reason}`).sort();
    assert.deepEqual(reasons, ['Dup:ambiguous', 'Indice:skipped', 'Nessuno:missing', 'Pg:master-only']);

    // Copy each draft to its final place and check the links with the oracle.
    for (const t of targets) fs.cpSync(path.join(root, '.campaign', 'drafts', t), path.join(root, t));
    const check = checkLinks(root, { files: targets });
    assert.deepEqual(check.errors, []);
  } finally {
    cleanup(root, input);
  }
});

test('master conventions: html-master, heading, callout, obsidian comments, public comment', () => {
  const { root, input } = setup({
    'Luoghi/C.md': [
      '# C',
      'Testo pubblico.',
      '<!-- master -->',
      'Nota grezza.',
      '> [!note] Dentro.',
      '<!-- /master -->',
      '> [!secret] Il pozzo.',
      '> seconda riga',
      '%% nota breve %% resta',
      '%% multi',
      'riga due %%',
      '<!-- commento pubblico -->',
      'Coda.',
      '## Segreti',
      'Dentro il segreto.',
      '',
    ].join('\n'),
  });
  try {
    const result = applyPlan(root, planFor(input, {
      masterConventions: {
        'html-master': 'master',
        'callout:note': 'master',
        'callout:secret': 'master',
        'obsidian-comment': 'master',
        'heading:segreti': 'master',
        'html-comment': 'public',
      },
      documents: [{
        target: 'Luoghi/C.md',
        title: 'C',
        meta: { id: 'c', kind: 'place', provenance: 'master' },
        parts: [{ file: 'Luoghi/C.md', from: 2, to: 15, heading: null, shift: 0 }],
      }],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.masterBlocks, { moved: 5, fixed: 1 });
    assert.equal(
      draftOf(root, 'Luoghi/C.md'),
      [
        '<!-- yllir', 'id: c', 'kind: place', 'provenance: master', '-->', '',
        '# C', '',
        'Testo pubblico.', ' resta', '<!-- commento pubblico -->', 'Coda.', '',
        '<!-- master -->', '## Master', '',
        '### Indicazioni per il master', 'Nota grezza.', '> [!note] Dentro.', '',
        '### Indicazioni per il master', '> [!secret] Il pozzo.', '> seconda riga', '',
        ' nota breve ', '',
        ' multi', 'riga due ', '',
        '### Segreti', '', 'Dentro il segreto.',
        '<!-- /master -->', '',
      ].join('\n'),
    );
    const lines = draftOf(root, 'Luoghi/C.md').split('\n');
    assert.equal(lines.at(-2), '<!-- /master -->');
    assert.deepEqual(publicLines(draftOf(root, 'Luoghi/C.md')), ['Testo pubblico.', ' resta', '<!-- commento pubblico -->', 'Coda.']);
  } finally {
    cleanup(root, input);
  }
});

test('image: field under the title is written, the bytes are copied, embeds are rewritten', () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
  const { root, input } = setup({
    'Luoghi/Fen.md': '# Fen\nVedi ![[x.png]] e ![[y.png]].\n',
    'img/x.png': bytes,
    'img/y.png': Buffer.from([1, 2, 3]),
  });
  try {
    const result = applyPlan(root, planFor(input, {
      documents: [{
        target: 'Luoghi/Fen.md',
        title: 'Fen',
        meta: { id: 'fen', kind: 'place', provenance: 'master' },
        image: { file: 'img/x.png', target: 'Luoghi/img/x.png', alt: 'Un porto' },
        parts: [{ file: 'Luoghi/Fen.md', from: 2, to: 2, heading: null, shift: 0 }],
      }],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(
      draftOf(root, 'Luoghi/Fen.md'),
      '<!-- yllir\nid: fen\nkind: place\nprovenance: master\n-->\n\n# Fen\n\n![Un porto](img/x.png)\n\nVedi ![](img/x.png) e y.png.\n',
    );
    assert.deepEqual(fs.readFileSync(path.join(root, 'Luoghi/img/x.png')), bytes);
    assert.deepEqual(result.sources, ['Luoghi/img/x.png']);
    assert.deepEqual(result.plainLinks, [{ document: 'Luoghi/Fen.md', raw: '![[y.png]]', text: 'y.png', reason: 'image-not-copied' }]);
  } finally {
    cleanup(root, input);
  }
});

test('image embed: an Obsidian size label is not the alt text, any other label is', () => {
  const { root, input } = setup({
    'Luoghi/Fen.md': '# Fen\nA ![[img/x.png|300]] e ![[img/x.png|Il porto]].\n',
    'img/x.png': Buffer.from([1, 2, 3]),
  });
  try {
    const result = applyPlan(root, planFor(input, {
      images: [{ file: 'img/x.png', target: 'Luoghi/img/x.png' }],
      documents: [{
        target: 'Luoghi/Fen.md',
        title: 'Fen',
        meta: { id: 'fen', kind: 'place', provenance: 'master' },
        parts: [{ file: 'Luoghi/Fen.md', from: 2, to: 2, heading: null, shift: 0 }],
      }],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const draft = draftOf(root, 'Luoghi/Fen.md');
    assert.ok(draft.includes('A ![](img/x.png) e ![Il porto](img/x.png).'), draft);
  } finally {
    cleanup(root, input);
  }
});

test('href: parentheses in a target stay percent-encoded and pass the link checker', () => {
  const { root, input } = setup({
    'Luoghi/A.md': '# A\nVedi [[Selva (Porto)]].\n',
    'Personaggi/Selva (Porto).md': '# Selva\nBosco.\n',
  });
  try {
    const result = applyPlan(root, planFor(input, {
      documents: [
        { target: 'Luoghi/A.md', title: 'A', meta: { id: 'a', kind: 'place', provenance: 'master' }, parts: [{ file: 'Luoghi/A.md', from: 2, to: 2, heading: null, shift: 0 }] },
        { target: 'Personaggi/Selva (Porto).md', title: 'Selva', meta: { id: 'selva', kind: 'character', provenance: 'master' }, parts: [{ file: 'Personaggi/Selva (Porto).md', from: 2, to: 2, heading: null, shift: 0 }] },
      ],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.ok(draftOf(root, 'Luoghi/A.md').includes('[Selva (Porto)](../Personaggi/Selva%20%28Porto%29.md)'), draftOf(root, 'Luoghi/A.md'));
    for (const t of ['Luoghi/A.md', 'Personaggi/Selva (Porto).md']) {
      fs.mkdirSync(path.dirname(path.join(root, t)), { recursive: true });
      fs.cpSync(path.join(root, '.campaign', 'drafts', t), path.join(root, t));
    }
    assert.deepEqual(checkLinks(root, { files: ['Luoghi/A.md'] }).errors, []);
  } finally {
    cleanup(root, input);
  }
});

test('item: the master block is always written, with a notes heading when nothing was moved', () => {
  const { root, input } = setup({ 'Oggetti/Corno.md': '# Corno\nUn corno di bronzo.\n' });
  try {
    const result = applyPlan(root, planFor(input, {
      documents: [{
        target: 'Oggetti/Corno.md',
        title: 'Corno',
        meta: { id: 'corno', kind: 'item', template: 'item', item_type: 'other', provenance: 'master', location: [] },
        parts: [{ file: 'Oggetti/Corno.md', from: 2, to: 2, heading: null, shift: 0 }],
      }],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.masterBlocks, { moved: 0, fixed: 0 });
    assert.ok(draftOf(root, 'Oggetti/Corno.md').endsWith(
      '\nUn corno di bronzo.\n\n<!-- master -->\n## Master\n\n### Indicazioni per il master\n<!-- /master -->\n',
    ), draftOf(root, 'Oggetti/Corno.md'));
  } finally {
    cleanup(root, input);
  }
});

test('item: a master block with moved text keeps the normal layout', () => {
  const { root, input } = setup({ 'Oggetti/Corno.md': '# Corno\nUn corno.\n<!-- master -->\nSegreto.\n<!-- /master -->\n' });
  try {
    const result = applyPlan(root, planFor(input, {
      masterConventions: { 'html-master': 'master' },
      documents: [{
        target: 'Oggetti/Corno.md',
        title: 'Corno',
        meta: { id: 'corno', kind: 'item', template: 'item', item_type: 'other', provenance: 'master', location: [] },
        parts: [{ file: 'Oggetti/Corno.md', from: 2, to: 5, heading: null, shift: 0 }],
      }],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.masterBlocks, { moved: 1, fixed: 1 });
    assert.ok(draftOf(root, 'Oggetti/Corno.md').endsWith(
      '<!-- master -->\n## Master\n\n### Indicazioni per il master\nSegreto.\n<!-- /master -->\n',
    ), draftOf(root, 'Oggetti/Corno.md'));
  } finally {
    cleanup(root, input);
  }
});

function assertPlanError(files, buildPlan, code) {
  const { root, input } = setup(files);
  try {
    const result = applyPlan(root, buildPlan(input));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === code), `expected ${code}, got ${JSON.stringify(result.errors)}`);
    assert.equal(fs.existsSync(path.join(root, '.campaign', 'drafts')), false);
  } finally {
    cleanup(root, input);
  }
}

const aDoc = (overrides = {}) => ({
  target: 'Luoghi/A.md',
  title: 'A',
  meta: { id: 'a', kind: 'place', provenance: 'master' },
  parts: [{ file: 'Luoghi/A.md', from: 4, to: 5, heading: null, shift: 0 }],
  ...overrides,
});

test('plan error: unknown meta key', () => {
  assertPlanError({ 'Luoghi/A.md': BASE_A }, (input) => planFor(input, {
    documents: [aDoc({ meta: { id: 'a', foo: 'x' } })],
  }), 'unknown-key');
});

test('plan error: overlapping parts', () => {
  assertPlanError({ 'Luoghi/F.md': '# F\nTesto.\n' }, (input) => planFor(input, {
    documents: [
      { target: 'Luoghi/X.md', title: 'X', meta: { id: 'x' }, parts: [{ file: 'Luoghi/F.md', from: 1, to: 2, heading: null, shift: 0 }] },
      { target: 'Luoghi/Y.md', title: 'Y', meta: { id: 'y' }, parts: [{ file: 'Luoghi/F.md', from: 2, to: 2, heading: null, shift: 0 }] },
    ],
  }), 'overlap');
});

test('plan error: part over the front-matter', () => {
  assertPlanError({ 'Luoghi/A.md': BASE_A }, (input) => planFor(input, {
    documents: [aDoc({ parts: [{ file: 'Luoghi/A.md', from: 2, to: 5, heading: null, shift: 0 }] })],
  }), 'frontmatter-overlap');
});

test('plan error: missing convention id', () => {
  assertPlanError({ 'Luoghi/D.md': '# D\n> [!secret] x\n' }, (input) => planFor(input, {
    masterConventions: {},
    documents: [{ target: 'Luoghi/D.md', title: 'D', meta: { id: 'd' }, parts: [{ file: 'Luoghi/D.md', from: 1, to: 2, heading: null, shift: 0 }] }],
  }), 'missing-convention');
});

test('plan error: bad target', () => {
  assertPlanError({ 'Luoghi/A.md': BASE_A }, (input) => planFor(input, {
    documents: [aDoc({ target: '../x.md' })],
  }), 'bad-target');
});

test('plan error: duplicate target', () => {
  assertPlanError({ 'Luoghi/F.md': '# F\nTesto.\n', 'Luoghi/G.md': '# G\nTesto.\n' }, (input) => planFor(input, {
    documents: [
      { target: 'Luoghi/Z.md', title: 'Z', meta: { id: 'z1' }, parts: [{ file: 'Luoghi/F.md', from: 1, to: 2, heading: null, shift: 0 }] },
      { target: 'Luoghi/Z.md', title: 'Z', meta: { id: 'z2' }, parts: [{ file: 'Luoghi/G.md', from: 1, to: 2, heading: null, shift: 0 }] },
    ],
  }), 'duplicate-target');
});

test('plan error: duplicate id', () => {
  assertPlanError({ 'Luoghi/F.md': '# F\nTesto.\n', 'Luoghi/G.md': '# G\nTesto.\n' }, (input) => planFor(input, {
    documents: [
      { target: 'Luoghi/Z.md', title: 'Z', meta: { id: 'same' }, parts: [{ file: 'Luoghi/F.md', from: 1, to: 2, heading: null, shift: 0 }] },
      { target: 'Luoghi/W.md', title: 'W', meta: { id: 'same' }, parts: [{ file: 'Luoghi/G.md', from: 1, to: 2, heading: null, shift: 0 }] },
    ],
  }), 'duplicate-id');
});

test('plan error: level-1 heading inside a part with shift 0', () => {
  assertPlanError({ 'Luoghi/E.md': 'Testo\n# Titolo\n' }, (input) => planFor(input, {
    documents: [{ target: 'Luoghi/E.md', title: 'E', meta: { id: 'e' }, parts: [{ file: 'Luoghi/E.md', from: 1, to: 2, heading: null, shift: 0 }] }],
  }), 'bad-heading-level');
});

test('invariant: public text of the drafts equals the expected text of the input', () => {
  const { root, input } = setup({ 'Luoghi/Fenvale.md': '---\ntags: [x]\n---\n# Fenvale\nIl porto è piccolo.\nSecondo [[Fenvale]].\n' });
  try {
    const result = applyPlan(root, planFor(input, {
      documents: [{
        target: 'Luoghi/Fenvale.md',
        title: 'Fenvale',
        meta: { id: 'fenvale', kind: 'place', provenance: 'master' },
        parts: [{ file: 'Luoghi/Fenvale.md', from: 5, to: 6, heading: null, shift: 0 }],
      }],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(publicLines(draftOf(root, 'Luoghi/Fenvale.md')), ['Il porto è piccolo.', 'Secondo Fenvale.']);
  } finally {
    cleanup(root, input);
  }
});

test('validatePlan returns no errors for a valid plan and writes nothing', () => {
  const { root, input } = setup({ 'Luoghi/A.md': BASE_A });
  try {
    const plan = planFor(input, { documents: [aDoc()] });
    assert.deepEqual(validatePlan(root, plan), []);
    assert.equal(fs.existsSync(path.join(root, '.campaign')), false);
  } finally {
    cleanup(root, input);
  }
});

test('CLI: valid plan exits 0 with ok true, bad plan exits 1, missing --plan exits 2', () => {
  const { root, input } = setup({ 'Luoghi/A.md': BASE_A });
  const planDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-apply-plan-'));
  try {
    const good = path.join(planDir, 'good.json');
    fs.writeFileSync(good, JSON.stringify(planFor(input, { documents: [aDoc()] })));
    const ok = spawnSync(process.execPath, [cli, root, '--plan', good], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).ok, true);

    const bad = path.join(planDir, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify(planFor(input, { documents: [aDoc({ target: '../x.md' })] })));
    const fail = spawnSync(process.execPath, [cli, root, '--plan', bad], { encoding: 'utf8' });
    assert.equal(fail.status, 1);
    assert.equal(JSON.parse(fail.stdout).ok, false);

    const usage = spawnSync(process.execPath, [cli, root], { encoding: 'utf8' });
    assert.equal(usage.status, 2);
  } finally {
    cleanup(root, input, planDir);
  }
});

test('spec 7.2: session main stub has no title and no body, meta in 7.2 order', () => {
  const { root, input } = setup({});
  try {
    const result = applyPlan(root, planFor(input, {
      documents: [{
        target: 'Trama/sessione-1/sessione-1.md',
        title: null,
        meta: { id: 'sessione-1', depends_on: [], provenance: 'master' },
        parts: [],
      }],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(
      draftOf(root, 'Trama/sessione-1/sessione-1.md'),
      '<!-- yllir\nid: sessione-1\nprovenance: master\ndepends_on: []\n-->\n',
    );
  } finally {
    cleanup(root, input);
  }
});

test('spec 7.2: event file with null title drops the first H1 and renders the block lists', () => {
  const { root, input } = setup({
    'Trama/sessione-1/Eventi/Avvicinarsi.md': '# Avvicinarsi alla cappella\nTesto dell evento.\n',
  });
  try {
    const result = applyPlan(root, planFor(input, {
      documents: [{
        target: 'Trama/sessione-1/Eventi/Avvicinarsi.md',
        title: null,
        meta: {
          id: 'avvicinarsi-alla-cappella',
          session: 'sessione-1',
          depends_on: ['a'],
          location: ['x'],
          characters: ['c'],
          items: [],
          provenance: 'master',
          appearances: [{ subject: 'c', location: ['x'] }],
          enemies: [{ id: 'e', count: 3 }],
        },
        parts: [{ file: 'Trama/sessione-1/Eventi/Avvicinarsi.md', from: 1, to: 2, heading: null, shift: 0 }],
      }],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(
      draftOf(root, 'Trama/sessione-1/Eventi/Avvicinarsi.md'),
      '<!-- yllir\nid: avvicinarsi-alla-cappella\nsession: sessione-1\nprovenance: master\n'
      + 'location: [x]\ndepends_on: [a]\ncharacters: [c]\nitems: []\n'
      + 'appearances:\n  - subject: c\n    location: [x]\n'
      + 'enemies:\n  - id: e\n    count: 3\n'
      + '-->\n\nTesto dell evento.\n',
    );
  } finally {
    cleanup(root, input);
  }
});

test('spec 7.2: played renders as a flow list, an unlisted key is an unknown-key error', () => {
  const { root, input } = setup({});
  try {
    const result = applyPlan(root, planFor(input, {
      documents: [{
        target: 'Trama/sessione-1/sessione-1.md',
        title: null,
        meta: { id: 'sessione-1', provenance: 'master', played: [] },
        parts: [],
      }],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(
      draftOf(root, 'Trama/sessione-1/sessione-1.md'),
      '<!-- yllir\nid: sessione-1\nprovenance: master\nplayed: []\n-->\n',
    );
  } finally {
    cleanup(root, input);
  }
});

test('spec 7.2: a meta key outside the allowed list is unknown-key, with null title', () => {
  assertPlanError({}, (input) => planFor(input, {
    documents: [{
      target: 'Trama/sessione-1/sessione-1.md',
      title: null,
      meta: { id: 'sessione-1', foo: 'x' },
      parts: [],
    }],
  }), 'unknown-key');
});

test('spec 5.1: the dropped first H1 of the first part is not a level error and is not shifted', () => {
  const file = 'Trama/sessione-1/Eventi/Taverna.md';
  const { root, input } = setup({
    [file]: "# La taverna\nApri la porta.\n## Parlare con l'oste\nL'oste tace.\n### Se chiedono del ponte\nRisponde in fretta.\n",
  });
  try {
    const result = applyPlan(root, planFor(input, {
      documents: [{
        target: file,
        title: null,
        meta: { id: 'la-taverna', session: 'sessione-1', depends_on: [], provenance: 'master' },
        parts: [{ file, from: 1, to: 6, heading: null, shift: 0 }],
      }],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(
      draftOf(root, file),
      "<!-- yllir\nid: la-taverna\nsession: sessione-1\nprovenance: master\ndepends_on: []\n-->\n\n"
      + "Apri la porta.\n## Parlare con l'oste\nL'oste tace.\n### Se chiedono del ponte\nRisponde in fretta.\n",
    );
  } finally {
    cleanup(root, input);
  }
});

test('spec 5.1: a level-1 heading inside a part with shift 0 is still bad-heading-level', () => {
  assertPlanError({
    'Trama/sessione-1/Eventi/Taverna.md': '# La taverna\nTesto.\n# Altro\nTesto due.\n',
  }, (input) => planFor(input, {
    documents: [{
      target: 'Trama/sessione-1/Eventi/Taverna.md',
      title: null,
      meta: { id: 'la-taverna', session: 'sessione-1', depends_on: [], provenance: 'master' },
      parts: [{ file: 'Trama/sessione-1/Eventi/Taverna.md', from: 1, to: 4, heading: null, shift: 0 }],
    }],
  }), 'bad-heading-level');
});

test('master part: public lines 1-3 and 7-9, lines 4-6 go whole to the reserved block under the shared heading', () => {
  const file = 'Trama/sessione-1/Eventi/Scena.md';
  const { root, input } = setup({
    [file]: 'Prima riga.\nSeconda riga.\nTerza riga.\nSegreto uno.\nSegreto due.\nSegreto tre.\nQuarta riga.\nQuinta riga.\nSesta riga.\n',
  });
  try {
    const result = applyPlan(root, planFor(input, {
      documents: [{
        target: file,
        title: null,
        meta: { id: 'scena', session: 'sessione-1', depends_on: [], provenance: 'master' },
        parts: [
          { file, from: 1, to: 3, heading: null, shift: 0 },
          { file, from: 4, to: 6, heading: '## Ignorato', shift: 0, master: true },
          { file, from: 7, to: 9, heading: null, shift: 0 },
        ],
      }],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.uncovered, []);
    assert.deepEqual(result.masterBlocks, { moved: 1, fixed: 0 });
    assert.equal(
      draftOf(root, file),
      '<!-- yllir\nid: scena\nsession: sessione-1\nprovenance: master\ndepends_on: []\n-->\n\n'
      + 'Prima riga.\nSeconda riga.\nTerza riga.\n\nQuarta riga.\nQuinta riga.\nSesta riga.\n'
      + '\n<!-- master -->\n## Master\n\n### Indicazioni per il master\nSegreto uno.\nSegreto due.\nSegreto tre.\n<!-- /master -->\n',
    );
  } finally {
    cleanup(root, input);
  }
});

test('master part: a link to a master-only target stays a link in the reserved block', () => {
  const scene = 'Trama/sessione-1/Eventi/Scena.md';
  const map = 'Giocatori/Mappa.md';
  const { root, input } = setup({
    [scene]: 'Testo pubblico.\nLa [[Mappa]] nasconde il passaggio.\n',
    [map]: '# Mappa\nLa mappa.\n',
  });
  try {
    const result = applyPlan(root, planFor(input, {
      documents: [
        {
          target: scene,
          title: null,
          meta: { id: 'scena', session: 'sessione-1', depends_on: [], provenance: 'master' },
          parts: [
            { file: scene, from: 1, to: 1, heading: null, shift: 0 },
            { file: scene, from: 2, to: 2, heading: null, shift: 0, master: true },
          ],
        },
        {
          target: map,
          title: 'Mappa',
          meta: { id: 'mappa', provenance: 'master' },
          parts: [{ file: map, from: 2, to: 2, heading: null, shift: 0 }],
        },
      ],
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(
      draftOf(root, scene),
      '<!-- yllir\nid: scena\nsession: sessione-1\nprovenance: master\ndepends_on: []\n-->\n\n'
      + 'Testo pubblico.\n\n<!-- master -->\n## Master\n\n### Indicazioni per il master\n'
      + 'La [Mappa](../../../Giocatori/Mappa.md) nasconde il passaggio.\n<!-- /master -->\n',
    );
  } finally {
    cleanup(root, input);
  }
});

test('master part: master true is allowed, master "yes" is bad-plan', () => {
  const file = 'Trama/sessione-1/Eventi/Scena.md';
  assertPlanError({ [file]: 'Uno.\n' }, (input) => planFor(input, {
    documents: [{
      target: file,
      title: null,
      meta: { id: 'scena', session: 'sessione-1', depends_on: [], provenance: 'master' },
      parts: [{ file, from: 1, to: 1, heading: null, shift: 0, master: 'yes' }],
    }],
  }), 'bad-plan');
});
