import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeScope } from './audit-scope.mjs';

const CLI = path.resolve(import.meta.dirname, '../audit-scope.mjs');

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

function subject(id, title) {
  return `---\nid: ${id}\n---\n\n# ${title}\n\nUn testo.\n`;
}

const FILES = {
  'campaign.yaml': CAMPAIGN,
  'People/Oria Valdes.md': subject('oria-valdes', 'Oria Valdes'),
  'Objects/Lanterna di Morvalle.md': subject('lanterna', 'Lanterna di Morvalle'),
  'Places/Borgo.md': subject('borgo', 'Borgo'),
  'Plot/Trama.md': '# Trama\n\nOria Valdes prende la Lanterna di Morvalle.\n',
  'Plot/Altro.md': '# Altro\n\nNiente di noto qui.\n',
  'Notes/Appunti.md': '# Appunti\n\nIdea su Oria Valdes.\n',
  'Plot/Villaggio.md': '# Villaggio\n\nVicino al borgo.\n',
  'Bozze/Nuovo.md': '# Nuovo\n\nTesto fuori dalle cartelle.\n',
};

/** Writes a temporary campaign, computes the scope, and removes the folder. */
function scope(options, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  try {
    for (const [rel, content] of Object.entries({ ...FILES, ...files })) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return computeScope(root, options);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const documentsOf = (result) => result.files.map((f) => f.document);

test('full mode includes the notes folders and every subject', () => {
  const result = scope({ mode: 'full' });
  assert.ok(documentsOf(result).includes('Notes/Appunti.md'));
  assert.ok(documentsOf(result).includes('Plot/Trama.md'));
  assert.deepEqual(result.subjects, ['borgo', 'lanterna', 'oria-valdes']);
  assert.deepEqual(result.errors, []);
});

test('pre mode from a file: its mentions, their sheets, and every file that cites them', () => {
  const result = scope({ mode: 'pre', files: ['Plot/Trama.md'] });
  assert.deepEqual(result.subjects, ['lanterna', 'oria-valdes']);
  assert.deepEqual(documentsOf(result), [
    'Notes/Appunti.md',
    'Objects/Lanterna di Morvalle.md',
    'People/Oria Valdes.md',
    'Plot/Trama.md',
  ]);
  assert.deepEqual(result.errors, []);
});

test('pre mode from subjects: their sheets and the files that cite them', () => {
  const result = scope({ mode: 'pre', subjects: ['oria-valdes'] });
  assert.deepEqual(result.subjects, ['oria-valdes']);
  assert.deepEqual(documentsOf(result), [
    'Notes/Appunti.md',
    'People/Oria Valdes.md',
    'Plot/Trama.md',
  ]);
});

test('pre mode includes a given file that is outside every category', () => {
  const result = scope({ mode: 'pre', files: ['Bozze/Nuovo.md'] });
  assert.deepEqual(documentsOf(result), ['Bozze/Nuovo.md']);
  assert.deepEqual(result.subjects, []);
});

test('a missing given file is an error and is not in the scope', () => {
  const result = scope({ mode: 'pre', files: ['Plot/Fantasma.md', 'Plot/Altro.md'] });
  assert.deepEqual(result.errors, [{ file: 'Plot/Fantasma.md', message: 'file not found' }]);
  assert.deepEqual(documentsOf(result), ['Plot/Altro.md']);
});

test('a file outside the campaign is an error', () => {
  const result = scope({ mode: 'pre', files: ['../segreto.md'] });
  assert.deepEqual(result.errors, [{ file: '../segreto.md', message: 'file outside campaign' }]);
  assert.deepEqual(result.files, []);
});

test('an index error is reported in the scope errors', () => {
  const result = scope({ mode: 'full' }, { 'People/Senza id.md': '# Senza id\n\nTesto.\n' });
  assert.deepEqual(result.errors, [{ file: 'People/Senza id.md', message: 'missing id' }]);
});

test('fids are D001, D002, ... in path order and the output is deterministic', () => {
  const first = scope({ mode: 'pre', files: ['Plot/Trama.md'] });
  const second = scope({ mode: 'pre', files: ['Plot/Trama.md'] });
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.files.map((f) => f.fid),
    ['D001', 'D002', 'D003', 'D004'],
  );
});

test('unknown mode is rejected', () => {
  assert.throws(() => scope({ mode: 'post' }), /unknown mode: post/);
});

/** Writes the campaign FILES into a new temporary folder and returns its path. */
function campaignFolder(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-reset-'));
  for (const [rel, content] of Object.entries({ ...FILES, ...extra })) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

test('--reset deletes the audit state, recreates facts, and keeps the rest of .campaign', () => {
  const root = campaignFolder({
    '.campaign/state/audit/facts/old.json': '{}',
    '.campaign/state/audit/scope.json': '{}',
    '.campaign/state/other.md': 'stato',
    '.campaign/cache/keep.txt': 'cache',
  });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-reset-out-'));
  try {
    const result = spawnSync(process.execPath, [CLI, root, '--mode', 'full', '--out', path.join(out, 'scope.json'), '--reset'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(root, '.campaign/state/audit/facts/old.json')), false);
    assert.equal(fs.existsSync(path.join(root, '.campaign/state/audit/scope.json')), false);
    assert.ok(fs.statSync(path.join(root, '.campaign/state/audit/facts')).isDirectory());
    assert.deepEqual(fs.readdirSync(path.join(root, '.campaign/state/audit/facts')), []);
    assert.equal(fs.readFileSync(path.join(root, '.campaign/state/other.md'), 'utf8'), 'stato');
    assert.equal(fs.readFileSync(path.join(root, '.campaign/cache/keep.txt'), 'utf8'), 'cache');
    assert.ok(fs.existsSync(path.join(out, 'scope.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('--reset without campaign.yaml exits 2 and deletes nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-reset-'));
  try {
    fs.mkdirSync(path.join(root, '.campaign/state/audit/facts'), { recursive: true });
    fs.writeFileSync(path.join(root, '.campaign/state/audit/facts/old.json'), '{}');
    const result = spawnSync(process.execPath, [CLI, root, '--mode', 'full', '--out', path.join(root, 'x/scope.json'), '--reset'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /campaign\.yaml/);
    assert.equal(fs.readFileSync(path.join(root, '.campaign/state/audit/facts/old.json'), 'utf8'), '{}');
    assert.equal(fs.existsSync(path.join(root, 'x')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const CAMPAIGN_EXTERNAL = CAMPAIGN + '  - id: ext\n    folder: External\n    type: external\n';

/**
 * Like `scope`, with an external category: `External` is a symlink to a folder
 * outside the campaign that holds one document without frontmatter.
 */
function externalScope(options, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-ext-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'Pagina.md'), '# Pagina\n\nTesto esterno.\n');
    for (const [rel, content] of Object.entries({ ...FILES, 'campaign.yaml': CAMPAIGN_EXTERNAL, ...files })) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    fs.symlinkSync(outside, path.join(root, 'External'), 'dir');
    return computeScope(root, options);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

const externalFlags = (result) => result.files.filter((f) => f.external).map((f) => f.document);

test('full mode includes external subjects and reads their sheets as read-only documents', () => {
  const result = externalScope({ mode: 'full' });
  assert.deepEqual(result.subjects, ['borgo', 'ext:Pagina', 'lanterna', 'oria-valdes']);
  assert.deepEqual(externalFlags(result), ['External/Pagina.md']);
  assert.ok(result.files.find((f) => f.document === 'Plot/Trama.md').external === false);
  assert.deepEqual(result.errors, []);
});

test('full mode output is deterministic and external documents keep their fid order', () => {
  const first = externalScope({ mode: 'full' });
  const second = externalScope({ mode: 'full' });
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.files.map((f) => f.document),
    [
      'External/Pagina.md',
      'Notes/Appunti.md',
      'Objects/Lanterna di Morvalle.md',
      'People/Oria Valdes.md',
      'Places/Borgo.md',
      'Plot/Altro.md',
      'Plot/Trama.md',
      'Plot/Villaggio.md',
    ],
  );
});

test('pre mode rejects a given file of an external category as not to be modified', () => {
  const result = externalScope({ mode: 'pre', files: ['External/Pagina.md', 'Plot/Altro.md'] });
  assert.deepEqual(result.errors, [{ file: 'External/Pagina.md', message: 'external file: not to be modified' }]);
  assert.deepEqual(documentsOf(result), ['Plot/Altro.md']);
  assert.deepEqual(result.subjects, []);
});

test('pre mode: a file that mentions an external subject pulls its sheet in as a read-only document', () => {
  const result = externalScope({ mode: 'pre', files: ['Plot/Citazione.md'] }, {
    'Plot/Citazione.md': '# Citazione\n\nCome dice Pagina nel testo esterno.\n',
  });
  assert.deepEqual(result.subjects, ['ext:Pagina']);
  assert.deepEqual(documentsOf(result), ['External/Pagina.md', 'Plot/Citazione.md']);
  assert.deepEqual(externalFlags(result), ['External/Pagina.md']);
  assert.deepEqual(result.errors, []);
});

test('pre mode keeps external ids given in subjects and reads their sheets', () => {
  const result = externalScope({ mode: 'pre', subjects: ['ext:Pagina', 'oria-valdes'] });
  assert.deepEqual(result.subjects, ['ext:Pagina', 'oria-valdes']);
  assert.deepEqual(documentsOf(result), ['External/Pagina.md', 'Notes/Appunti.md', 'People/Oria Valdes.md', 'Plot/Trama.md']);
  assert.deepEqual(externalFlags(result), ['External/Pagina.md']);
  assert.deepEqual(result.errors, []);
});

test('pre mode: an external sheet is read once even when several files mention its subject', () => {
  const result = externalScope({ mode: 'pre', files: ['Plot/Trama.md', 'Plot/Citazione.md'] }, {
    'Plot/Citazione.md': '# Citazione\n\nCome dice Pagina.\n',
  });
  assert.equal(result.files.filter((f) => f.document === 'External/Pagina.md').length, 1);
  assert.deepEqual(result.errors, []);
});
