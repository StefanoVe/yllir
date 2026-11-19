import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { foldForm } from './fold.mjs';
import { findShortNames, findShortNamesInFiles } from './short-names.mjs';

/** A subject as buildSubjectIndex describes it: title first, then aliases, with folded forms. */
function subject(id, title, aliases = []) {
  const texts = [[title, 'title'], ...aliases.map((alias) => [alias, 'alias'])];
  return {
    id,
    forms: texts.map(([text, kind]) => ({ text, folded: foldForm(text), kind, status: 'fact' })),
  };
}

const INDEX = {
  subjects: [
    subject('teodo-marr', 'Teodo Marr'),
    subject('teodo-vosk', 'Teodo Vosk'),
    subject('borgo-cenere', 'Borgo Cenere'),
    subject('cenere', 'Cenere'),
    subject('ada-lo', 'Ada Lo'),
    subject('oria-valdes', 'Oria Valdes', ['Oria']),
  ],
};

test('reports "Teodo" when the subject "Teodo Marr" exists', () => {
  const found = findShortNames('# Locanda\n\nOggi Teodo entra nella locanda.\n', INDEX);
  assert.deepEqual(found, [
    {
      line: 3,
      text: 'Oggi Teodo entra nella locanda.',
      word: 'Teodo',
      subjects: [
        { id: 'teodo-marr', title: 'Teodo Marr' },
        { id: 'teodo-vosk', title: 'Teodo Vosk' },
      ],
    },
  ]);
});

test('does not report the full name "Teodo Marr"', () => {
  assert.deepEqual(findShortNames('Oggi Teodo Marr entra.\n', { subjects: [INDEX.subjects[0]] }), []);
});

test('does not report a word at the start of a sentence, a line or a list item', () => {
  const index = { subjects: [INDEX.subjects[0]] };
  const text = [
    'Teodo entra.',
    'Ieri sera. Teodo entra.',
    'Ieri sera! Teodo entra.',
    'Ieri sera? Teodo entra.',
    '- Teodo entra.',
    '_Teodo entra._',
    '"Teodo entra."',
    'Ha detto: Teodo entra.',
  ].join('\n');
  assert.deepEqual(findShortNames(text, index), []);
});

test('a capitalised word after a sentence end is reported only when it is not the first word', () => {
  const index = { subjects: [INDEX.subjects[0]] };
  assert.equal(findShortNames('Ieri.Teodo entra.\n', index).length, 1);
  assert.equal(findShortNames('Entra Teodo.\n', index).length, 1);
});

test('does not report a word that is a complete form of another subject', () => {
  // "Cenere" alone is a real mention of the subject "Cenere"; the "Cenere" inside "Borgo Cenere" is covered.
  assert.deepEqual(findShortNames('Il Borgo Cenere e poi Cenere.\n', INDEX), []);
});

test('does not report the word "Borgo" of the full form "Borgo Cenere" when it is written in full', () => {
  assert.deepEqual(findShortNames('Torniamo al Borgo Cenere.\n', INDEX), []);
});

test('does not report the self subject', () => {
  const found = findShortNames('Oggi Teodo torna.\n', INDEX, { selfId: 'teodo-marr' });
  assert.deepEqual(found, [
    {
      line: 1,
      text: 'Oggi Teodo torna.',
      word: 'Teodo',
      subjects: [{ id: 'teodo-vosk', title: 'Teodo Vosk' }],
    },
  ]);
});

test('reports inside the master block', () => {
  const text = [
    '# Scena',
    '',
    '<!-- master -->',
    '## Master',
    '',
    'Il Teodo sa il segreto.',
    '<!-- /master -->',
    '',
  ].join('\n');
  const found = findShortNames(text, { subjects: [INDEX.subjects[0]] });
  assert.deepEqual(found.map((hit) => [hit.line, hit.word]), [[6, 'Teodo']]);
});

test('ignores headings and inline code', () => {
  const index = { subjects: [INDEX.subjects[0]] };
  assert.deepEqual(findShortNames('## Il viaggio di Teodo\n', index), []);
  assert.deepEqual(findShortNames('# Teodo\n', index), []);
  assert.deepEqual(findShortNames('Il comando `Teodo` non conta.\n', index), []);
});

test('ignores a word with fewer than 3 letters', () => {
  assert.deepEqual(findShortNames('Oggi Lo sale.\n', { subjects: [INDEX.subjects[4]] }), []);
  assert.equal(findShortNames('Oggi Ada sale.\n', { subjects: [INDEX.subjects[4]] }).length, 1);
});

test('two subjects sharing a word are both listed', () => {
  const [hit] = findShortNames('Oggi Teodo entra.\n', INDEX);
  assert.deepEqual(hit.subjects.map((s) => s.id), ['teodo-marr', 'teodo-vosk']);
});

test('a lowercase word is not reported', () => {
  assert.deepEqual(findShortNames('Oggi teodo entra.\n', { subjects: [INDEX.subjects[0]] }), []);
});

test('an alias form counts as a complete form', () => {
  // "Oria" is an alias of the subject, so it is a real mention and not an abbreviation.
  assert.deepEqual(findShortNames('Oggi Oria entra.\n', INDEX), []);
});

test('findShortNamesInFiles reads each file, takes selfId from its frontmatter and sorts by file and line', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-short-'));
  try {
    const files = {
      'Luoghi/Locanda.md': '---\nid: ada-lo\n---\n\n# Locanda\n\nOggi Ada sale.\n\nOggi Teodo entra.\n',
      'Personaggi/Teodo.md': '---\nid: teodo-marr\n---\n\n# Teodo Marr\n\nOggi Teodo esce.\n',
    };
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    const index = {
      subjects: [INDEX.subjects[0], INDEX.subjects[4]],
    };
    const found = findShortNamesInFiles(root, index, ['Personaggi/Teodo.md', 'Luoghi/Locanda.md']);
    // Locanda.md is the subject "Ada Lo" (its "Ada" is self); Teodo.md is the subject "Teodo Marr" (its "Teodo" is self).
    assert.deepEqual(
      found.map((hit) => [hit.file, hit.line, hit.word, hit.subjects.map((s) => s.id)]),
      [['Luoghi/Locanda.md', 9, 'Teodo', ['teodo-marr']]],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findShortNamesInFiles uses readText when given and skips self subjects', () => {
  const texts = {
    'a.md': '---\nid: teodo-marr\n---\n\n# Teodo Marr\n\nOggi Teodo esce.\n',
    'b.md': 'Oggi Teodo entra.\n',
  };
  const found = findShortNamesInFiles('/unused', { subjects: [INDEX.subjects[0]] }, ['a.md', 'b.md'], {
    readText: (rel) => texts[rel],
  });
  assert.deepEqual(found.map((hit) => [hit.file, hit.line, hit.word]), [['b.md', 1, 'Teodo']]);
});
