// Tests of the structure report (issue #138): walk and exclusions, front-matter, links, conventions,
// hints, images, determinism and the CLI. Builds small input folders in the OS temp directory.
// The two testbench fixtures are checked when present (skipped otherwise).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildReport, buildSurvey } from './convert-structure.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../convert-structure.mjs');
const FIXTURES = path.resolve(HERE, '../../../../../testbench/fixtures');
const OBSIDIAN_FIXTURE = path.join(FIXTURES, 'convert-obsidian-input');
const LINKED_FIXTURE = path.join(FIXTURES, 'convert-linked-input');

/** Writes a folder with the given relative paths and contents, and returns its absolute path. */
function makeFolder(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-structure-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

function fileOf(report, rel) {
  const file = report.files.find((f) => f.path === rel);
  assert.ok(file, `no file ${rel} in the report`);
  return file;
}

test('tool folders, canvas files and other types are excluded and not read', () => {
  const dir = makeFolder({
    '.obsidian/app.json': '{}',
    'Note/a.md': '# A\n',
    'scene.canvas': '{}',
    'doc.pdf': 'pdf',
    'img/x.png': 'png',
  });
  const report = buildReport(dir);
  assert.deepEqual(report.excluded, [
    { path: '.obsidian/', reason: 'tool-folder' },
    { path: 'doc.pdf', reason: 'other-type' },
    { path: 'scene.canvas', reason: 'canvas' },
  ]);
  assert.deepEqual(report.files.map((f) => f.path), ['Note/a.md']);
  assert.deepEqual(report.images.map((i) => i.path), ['img/x.png']);
});

test('front-matter keys are kept, counted and the body start is right', () => {
  const dir = makeFolder({
    'Luoghi/Fenvale.md': [
      '---',
      'aliases: [Porto Grigio, "Fenvale"]',
      'tags:',
      '  - luogo',
      '  - citta',
      '---',
      '# Fenvale',
      '',
    ].join('\n'),
    'Note/b.md': '---\ntags: [luogo]\n---\nTesto\n',
    'Note/c.md': 'Solo testo\n',
  });
  const report = buildReport(dir);
  const fenvale = fileOf(report, 'Luoghi/Fenvale.md');
  assert.equal(fenvale.bodyStart, 7);
  assert.deepEqual(fenvale.frontmatter, { aliases: ['Porto Grigio', 'Fenvale'], tags: ['luogo', 'citta'] });
  assert.deepEqual(fenvale.headings, [{ line: 7, level: 1, text: 'Fenvale' }]);
  assert.equal(fileOf(report, 'Note/b.md').bodyStart, 4);
  assert.equal(fileOf(report, 'Note/c.md').bodyStart, 1);
  assert.deepEqual(report.frontmatterKeys, { aliases: 1, tags: 2 });
});

test('links are counted per kind, missing and ambiguous ones listed, linksOut and linksIn right', () => {
  const dir = makeFolder({
    'Gilda.md': '# Gilda\n\nVedi [[b]].\n',
    'Note/a.md': '# Note\nVedi [[Gilda]] e [[Gilda|la gilda]] e [[Nessuno]].\n',
    'Note/b.md': '# B\nVedi [Gilda](../Gilda.md), [[a]] e [[Gilda#Testo]].\n',
    'Note/c.md': '# C\nVedi [[Marta]].\n',
    'Fenvale/Marta.md': '# Marta\n',
    'Ardelmo/Marta.md': '# Marta\n',
  });
  const report = buildReport(dir);
  assert.deepEqual(report.links.count, { markdown: 1, wiki: 5, 'wiki-label': 1, 'wiki-anchor': 1, embed: 0 });
  assert.deepEqual(report.links.missing, [{ file: 'Note/a.md', line: 2, raw: '[[Nessuno]]' }]);
  assert.deepEqual(report.links.ambiguous, [
    {
      file: 'Note/c.md',
      line: 2,
      raw: '[[Marta]]',
      candidates: ['Ardelmo/Marta.md', 'Fenvale/Marta.md'],
    },
  ]);
  assert.equal(fileOf(report, 'Gilda.md').linksOut, 1);
  assert.equal(fileOf(report, 'Gilda.md').linksIn, 4);
  assert.equal(fileOf(report, 'Note/a.md').linksOut, 2);
  assert.equal(fileOf(report, 'Note/a.md').linksIn, 1);
  assert.equal(fileOf(report, 'Note/b.md').linksOut, 3);
  assert.equal(fileOf(report, 'Note/b.md').linksIn, 1);
  assert.equal(fileOf(report, 'Note/c.md').linksOut, 0);
  assert.equal(fileOf(report, 'Note/c.md').linksIn, 0);
});

test('conventions are summed per id with at most 2 examples cut to 80 characters', () => {
  const dir = makeFolder({
    'Luoghi/Fenvale.md': [
      '# Fenvale',
      `> [!secret] ${'x'.repeat(100)}`,
      '> ancora',
      'Testo pubblico.',
      '<!-- master -->',
      'Note per il master.',
      '<!-- /master -->',
      '',
    ].join('\n'),
    'Note/b.md': '# B\n> [!secret] breve\n<!-- master -->\nAltro\n<!-- /master -->\n',
    'Note/c.md': '# C\n> [!secret] terzo\n',
  });
  const report = buildReport(dir);
  assert.deepEqual(report.conventions, [
    {
      id: 'callout:secret',
      files: 3,
      examples: [
        { file: 'Luoghi/Fenvale.md', line: 2, text: `> [!secret] ${'x'.repeat(68)}` },
        { file: 'Note/b.md', line: 2, text: '> [!secret] breve' },
      ],
    },
    {
      id: 'html-master',
      files: 2,
      examples: [
        { file: 'Luoghi/Fenvale.md', line: 5, text: '<!-- master -->' },
        { file: 'Note/b.md', line: 3, text: '<!-- master -->' },
      ],
    },
  ]);
  assert.equal(report.conventions[0].examples[0].text.length, 80);
});

test('hints: index, daily, todo, multi-subject, long and session', () => {
  const dir = makeFolder({
    'Indice.md': '# Indice\n\n- [[Fenvale]]\n- [[Gilda]]\n- [[Marta]]\n- [[Note/a]]\n- [[Note/b]]\n',
    'Diario/2026-09-12.md': '# Diario\n\nOggi.\n',
    'Da fare/Idee.md': '# Idee\n\nQualcosa\n',
    'Campagna/Multi.md': '# Uno\n\n# Due\n\n## A\n',
    'Campagna/Sezioni.md': '# Uno\n\n## A\n\n## B\n\n## C\n',
    'Lungo.md': Array.from({ length: 301 }, () => 'riga').join('\n'),
    'Sessioni/S1.md': '# S1\n',
  });
  const report = buildReport(dir);
  assert.deepEqual(fileOf(report, 'Indice.md').hints, ['index']);
  assert.deepEqual(fileOf(report, 'Diario/2026-09-12.md').hints, ['daily']);
  assert.deepEqual(fileOf(report, 'Da fare/Idee.md').hints, ['todo']);
  assert.deepEqual(fileOf(report, 'Campagna/Multi.md').hints, ['multi-subject']);
  assert.deepEqual(fileOf(report, 'Campagna/Sezioni.md').hints, []);
  assert.deepEqual(fileOf(report, 'Lungo.md').hints, ['long']);
  assert.deepEqual(fileOf(report, 'Sessioni/S1.md').hints, ['session']);
});

test('images list the Markdown files that embed them, and never appear in files', () => {
  const dir = makeFolder({
    'Luoghi/Fenvale.md': '# Fenvale\n\n![[fenvale.png]]\n',
    'Note/a.md': '# A\n\n![x](../img/fenvale.png)\n',
    'img/fenvale.png': 'png',
    'img/unused.jpg': 'jpg',
  });
  const report = buildReport(dir);
  assert.deepEqual(report.images, [
    { path: 'img/fenvale.png', embeddedBy: ['Luoghi/Fenvale.md', 'Note/a.md'] },
    { path: 'img/unused.jpg', embeddedBy: [] },
  ]);
  assert.equal(report.links.count.embed, 2);
  assert.ok(report.files.every((f) => f.type === 'markdown' && !f.path.endsWith('.png')));
});

test('the same folder gives the same report, and the CLI writes it and prints its line', () => {
  const dir = makeFolder({
    'A.md': '# A\n[[B]]\n',
    'B/b.md': '# B\n',
    'img/x.png': 'png',
    '.obsidian/app.json': '{}',
  });
  assert.equal(JSON.stringify(buildReport(dir)), JSON.stringify(buildReport(dir)));

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-structure-out-'));
  const outFile = path.join(outDir, 'report.json');
  const result = spawnSync(process.execPath, [CLI, dir, '--out', outFile], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.split('\n')[0],
    'files: 3, markdown: 2, images: 1, excluded: 1, conventions: 0, missing-links: 0',
  );
  const written = fs.readFileSync(outFile, 'utf8');
  assert.equal(written, `${JSON.stringify(buildReport(dir), null, 2)}\n`);
});

test('the CLI exits 2 on a missing input or a usage error', () => {
  const dir = makeFolder({ 'A.md': '# A\n' });
  const outFile = path.join(dir, '..', `yllir-structure-missing-${process.pid}.json`);
  const missing = spawnSync(process.execPath, [CLI, path.join(dir, 'nope'), '--out', outFile], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.notEqual(missing.stderr, '');
  const usage = spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});

test('the survey counts each file in its depth 1 and depth 2 folders, with the first 3 samples', () => {
  const dir = makeFolder({
    'Root.md': '# Root\n',
    'A/x.md': '# X\nuno\n',
    'A/B/y.md': '# Y\nuno\ndue\n',
    'A/B/z.md': '# Z\n> [!secret] segreto\n',
    'A/B/2026-09-12.md': '# D\n',
  });
  assert.deepEqual(buildSurvey(buildReport(dir)), {
    folders: [
      { path: '', files: 1, lines: 1, hints: {}, conventions: {}, samples: ['Root'] },
      {
        path: 'A',
        files: 4,
        lines: 8,
        hints: { daily: 1 },
        conventions: { 'callout:secret': 1 },
        samples: ['2026-09-12', 'y', 'z'],
      },
      {
        path: 'A/B',
        files: 3,
        lines: 6,
        hints: { daily: 1 },
        conventions: { 'callout:secret': 1 },
        samples: ['2026-09-12', 'y', 'z'],
      },
    ],
    conventions: { 'callout:secret': 1 },
    links: { missing: 0, ambiguous: 0 },
  });
});

test('the CLI writes the survey with --survey, and only then', () => {
  const dir = makeFolder({ 'Root.md': '# Root\n', 'A/x.md': '# X\n' });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-structure-survey-'));
  const outFile = path.join(outDir, 'report.json');
  const surveyFile = path.join(outDir, 'survey.json');
  const result = spawnSync(process.execPath, [CLI, dir, '--out', outFile, '--survey', surveyFile], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.split('\n')[0],
    'files: 2, markdown: 2, images: 0, excluded: 0, conventions: 0, missing-links: 0',
  );
  assert.equal(
    fs.readFileSync(surveyFile, 'utf8'),
    `${JSON.stringify(buildSurvey(buildReport(dir)), null, 2)}\n`,
  );

  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-structure-plain-'));
  const plainOut = path.join(plainDir, 'plain.json');
  const plain = spawnSync(process.execPath, [CLI, dir, '--out', plainOut], { encoding: 'utf8' });
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, result.stdout);
  assert.deepEqual(fs.readdirSync(plainDir), ['plain.json']);
  const dangling = spawnSync(process.execPath, [CLI, dir, '--out', plainOut, '--survey'], { encoding: 'utf8' });
  assert.equal(dangling.status, 2);
});

test('the obsidian fixture is reported with its traps', (t) => {
  if (!fs.existsSync(OBSIDIAN_FIXTURE)) {
    t.skip('testbench/fixtures/convert-obsidian-input is not present');
    return;
  }
  const report = buildReport(OBSIDIAN_FIXTURE);
  assert.ok(report.excluded.some((e) => e.path === '.obsidian/'));
  assert.ok(report.links.missing.length >= 1);
  assert.ok(report.links.ambiguous.length >= 1);
  const ids = report.conventions.map((c) => c.id);
  assert.ok(ids.includes('callout:secret'));
  assert.ok(ids.includes('obsidian-comment'));
  assert.ok(fileOf(report, 'Indice personaggi.md').hints.includes('index'));
});

test('the linked fixture is reported with its conventions and a long file', (t) => {
  if (!fs.existsSync(LINKED_FIXTURE)) {
    t.skip('testbench/fixtures/convert-linked-input is not present');
    return;
  }
  const report = buildReport(LINKED_FIXTURE);
  const ids = report.conventions.map((c) => c.id);
  assert.ok(ids.includes('html-master'));
  assert.ok(ids.includes('heading:segreti'));
  assert.ok(ids.includes('fence:segreto'));
  assert.ok(report.files.some((f) => f.hints.includes('long')));
  assert.ok(!fileOf(report, 'Gente/Ilde.md').hints.includes('multi-subject'));
});
