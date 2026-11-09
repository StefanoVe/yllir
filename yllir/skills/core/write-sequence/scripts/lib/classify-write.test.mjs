import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyWrite, THRESHOLDS } from './classify-write.mjs';

const CAMPAIGN = [
  'name: Test',
  'language:',
  '  main: it',
  'structure:',
  '  - id: personaggi',
  '    folder: Personaggi',
  '    type: subjects',
  '  - id: luoghi',
  '    folder: Luoghi',
  '    type: places',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '  - id: segreti',
  '    folder: Segreti',
  '    type: master-only',
  '',
].join('\n');

/** A Markdown document: optional frontmatter, a level-1 title and body lines. */
function doc(frontmatter, title, body) {
  const fm = frontmatter === null ? '' : `---\n${frontmatter.join('\n')}\n---\n\n`;
  return `${fm}# ${title}\n\n${body.join('\n')}\n`;
}

function npcFront(id) {
  return [`id: ${id}`, 'template: npc', 'location: []'];
}

function placeFront(id) {
  return [`id: ${id}`, 'template: place', 'location: []'];
}

/** A new character sheet of exactly 10 non-blank lines (5 frontmatter, 1 title, 4 body). */
const LIRA_SHEET = doc(npcFront('lira-quen'), 'Lira Quen', [
  '## Ruolo',
  'Mercante di sale.',
  '## Aspetto',
  'Capelli grigi.',
]);

const PORTO_LINES = Array.from({ length: 12 }, (_, i) => `Riga numero ${i + 1} del porto.`);
const PORTO = doc(placeFront('porto-nero'), 'Porto Nero', PORTO_LINES);

function writeTree(base, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(base, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

/**
 * Writes a temporary workspace: `campaign/` holds the campaign, `drafts/` the
 * drafts (another folder inside the same temporary root). Removed afterwards.
 */
function withWorkspace(campaignFiles, draftFiles, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-classify-'));
  try {
    const campaign = path.join(tmp, 'campaign');
    const drafts = path.join(tmp, 'drafts');
    writeTree(campaign, { 'campaign.yaml': CAMPAIGN, ...campaignFiles });
    writeTree(drafts, draftFiles);
    return fn({ campaign, drafts, tmp });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function measure(result, name) {
  return result.measures.find((m) => m.name === name);
}

test('a new isolated character sheet of 10 lines is low', () => {
  withWorkspace(
    { 'Luoghi/Porto.md': PORTO },
    { 'Personaggi/Lira Quen.md': LIRA_SHEET },
    ({ campaign, drafts }) => {
      const result = classifyWrite(campaign, {
        files: ['Personaggi/Lira Quen.md'],
        draftDir: drafts,
      });
      assert.equal(result.level, 'low');
      assert.deepEqual(measure(result, 'size'), { name: 'size', value: 10, level: 'low' });
      assert.deepEqual(measure(result, 'breadth'), { name: 'breadth', value: '1+0', level: 'low' });
      assert.deepEqual(result.reach, []);
    },
  );
});

test('a typo (one line changed) in an existing place nobody mentions is low', () => {
  const typo = doc(
    placeFront('porto-nero'),
    'Porto Nero',
    PORTO_LINES.map((line, i) => (i === 3 ? 'Riga numero 4 del porto' : line)),
  );
  withWorkspace(
    { 'Luoghi/Porto.md': PORTO },
    { 'Luoghi/Porto.md': typo },
    ({ campaign, drafts }) => {
      const result = classifyWrite(campaign, { files: ['Luoghi/Porto.md'], draftDir: drafts });
      // One line removed and one added: 2 changed lines out of 18 non-blank.
      assert.deepEqual(measure(result, 'size'), { name: 'size', value: 2, level: 'low' });
      assert.equal(result.level, 'low');
      assert.deepEqual(result.reach, []);
    },
  );
});

test('a new sheet whose title appears in another document is at least medium and reach lists it', () => {
  const plot = doc(null, 'Il Patto', ['Lira Quen firma il patto con il re.']);
  withWorkspace(
    { 'Trama/Il Patto.md': plot },
    { 'Personaggi/Lira Quen.md': LIRA_SHEET },
    ({ campaign, drafts }) => {
      const result = classifyWrite(campaign, {
        files: ['Personaggi/Lira Quen.md'],
        draftDir: drafts,
      });
      assert.equal(result.level, 'medium');
      assert.deepEqual(result.reach, ['Trama/Il Patto.md']);
      assert.deepEqual(measure(result, 'reach'), { name: 'reach', value: 1, level: 'medium' });
    },
  );
});

test('a new sheet whose title partially matches an existing subject is high by homonym', () => {
  const existing = doc(npcFront('oria-valdes'), 'Oria Valdes', ['## Ruolo', 'Fabbra.']);
  const minore = doc(npcFront('oria-valdes-minore'), 'Oria Valdes Minore', ['## Ruolo', 'Apprendista.']);
  withWorkspace(
    { 'Personaggi/Oria Valdes.md': existing },
    { 'Personaggi/Oria Valdes Minore.md': minore },
    ({ campaign, drafts }) => {
      const result = classifyWrite(campaign, {
        files: ['Personaggi/Oria Valdes Minore.md'],
        draftDir: drafts,
      });
      assert.deepEqual(measure(result, 'homonym'), { name: 'homonym', value: '1 matches', level: 'high' });
      assert.equal(result.level, 'high');
      assert.ok(result.decidedBy.includes('homonym'));
    },
  );
});

test('a draft in the Trama folder is high by content', () => {
  const ritorno = doc(null, 'Il Ritorno', ['Il re torna.']);
  withWorkspace({}, { 'Trama/Il Ritorno.md': ritorno }, ({ campaign, drafts }) => {
    const result = classifyWrite(campaign, { files: ['Trama/Il Ritorno.md'], draftDir: drafts });
    assert.equal(result.level, 'high');
    assert.deepEqual(measure(result, 'content'), { name: 'content', value: 'plot', level: 'high' });
    assert.ok(result.decidedBy.includes('content'));
  });
});

test('an existing document with 40 changed lines is high by size', () => {
  const oldLines = Array.from({ length: 60 }, (_, i) => `Riga numero ${i + 1} del porto.`);
  const oldText = doc(placeFront('porto-nero'), 'Porto Nero', oldLines);
  const newText = doc(
    placeFront('porto-nero'),
    'Porto Nero',
    oldLines.map((line, i) => (i < 20 ? `Nuova riga numero ${i + 1} del porto.` : line)),
  );
  withWorkspace(
    { 'Luoghi/Porto.md': oldText },
    { 'Luoghi/Porto.md': newText },
    ({ campaign, drafts }) => {
      const result = classifyWrite(campaign, { files: ['Luoghi/Porto.md'], draftDir: drafts });
      assert.deepEqual(measure(result, 'size'), { name: 'size', value: 40, level: 'high' });
      assert.equal(result.level, 'high');
      assert.ok(result.decidedBy.includes('size'));
    },
  );
});

test('a missing draft is high by draft', () => {
  withWorkspace({}, {}, ({ campaign, drafts }) => {
    const result = classifyWrite(campaign, { files: ['Personaggi/Nessuno.md'], draftDir: drafts });
    assert.equal(result.level, 'high');
    assert.deepEqual(measure(result, 'draft'), {
      name: 'draft',
      value: 'missing: Personaggi/Nessuno.md',
      level: 'high',
    });
    assert.ok(result.decidedBy.includes('draft'));
  });
});

test('five documents are high by breadth', () => {
  const titles = ['Alfa Uno', 'Beta Due', 'Gamma Tre', 'Delta Quattro', 'Epsilon Cinque'];
  const drafts = {};
  for (const title of titles) drafts[`Personaggi/${title}.md`] = doc(null, title, ['Testo.']);
  withWorkspace({}, drafts, ({ campaign, drafts: draftDir }) => {
    const result = classifyWrite(campaign, {
      files: titles.map((t) => `Personaggi/${t}.md`),
      draftDir,
    });
    assert.deepEqual(measure(result, 'breadth'), { name: 'breadth', value: '5+0', level: 'high' });
    assert.equal(result.level, 'high');
  });
});

test('a draft with a master block is medium by privacy', () => {
  const secret = doc(npcFront('lira-quen'), 'Lira Quen', ['## Segreto', '<!-- master -->', 'Il re e un impostore.']);
  withWorkspace({}, { 'Personaggi/Lira Quen.md': secret }, ({ campaign, drafts }) => {
    const result = classifyWrite(campaign, { files: ['Personaggi/Lira Quen.md'], draftDir: drafts });
    assert.deepEqual(measure(result, 'privacy'), { name: 'privacy', value: 'masterblock', level: 'medium' });
    assert.equal(result.level, 'medium');
    assert.deepEqual(result.decidedBy, ['privacy']);
  });
});

test('a draft in a master-only folder is high by privacy', () => {
  const piano = doc(null, 'Piano Segreto', ['Il piano del re.']);
  withWorkspace({}, { 'Segreti/Piano.md': piano }, ({ campaign, drafts }) => {
    const result = classifyWrite(campaign, { files: ['Segreti/Piano.md'], draftDir: drafts });
    assert.deepEqual(measure(result, 'privacy'), { name: 'privacy', value: 'masteronly', level: 'high' });
    assert.equal(result.level, 'high');
  });
});

test('the level is the maximum of the measures and decidedBy lists the ones that reach it', () => {
  const plot = doc(null, 'Il Patto', ['Lira Quen firma il patto con il re.']);
  withWorkspace(
    { 'Trama/Il Patto.md': plot },
    { 'Personaggi/Lira Quen.md': LIRA_SHEET },
    ({ campaign, drafts }) => {
      const result = classifyWrite(campaign, { files: ['Personaggi/Lira Quen.md'], draftDir: drafts });
      const levels = { low: 0, medium: 1, high: 2 };
      const top = Math.max(...result.measures.map((m) => levels[m.level]));
      const expected = Object.keys(levels).find((k) => levels[k] === top);
      assert.equal(result.level, expected);
      assert.deepEqual(
        result.decidedBy,
        result.measures.filter((m) => m.level === result.level).map((m) => m.name),
      );
      assert.deepEqual(result.decidedBy, ['reach']);
    },
  );
});

test('odd inputs never throw: invalid paths, missing drafts and a missing campaign', () => {
  withWorkspace({}, {}, ({ tmp }) => {
    const result = classifyWrite(path.join(tmp, 'nope'), {
      files: ['../escape.md', '/absolute.md', 'Nope.md', ''],
      draftDir: path.join(tmp, 'no-drafts'),
      subjects: null,
    });
    assert.equal(result.level, 'high');
    assert.equal(result.measures.length, 7);
    const draft = measure(result, 'draft');
    assert.match(draft.value, /invalid: \.\.\/escape\.md/);
    assert.match(draft.value, /missing: Nope\.md/);
  });

  assert.doesNotThrow(() => classifyWrite('/does/not/exist', {}));
});

test('thresholds are exported as numbers', () => {
  assert.equal(THRESHOLDS.size.newLow, 40);
  assert.equal(THRESHOLDS.size.existingLowChanged, 6);
  assert.equal(THRESHOLDS.reach.mediumMax, 3);
});
