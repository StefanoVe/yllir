import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSubjectIndex } from './subjects.mjs';
import { scanMentions } from './mentions.mjs';

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: people',
  '    folder: People',
  '    type: subjects',
  '  - id: objects',
  '    folder: Objects',
  '    type: objects',
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

function subject(id, title, aliases = []) {
  const aliasLine = aliases.length > 0 ? `aliases: [${aliases.join(', ')}]\n` : '';
  return `---\nid: ${id}\n${aliasLine}---\n\n# ${title}\n\nUn testo.\n`;
}

const BASE_FILES = {
  'People/Oria Valdes.md': subject('oria-valdes', 'Oria Valdes'),
  'Places/Morvalle.md': subject('morvalle', 'Morvalle'),
  'Objects/Lanterna di Morvalle.md': subject('lanterna', 'Lanterna di Morvalle'),
};

/** Builds a temporary campaign, runs the index and the scan, and removes the folder. */
function scan(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  try {
    const all = { 'campaign.yaml': CAMPAIGN, ...BASE_FILES, ...files };
    for (const [rel, content] of Object.entries(all)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    const index = buildSubjectIndex(root);
    const result = scanMentions(root, index);
    return { index, result };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function inFile(result, file) {
  return result.occurrences.filter((o) => o.file === file);
}

test('rule 1: heading gives excluded-title', () => {
  const { result } = scan({ 'Plot/Trama.md': '# Trama\n\n## Oria Valdes\n' });
  const [occ] = inFile(result, 'Plot/Trama.md');
  assert.equal(occ.state, 'excluded-title');
  assert.equal(occ.subject, 'oria-valdes');
  assert.equal(occ.line, 3);
});

test('rule 2: code block gives excluded-code', () => {
  const { result } = scan({ 'Plot/Codice.md': 'Testo.\n\n```\nOria Valdes\n```\n' });
  const [occ] = inFile(result, 'Plot/Codice.md');
  assert.equal(occ.state, 'excluded-code');
  assert.equal(occ.line, 4);
});

test('rule 3: mermaid block gives excluded-diagram', () => {
  const { result } = scan({
    'Plot/Mer.md': '```mermaid\nflowchart TD\nOria Valdes\n```\n',
  });
  const [occ] = inFile(result, 'Plot/Mer.md');
  assert.equal(occ.state, 'excluded-diagram');
  assert.equal(occ.line, 3);
  assert.equal(Object.hasOwn(occ, 'reason'), false);
});

test('rule 4: comment block gives excluded-comment', () => {
  const { result } = scan({ 'Plot/Com.md': '<!-- Oria Valdes -->\n' });
  const [occ] = inFile(result, 'Plot/Com.md');
  assert.equal(occ.state, 'excluded-comment');
});

test('table cell mention is bare, like a paragraph mention', () => {
  const { result } = scan({
    'Plot/Tab.md': '| Nome | Ruolo |\n|---|---|\n| Oria Valdes | guida |\n',
  });
  const [occ] = inFile(result, 'Plot/Tab.md');
  assert.equal(occ.state, 'bare');
  assert.equal(occ.subject, 'oria-valdes');
  assert.equal(occ.line, 3);
  assert.equal(occ.col, 3);
  assert.equal(Object.hasOwn(occ, 'reason'), false);
});

test('table cell mention inside a link to its sheet is linked', () => {
  const { result } = scan({
    'Places/Tab.md': '| Nome | Ruolo |\n|---|---|\n| [Oria Valdes](../People/Oria%20Valdes.md) | guida |\n',
  });
  const [occ] = inFile(result, 'Places/Tab.md');
  assert.equal(occ.state, 'linked');
  assert.equal(occ.subject, 'oria-valdes');
  assert.equal(occ.line, 3);
});

test('rule 6: inline code, inline comment and image spans are excluded', () => {
  const { result } = scan({
    'Plot/Span.md': 'Usa `Oria Valdes` qui.\nTesto <!-- Oria Valdes --> fine.\n![Oria Valdes](img/oria.png)\n',
  });
  const states = inFile(result, 'Plot/Span.md').map((o) => [o.line, o.state]);
  assert.deepEqual(states, [
    [1, 'excluded-code'],
    [2, 'excluded-comment'],
    [3, 'excluded-image'],
  ]);
});

test('rule 6: link label gives linked or linked-elsewhere, link target is dropped', () => {
  const { result } = scan({
    'Places/Villaggio.md':
      'Vedi [Oria Valdes](../People/Oria%20Valdes.md).\n' +
      'Vedi [Oria Valdes](../Plot/Trama.md).\n' +
      'Vedi [qui](People/Oria Valdes.md).\n',
  });
  const occ = inFile(result, 'Places/Villaggio.md');
  assert.equal(occ.length, 2, 'the match inside the target is not an occurrence');
  assert.equal(occ[0].line, 1);
  assert.equal(occ[0].state, 'linked');
  assert.equal(occ[1].line, 2);
  assert.equal(occ[1].state, 'linked-elsewhere');
  assert.equal(occ[1].link_target, 'Plot/Trama.md');
});

test('rule 7: narrative italic paragraph gives excluded-italic', () => {
  const { result } = scan({ 'Plot/Ital.md': '_Oria Valdes cammina nella cenere._\n' });
  const [occ] = inFile(result, 'Plot/Ital.md');
  assert.equal(occ.state, 'excluded-italic');
});

test('rule 8: the subject own sheet gives self', () => {
  const { result } = scan({
    'People/Oria Valdes.md': '---\nid: oria-valdes\n---\n\n# Oria Valdes\n\nOria Valdes e\' qui.\n',
  });
  const own = inFile(result, 'People/Oria Valdes.md');
  assert.deepEqual(
    own.map((o) => [o.line, o.state]),
    [
      [5, 'excluded-title'],
      [7, 'self'],
    ],
  );
});

test('rule 9: homonyms give one ambiguous occurrence with candidates', () => {
  const { result } = scan({
    'People/Lino A.md': subject('lino-a', 'Lino Valdes'),
    'People/Lino B.md': subject('lino-b', 'Lino Valdes'),
    'Plot/Inc.md': 'Incontro con Lino Valdes oggi.\n',
  });
  const [occ] = inFile(result, 'Plot/Inc.md');
  assert.equal(occ.state, 'ambiguous');
  assert.equal(occ.subject, null);
  assert.equal(occ.form, null);
  assert.deepEqual(occ.candidates, ['lino-a', 'lino-b']);
});

test('rule 10: an alias that is a word inside another subject form is ambiguous', () => {
  const { result } = scan({
    'People/Oria Brunel.md': subject('oria-brunel', 'Oria Brunel', ['Oria']),
    'Plot/Alias.md': 'Oria arriva al borgo.\n',
  });
  const [occ] = inFile(result, 'Plot/Alias.md');
  assert.equal(occ.state, 'ambiguous');
  assert.equal(occ.subject, 'oria-brunel');
  assert.deepEqual(occ.candidates, ['oria-brunel', 'oria-valdes']);
});

test('rule 11: otherwise the mention is bare', () => {
  const { result } = scan({ 'Plot/Bare.md': 'Siamo a Morvalle.\n' });
  const [occ] = inFile(result, 'Plot/Bare.md');
  assert.equal(occ.state, 'bare');
  assert.equal(occ.subject, 'morvalle');
  assert.equal(occ.form, 'Morvalle');
  assert.equal(occ.text, 'Morvalle');
  assert.equal(occ.col, 9);
});

test('longest match wins: Lanterna di Morvalle is not Morvalle', () => {
  const { result } = scan({ 'Plot/Lun.md': 'Prende la Lanterna di Morvalle.\n' });
  const occ = inFile(result, 'Plot/Lun.md');
  assert.equal(occ.length, 1);
  assert.equal(occ[0].subject, 'lanterna');
  assert.equal(occ[0].text, 'Lanterna di Morvalle');
  assert.equal(occ[0].col, 11);
});

test('accent-insensitive match', () => {
  const { result } = scan({
    'Places/Pozzo.md': subject('pozzo', 'Pozzo di Nàrem'),
    'Plot/Acc.md': 'Al Pozzo di Narem.\nAl Pozzo di Nàrem.\n',
  });
  const occ = inFile(result, 'Plot/Acc.md');
  assert.deepEqual(
    occ.map((o) => [o.subject, o.text, o.state]),
    [
      ['pozzo', 'Pozzo di Narem', 'bare'],
      ['pozzo', 'Pozzo di Nàrem', 'bare'],
    ],
  );
});

test('apostrophe-insensitive match', () => {
  const { result } = scan({
    'Places/Torre.md': subject('torre', 'Torre dell’Ascia'),
    'Plot/Apo.md': "Verso la torre dell'Ascia.\n",
  });
  const [occ] = inFile(result, 'Plot/Apo.md');
  assert.equal(occ.subject, 'torre');
  assert.equal(occ.text, "torre dell'Ascia");
});

test('word boundary: Oria does not match inside Oriana', () => {
  const { result } = scan({
    'Places/Oria.md': subject('oria', 'Oria'),
    'Plot/Bnd.md': 'Oriana sorride.\nOria sorride.\n',
  });
  const occ = inFile(result, 'Plot/Bnd.md');
  assert.equal(occ.length, 1);
  assert.equal(occ[0].subject, 'oria');
  assert.equal(occ[0].line, 2);
});

test('three mentions in one line are all reported', () => {
  const { result } = scan({
    'Plot/Tre.md': 'Oria Valdes, Morvalle e la Lanterna di Morvalle.\n',
  });
  const occ = inFile(result, 'Plot/Tre.md');
  assert.equal(occ.length, 3);
  assert.deepEqual(
    occ.map((o) => o.subject),
    ['oria-valdes', 'morvalle', 'lanterna'],
  );
  assert.ok(occ.every((o) => o.state === 'bare' && o.in_master === false));
});

test('in_master is true inside the master block', () => {
  const { result } = scan({
    'Plot/Master.md': '<!-- master -->\n## Master\nOria Valdes e\' il traitore.\n<!-- /master -->\n',
  });
  const [occ] = inFile(result, 'Plot/Master.md');
  assert.equal(occ.line, 3);
  assert.equal(occ.in_master, true);
  assert.equal(occ.state, 'bare');
});

test('line and col are correct with frontmatter present', () => {
  const { result } = scan({
    'Plot/Front.md': '---\nid: front\nnote: Oria Valdes\n---\nPrimo.\nCiao Oria Valdes.\n',
  });
  const occ = inFile(result, 'Plot/Front.md');
  assert.equal(occ.length, 1, 'frontmatter lines are never scanned');
  assert.equal(occ[0].line, 6);
  assert.equal(occ[0].col, 6);
});

test('notes folder is not scanned', () => {
  const { result } = scan({ 'Notes/Appunti.md': 'Oria Valdes\n' });
  assert.equal(result.files.includes('Notes/Appunti.md'), false);
  assert.equal(inFile(result, 'Notes/Appunti.md').length, 0);
  assert.ok(result.files.includes('People/Oria Valdes.md'));
});

test('files lists subject folders and plot folders, sorted', () => {
  const { result } = scan({ 'Plot/Bare.md': 'Ciao.\n' });
  assert.deepEqual(result.files, [...result.files].sort());
  assert.ok(result.files.includes('People/Oria Valdes.md'));
  assert.ok(result.files.includes('Places/Morvalle.md'));
  assert.ok(result.files.includes('Plot/Bare.md'));
});

test('summary has every state, with zero when absent', () => {
  const { result } = scan({ 'Plot/Bare.md': 'Siamo a Morvalle.\n' });
  assert.deepEqual(Object.keys(result.summary).sort(), [
    'ambiguous',
    'bare',
    'excluded-code',
    'excluded-comment',
    'excluded-diagram',
    'excluded-image',
    'excluded-italic',
    'excluded-title',
    'linked',
    'linked-elsewhere',
    'self',
  ]);
  assert.equal(result.summary.linked, 0);
  assert.ok(result.summary.bare >= 1);
});
