// Tests of the pure parsing library of the structured convert (vault-parse.mjs).
// Every expected value is written literally from the contract (issue #138, section 2 and 3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  codeMask,
  findLinks,
  findConventions,
  findFeatures,
  headings,
  resolveLink,
} from './vault-parse.mjs';

test('parseFrontmatter: no front-matter gives empty keys and bodyStart 1', () => {
  assert.deepEqual(parseFrontmatter('Testo senza front-matter\n'), { keys: {}, bodyStart: 1 });
});

test('parseFrontmatter: flow list with quotes, bodyStart is the line after the block', () => {
  const text = '---\naliases: [Porto Grigio, "Fenvale Vecchia"]\n---\nCorpo\n';
  assert.deepEqual(parseFrontmatter(text), {
    keys: { aliases: ['Porto Grigio', 'Fenvale Vecchia'] },
    bodyStart: 4,
  });
});

test('parseFrontmatter: scalar value loses its quotes', () => {
  assert.deepEqual(parseFrontmatter('---\ntitle: "Fenvale"\n---\n'), {
    keys: { title: 'Fenvale' },
    bodyStart: 4,
  });
});

test('parseFrontmatter: block list becomes an array, unquoted items', () => {
  const text = '---\ntags:\n  - luogo\n  - "mare nero"\n---\nCorpo';
  assert.deepEqual(parseFrontmatter(text), {
    keys: { tags: ['luogo', 'mare nero'] },
    bodyStart: 6,
  });
});

test('parseFrontmatter: an unclosed block is not front-matter', () => {
  assert.deepEqual(parseFrontmatter('---\ntitle: x\nCorpo'), { keys: {}, bodyStart: 1 });
});

test('codeMask: backtick and tilde fences, both lines included', () => {
  const lines = ['a', '```', 'b', '```', 'c', '~~~', 'd', '~~~'];
  assert.deepEqual(codeMask(lines), [false, true, true, true, false, true, true, true]);
});

test('codeMask: an unclosed fence runs to the last line', () => {
  assert.deepEqual(codeMask(['~~~', 'x']), [true, true]);
});

test('findLinks: wiki links with and without label and anchor', () => {
  const lines = ['Vedi [[A]] e [[B|b]].'];
  assert.deepEqual(findLinks(lines, 7), [
    { line: 7, col: 5, end: 10, raw: '[[A]]', form: 'wiki', target: 'A', anchor: null, label: null, embed: false },
    { line: 7, col: 13, end: 20, raw: '[[B|b]]', form: 'wiki', target: 'B', anchor: null, label: 'b', embed: false },
  ]);
});

test('findLinks: wiki links with anchor, with label and anchor, and self anchor', () => {
  const lines = ['[[A#Sez]]', '[[A#Sez|b]]', '[[#Sez]]'];
  assert.deepEqual(findLinks(lines, 1), [
    { line: 1, col: 0, end: 9, raw: '[[A#Sez]]', form: 'wiki', target: 'A', anchor: 'Sez', label: null, embed: false },
    { line: 2, col: 0, end: 11, raw: '[[A#Sez|b]]', form: 'wiki', target: 'A', anchor: 'Sez', label: 'b', embed: false },
    { line: 3, col: 0, end: 8, raw: '[[#Sez]]', form: 'wiki', target: '', anchor: 'Sez', label: null, embed: false },
  ]);
});

test('findLinks: wiki embeds, the size after the pipe is the label', () => {
  const lines = ['![[img/x.png]]', '![[img/x.png|300]]'];
  assert.deepEqual(findLinks(lines, 1), [
    { line: 1, col: 0, end: 14, raw: '![[img/x.png]]', form: 'wiki', target: 'img/x.png', anchor: null, label: null, embed: true },
    { line: 2, col: 0, end: 18, raw: '![[img/x.png|300]]', form: 'wiki', target: 'img/x.png', anchor: null, label: '300', embed: true },
  ]);
});

test('findLinks: markdown links, percent-decoded, angle brackets, anchors and image embeds', () => {
  const lines = ['[t](a%20b.md)', '[t](../x/y.md#sez)', '[t](<a b.md>)', '![alt](img/p.png)'];
  assert.deepEqual(findLinks(lines, 1), [
    { line: 1, col: 0, end: 13, raw: '[t](a%20b.md)', form: 'markdown', target: 'a b.md', anchor: null, label: 't', embed: false },
    { line: 2, col: 0, end: 18, raw: '[t](../x/y.md#sez)', form: 'markdown', target: '../x/y.md', anchor: 'sez', label: 't', embed: false },
    { line: 3, col: 0, end: 13, raw: '[t](<a b.md>)', form: 'markdown', target: 'a b.md', anchor: null, label: 't', embed: false },
    { line: 4, col: 0, end: 17, raw: '![alt](img/p.png)', form: 'markdown', target: 'img/p.png', anchor: null, label: 'alt', embed: true },
  ]);
});

test('findLinks: external links and same-file anchors are not returned', () => {
  assert.deepEqual(findLinks(['[w](https://x.y)', '[s](#sez)'], 1), []);
});

test('findLinks: a link inside inline code is not returned, the one after it is', () => {
  assert.deepEqual(findLinks(['`[[A]]` e [[B]]'], 1), [
    { line: 1, col: 10, end: 15, raw: '[[B]]', form: 'wiki', target: 'B', anchor: null, label: null, embed: false },
  ]);
});

test('findLinks: a link inside a fence is not returned, the one after it is', () => {
  assert.deepEqual(findLinks(['```', '[[A]]', '```', '[[B]]'], 1), [
    { line: 4, col: 0, end: 5, raw: '[[B]]', form: 'wiki', target: 'B', anchor: null, label: null, embed: false },
  ]);
});

test('findLinks: raw is the exact slice of its line', () => {
  const lines = ['Vedi [[A]] e [[B|b]].', '[t](<a b.md>) ![[img/x.png|300]] [x](y%20z.md#a%20b)'];
  for (const link of findLinks(lines, 1)) {
    assert.equal(link.raw, lines[link.line - 1].slice(link.col, link.end));
  }
});

test('findConventions: html-master, inner lines between the markers', () => {
  const lines = ['<!-- master -->', 'Segreto uno.', '<!-- /master -->'];
  assert.deepEqual(findConventions(lines, 10), [
    { id: 'html-master', start: 10, end: 12, inner: [11, 11], heading: null },
  ]);
});

test('findConventions: heading section runs to the next heading of the same or higher level', () => {
  const lines = ['## Segreti', 'Il re è morto.', '### Dettaglio', 'x', '## Altro'];
  assert.deepEqual(findConventions(lines, 1), [
    { id: 'heading:segreti', start: 1, end: 4, inner: [2, 4], heading: 'Segreti' },
  ]);
});

test('findConventions: a master heading nested inside html-master is not reported again', () => {
  const lines = ['<!-- master -->', '## Master', 'testo', '<!-- /master -->'];
  assert.deepEqual(findConventions(lines, 1), [
    { id: 'html-master', start: 1, end: 4, inner: [2, 3], heading: null },
  ]);
});

test('findConventions: callout runs while the lines start with >', () => {
  const lines = ['> [!secret] Il pozzo', '> dietro la porta.', 'testo'];
  assert.deepEqual(findConventions(lines, 5), [
    { id: 'callout:secret', start: 5, end: 6, inner: [5, 6], heading: null },
  ]);
});

test('findConventions: obsidian comment on one line and across lines', () => {
  assert.deepEqual(findConventions(['Testo %%nota%% fine'], 3), [
    { id: 'obsidian-comment', start: 3, end: 3, inner: [3, 3], heading: null },
  ]);
  assert.deepEqual(findConventions(['%%', 'nota', '%%'], 1), [
    { id: 'obsidian-comment', start: 1, end: 3, inner: [1, 3], heading: null },
  ]);
});

test('findConventions: fence with a master info string, inner lines between the fences', () => {
  assert.deepEqual(findConventions(['```segreto', 'x', '```'], 1), [
    { id: 'fence:segreto', start: 1, end: 3, inner: [2, 2], heading: null },
  ]);
});

test('findConventions: html comment across lines, metadata comment not reported', () => {
  assert.deepEqual(findConventions(['<!--', 'a', '-->'], 1), [
    { id: 'html-comment', start: 1, end: 3, inner: [1, 3], heading: null },
  ]);
  assert.deepEqual(findConventions(['<!-- yllir', 'id: x', '-->'], 1), []);
});

test('findConventions: ordered by start line', () => {
  assert.deepEqual(findConventions(['<!-- c -->', '%%x%%'], 1), [
    { id: 'html-comment', start: 1, end: 1, inner: [1, 1], heading: null },
    { id: 'obsidian-comment', start: 2, end: 2, inner: [2, 2], heading: null },
  ]);
});

test('findFeatures: dataview fence, block reference, tag; heading line holds no tag', () => {
  const lines = ['```dataview', 'LIST', '```', 'Testo ^ancora1', '# Titolo', 'Ecco #rumore e #123', 'x'];
  assert.deepEqual(findFeatures(lines, 1), [
    { id: 'dataview', line: 1 },
    { id: 'block-ref', line: 4 },
    { id: 'tag', line: 6 },
  ]);
});

test('findFeatures: #123 alone is not a tag', () => {
  assert.deepEqual(findFeatures(['Solo #123'], 1), []);
});

test('headings: headings inside fences are ignored', () => {
  assert.deepEqual(headings(['# Titolo', '```', '## Dentro', '```', '## Fuori'], 1), [
    { line: 1, level: 1, text: 'Titolo' },
    { line: 5, level: 2, text: 'Fuori' },
  ]);
});

const ALL = [
  'Luoghi/Fenvale.md',
  'Luoghi/Porto/Selva.md',
  'Ardelmo/Marta.md',
  'Fenvale/Marta.md',
];

test('resolveLink: markdown relative path with ../', () => {
  const link = { form: 'markdown', target: '../Fenvale.md', anchor: null, label: 'f', embed: false };
  assert.deepEqual(resolveLink(link, 'Luoghi/Porto/Selva.md', ALL), {
    path: 'Luoghi/Fenvale.md', status: 'ok', candidates: [],
  });
});

test('resolveLink: markdown without extension resolves to the .md file', () => {
  const link = { form: 'markdown', target: '../Fenvale', anchor: null, label: 'f', embed: false };
  assert.deepEqual(resolveLink(link, 'Luoghi/Porto/Selva.md', ALL), {
    path: 'Luoghi/Fenvale.md', status: 'ok', candidates: [],
  });
});

test('resolveLink: wiki exact path', () => {
  const link = { form: 'wiki', target: 'Luoghi/Fenvale', anchor: null, label: null, embed: false };
  assert.deepEqual(resolveLink(link, 'Note/a.md', ALL), {
    path: 'Luoghi/Fenvale.md', status: 'ok', candidates: [],
  });
});

test('resolveLink: wiki by basename when unique', () => {
  const link = { form: 'wiki', target: 'Selva', anchor: null, label: null, embed: false };
  assert.deepEqual(resolveLink(link, 'Note/a.md', ALL), {
    path: 'Luoghi/Porto/Selva.md', status: 'ok', candidates: [],
  });
});

test('resolveLink: wiki basename ambiguous gives sorted candidates', () => {
  const link = { form: 'wiki', target: 'Marta', anchor: null, label: null, embed: false };
  const unsorted = ['Fenvale/Marta.md', 'Ardelmo/Marta.md'];
  assert.deepEqual(resolveLink(link, 'Note/a.md', unsorted), {
    path: null, status: 'ambiguous', candidates: ['Ardelmo/Marta.md', 'Fenvale/Marta.md'],
  });
});

test('resolveLink: wiki target not found is missing', () => {
  const link = { form: 'wiki', target: 'Nessuno', anchor: null, label: null, embed: false };
  assert.deepEqual(resolveLink(link, 'Note/a.md', ALL), { path: null, status: 'missing', candidates: [] });
});

test('resolveLink: wiki [[#x]] points to the file itself', () => {
  const link = { form: 'wiki', target: '', anchor: 'x', label: null, embed: false };
  assert.deepEqual(resolveLink(link, 'Note/a.md', ALL), { path: 'Note/a.md', status: 'self', candidates: [] });
});

test('resolveLink: wiki folder hint picks the file under that folder', () => {
  const paths = ['Luoghi/Porto/Selva.md', 'Luoghi/Selva.md', 'Luoghi/Sud/Selva.md'];
  const link = { form: 'wiki', target: 'Porto/Selva', anchor: null, label: null, embed: false };
  assert.deepEqual(resolveLink(link, 'Note/a.md', paths), {
    path: 'Luoghi/Porto/Selva.md', status: 'ok', candidates: [],
  });
});

test('resolveLink: wiki basename match is case-insensitive', () => {
  const link = { form: 'wiki', target: 'selva', anchor: null, label: null, embed: false };
  assert.deepEqual(resolveLink(link, 'Note/a.md', ALL), {
    path: 'Luoghi/Porto/Selva.md', status: 'ok', candidates: [],
  });
});
