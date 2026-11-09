import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSubjectIndex } from './subjects.mjs';

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

/** Creates a temporary campaign with the given files (relative path -> content). */
function makeCampaign(files, campaignYaml = CAMPAIGN) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  const all = { 'campaign.yaml': campaignYaml, ...files };
  for (const [rel, content] of Object.entries(all)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function sheet(id, title, extra = '') {
  return `---\nid: ${id}\n${extra}---\n\n# ${title}\n\nTesto.\n`;
}

test('forms come from the title and the aliases, without duplicates', () => {
  const root = makeCampaign({
    'People/Oria.md': sheet('oria-valdes', 'Oria Valdes', 'aliases: [Oria, oria valdes, Nàrem]\n'),
  });
  const { subjects, errors } = buildSubjectIndex(root);
  assert.deepEqual(errors, []);
  assert.equal(subjects.length, 1);
  const [s] = subjects;
  assert.equal(s.id, 'oria-valdes');
  assert.equal(s.category, 'people');
  assert.equal(s.type, 'subjects');
  assert.equal(s.sheet, 'People/Oria.md');
  assert.deepEqual(
    s.forms.map((f) => [f.text, f.folded, f.kind, f.status]),
    [
      ['Oria Valdes', 'oria valdes', 'title', 'fact'],
      ['Oria', 'oria', 'alias', 'fact'],
      ['Nàrem', 'narem', 'alias', 'fact'],
    ],
  );
});

test('a sheet without id is an error and is skipped', () => {
  const root = makeCampaign({ 'People/NoId.md': '# Senza id\n' });
  const { subjects, errors } = buildSubjectIndex(root);
  assert.deepEqual(subjects, []);
  assert.deepEqual(errors, [{ file: 'People/NoId.md', message: 'missing id' }]);
});

test('a sheet without title is an error and is skipped', () => {
  const root = makeCampaign({ 'People/NoTitle.md': '---\nid: x\n---\n\nSolo testo.\n' });
  const { subjects, errors } = buildSubjectIndex(root);
  assert.deepEqual(subjects, []);
  assert.deepEqual(errors, [{ file: 'People/NoTitle.md', message: 'missing title' }]);
});

test('aliases that are not a list are an error, the subject is kept without aliases', () => {
  const root = makeCampaign({
    'People/Bad.md': sheet('bad', 'Bad Name', 'aliases: Ombra\n'),
  });
  const { subjects, errors } = buildSubjectIndex(root);
  assert.deepEqual(errors, [{ file: 'People/Bad.md', message: 'aliases must be a list' }]);
  assert.equal(subjects.length, 1);
  assert.deepEqual(subjects[0].forms.map((f) => f.kind), ['title']);
});

test('duplicate id is an error and the first sheet is kept', () => {
  const root = makeCampaign({
    'People/A.md': sheet('same', 'Primo'),
    'People/B.md': sheet('same', 'Secondo'),
  });
  const { subjects, errors } = buildSubjectIndex(root);
  assert.deepEqual(errors, [
    { file: 'People/B.md', message: 'duplicate id same (also in People/A.md)' },
  ]);
  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].sheet, 'People/A.md');
});

test('homonyms are forms shared by two or more subjects', () => {
  const root = makeCampaign({
    'People/A.md': sheet('lino-a', 'Lino Valdes', 'aliases: [Il Lino]\n'),
    'People/B.md': sheet('lino-b', 'Lino Valdes'),
    'Places/C.md': sheet('lino-c', 'Il Lino Vecchio', 'aliases: [Il Lino]\n'),
  });
  const { homonyms, errors } = buildSubjectIndex(root);
  assert.deepEqual(errors, []);
  assert.deepEqual(homonyms, [
    { folded: 'il lino', subjects: ['lino-a', 'lino-c'] },
    { folded: 'lino valdes', subjects: ['lino-a', 'lino-b'] },
  ]);
});

test('notes and plot categories contain no subjects', () => {
  const root = makeCampaign({
    'Plot/Trama.md': sheet('trama-id', 'Trama'),
    'Notes/Appunti.md': sheet('appunto', 'Appunto'),
  });
  const { subjects, errors } = buildSubjectIndex(root);
  assert.deepEqual(subjects, []);
  assert.deepEqual(errors, []);
});

test('a missing category folder is ignored without error', () => {
  const root = makeCampaign({ 'People/A.md': sheet('a', 'Alfa') });
  const { subjects, errors } = buildSubjectIndex(root);
  assert.equal(subjects.length, 1);
  assert.deepEqual(errors, []);
});

test('img directories are skipped, subdirectories are read recursively', () => {
  const root = makeCampaign({
    'People/img/ritratto.md': sheet('ritratto', 'Ritratto'),
    'People/Sub/Beta.md': sheet('beta', 'Beta'),
  });
  const { subjects } = buildSubjectIndex(root);
  assert.deepEqual(subjects.map((s) => s.id), ['beta']);
  assert.equal(subjects[0].sheet, 'People/Sub/Beta.md');
});

test('output is sorted and identical on every run', () => {
  const root = makeCampaign({
    'People/Z.md': sheet('zeta', 'Zeta'),
    'People/A.md': sheet('alfa', 'Alfa'),
    'Places/M.md': sheet('mu', 'Mu'),
  });
  const first = buildSubjectIndex(root);
  const second = buildSubjectIndex(root);
  assert.deepEqual(first, second);
  assert.deepEqual(first.subjects.map((s) => s.id), ['alfa', 'mu', 'zeta']);
});

test('a missing campaign.yaml is an error with empty lists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  const result = buildSubjectIndex(root);
  assert.deepEqual(result, {
    subjects: [],
    homonyms: [],
    errors: [{ file: 'campaign.yaml', message: 'campaign.yaml not found' }],
  });
});

test('an invalid campaign.yaml is an error with empty lists', () => {
  const root = makeCampaign({}, 'structure:\n\t- id: x\n');
  const result = buildSubjectIndex(root);
  assert.deepEqual(result.subjects, []);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].file, 'campaign.yaml');
});

/** Creates a temporary folder outside any campaign, for symlink targets. */
function makeOutside(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-outside-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

test('a symlink to a regular Markdown file is indexed as a subject under its own path', () => {
  const outside = makeOutside({ 'scheda.md': sheet('linked-sheet', 'Scheda Collegata') });
  try {
    const root = makeCampaign({});
    fs.mkdirSync(path.join(root, 'People'), { recursive: true });
    fs.symlinkSync(path.join(outside, 'scheda.md'), path.join(root, 'People/Collegata.md'));
    const { subjects, errors } = buildSubjectIndex(root);
    assert.deepEqual(errors, []);
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0].id, 'linked-sheet');
    assert.equal(subjects[0].sheet, 'People/Collegata.md');
    assert.equal(subjects[0].forms[0].text, 'Scheda Collegata');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a broken symlink is ignored without error', () => {
  const root = makeCampaign({ 'People/Oria.md': sheet('oria', 'Oria') });
  fs.symlinkSync(path.join(root, 'nowhere.md'), path.join(root, 'People/Rotto.md'));
  const { subjects, errors } = buildSubjectIndex(root);
  assert.deepEqual(errors, []);
  assert.deepEqual(subjects.map((s) => s.id), ['oria']);
});

test('a symlink to a directory is ignored and its contents are not walked', () => {
  const outside = makeOutside({});
  try {
    fs.mkdirSync(path.join(outside, 'Cartella'));
    fs.writeFileSync(path.join(outside, 'Cartella/Dentro.md'), sheet('dentro', 'Dentro'));
    const root = makeCampaign({ 'People/Oria.md': sheet('oria', 'Oria') });
    fs.symlinkSync(path.join(outside, 'Cartella'), path.join(root, 'People/Dir'));
    const { subjects, errors } = buildSubjectIndex(root);
    assert.deepEqual(errors, []);
    assert.deepEqual(subjects.map((s) => s.id), ['oria']);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a symlink loop is ignored without error', () => {
  const root = makeCampaign({ 'People/Oria.md': sheet('oria', 'Oria') });
  fs.symlinkSync(path.join(root, 'People/Loop.md'), path.join(root, 'People/Loop.md'));
  const { subjects, errors } = buildSubjectIndex(root);
  assert.deepEqual(errors, []);
  assert.deepEqual(subjects.map((s) => s.id), ['oria']);
});
