import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireSources, renderCard } from './ingest-acquire.mjs';
import { buildInventory, sha256Buffer } from './ingest-inventory.mjs';
import { METADATA_OPEN, parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: fonti',
  '    folder: Fonti',
  '    type: sources',
  '',
].join('\n');

function withEnv(fn, campaignYaml = CAMPAIGN) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-ingest-acq-'));
  try {
    const root = path.join(base, 'campaign');
    const inputs = path.join(base, 'inputs');
    fs.mkdirSync(root);
    fs.mkdirSync(inputs);
    fs.writeFileSync(path.join(root, 'campaign.yaml'), campaignYaml);
    return fn({ base, root, inputs });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const ARGS = { provenance: 'Quaderno del master', date: '2026-11-09' };

test('normal case: original copied byte for byte, card and transcription skeletons written', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'Photo.JPG'), 'photo bytes');
    const inventory = buildInventory({ campaignRoot: root, inputs: ['Photo.JPG'], baseDir: inputs });
    const id = inventory.files[0].id;
    const sha = sha256Buffer(Buffer.from('photo bytes'));

    const result = acquireSources({ campaignRoot: root, inventory, ...ARGS, baseDir: inputs });
    assert.deepEqual(result, { acquired: [id], skipped: [], errors: [] });

    const dir = path.join(root, 'Fonti', id);
    assert.equal(fs.readFileSync(path.join(dir, 'original.jpg'), 'utf8'), 'photo bytes');
    assert.equal(fs.readFileSync(path.join(inputs, 'Photo.JPG'), 'utf8'), 'photo bytes');
    assert.equal(fs.existsSync(path.join(dir, 'Photo.JPG')), false);

    const card = parseFrontmatter(fs.readFileSync(path.join(dir, 'card.md'), 'utf8'));
    assert.deepEqual(card.errors, []);
    assert.deepEqual(card.data, {
      id,
      original: 'original.jpg',
      original_name: 'Photo.JPG',
      sha256: sha,
      acquired: '2026-11-09',
      provenance: 'Quaderno del master',
      kind: 'other',
      pages: '0',
      status: 'acquired',
    });
    assert.match(card.body, /^# Acquisition src-/m);
    assert.match(card.body, /## Claims\n\n## Open questions\n\n## Review/);

    assert.equal(
      fs.readFileSync(path.join(dir, 'transcription.md'), 'utf8'),
      `# Transcription ${id}\n\n`,
    );
  });
});

test('kind is recorded when given', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'sheet.png'), 'pc sheet');
    const inventory = buildInventory({ campaignRoot: root, inputs: ['sheet.png'], baseDir: inputs });
    acquireSources({ campaignRoot: root, inventory, ...ARGS, kind: 'pc-sheet', baseDir: inputs });
    const card = parseFrontmatter(fs.readFileSync(path.join(root, 'Fonti', inventory.files[0].id, 'card.md'), 'utf8'));
    assert.equal(card.data.kind, 'pc-sheet');
  });
});

test('idempotence: a second run with the same inventory skips and changes nothing', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'photo.jpg'), 'again');
    const inventory = buildInventory({ campaignRoot: root, inputs: ['photo.jpg'], baseDir: inputs });
    const id = inventory.files[0].id;
    acquireSources({ campaignRoot: root, inventory, ...ARGS, baseDir: inputs });
    const cardBefore = fs.readFileSync(path.join(root, 'Fonti', id, 'card.md'), 'utf8');

    const second = acquireSources({ campaignRoot: root, inventory, ...ARGS, baseDir: inputs });
    assert.deepEqual(second, { acquired: [], skipped: [id], errors: [] });
    assert.equal(fs.readFileSync(path.join(root, 'Fonti', id, 'card.md'), 'utf8'), cardBefore);

    const again = buildInventory({ campaignRoot: root, inputs: ['photo.jpg'], baseDir: inputs });
    assert.equal(again.files[0].status, 'duplicate-acquired');
  });
});

test('no sources category: nothing is acquired and the error is returned', () => {
  const noSources = 'name: Test\nstructure:\n  - id: trama\n    folder: Trama\n    type: plot\n';
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'photo.jpg'), 'x');
    const inventory = buildInventory({ campaignRoot: root, inputs: ['photo.jpg'], baseDir: inputs });
    const result = acquireSources({ campaignRoot: root, inventory, ...ARGS, baseDir: inputs });
    assert.deepEqual(result, { acquired: [], skipped: [], errors: ['no category of type sources'] });
    assert.equal(fs.existsSync(path.join(root, 'Fonti')), false);
  }, noSources);
});

test('an inventory with errors acquires nothing', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'ok.jpg'), 'ok');
    const inventory = buildInventory({ campaignRoot: root, inputs: ['missing.jpg', 'ok.jpg'], baseDir: inputs });
    const result = acquireSources({ campaignRoot: root, inventory, ...ARGS, baseDir: inputs });
    assert.equal(result.acquired.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(fs.existsSync(path.join(root, 'Fonti')), false);
  });
});

test('an existing folder with another sha256 is an error and is not overwritten', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'photo.jpg'), 'fresh');
    const inventory = buildInventory({ campaignRoot: root, inputs: ['photo.jpg'], baseDir: inputs });
    const id = inventory.files[0].id;
    const card = `---\nid: ${id}\nsha256: ${'3'.repeat(64)}\n---\n`;
    write(path.join(root, 'Fonti', id, 'card.md'), card);
    const result = acquireSources({ campaignRoot: root, inventory, ...ARGS, baseDir: inputs });
    assert.equal(result.acquired.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /id collision/);
    assert.equal(fs.readFileSync(path.join(root, 'Fonti', id, 'card.md'), 'utf8'), card);
    assert.equal(fs.existsSync(path.join(root, 'Fonti', id, 'original.jpg')), false);
  });
});

test('an input changed after the inventory is an error and its folder is removed', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'photo.jpg'), 'before');
    const inventory = buildInventory({ campaignRoot: root, inputs: ['photo.jpg'], baseDir: inputs });
    write(path.join(inputs, 'photo.jpg'), 'after the inventory');
    const result = acquireSources({ campaignRoot: root, inventory, ...ARGS, baseDir: inputs });
    assert.equal(result.acquired.length, 0);
    assert.match(result.errors[0], /original changed since inventory/);
    assert.equal(fs.existsSync(path.join(root, 'Fonti', inventory.files[0].id)), false);
  });
});

test('usage problems are thrown: empty provenance, quotes, bad date, bad kind', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'photo.jpg'), 'x');
    const inventory = buildInventory({ campaignRoot: root, inputs: ['photo.jpg'], baseDir: inputs });
    const call = (over) =>
      acquireSources({ campaignRoot: root, inventory, provenance: 'ok', date: '2026-11-09', baseDir: inputs, ...over });
    assert.throws(() => call({ provenance: '  ' }), /provenance must not be empty/);
    assert.throws(() => call({ provenance: 'say "hi"' }), /double quotes/);
    assert.throws(() => call({ date: '2026-02-30' }), /real date/);
    assert.throws(() => call({ date: '09/11/2026' }), /real date/);
    assert.throws(() => call({ kind: 'map' }), /bad kind: map/);
    assert.equal(fs.existsSync(path.join(root, 'Fonti')), false);
  });
});

test('renderCard quotes names that a plain scalar cannot hold, and refuses unrecordable ones', () => {
  const base = { id: 'src-1a2b3c4d', original: 'original.jpg', sha256: '0'.repeat(64), date: '2026-11-09', provenance: 'p', kind: 'other' };
  const plain = parseFrontmatter(renderCard({ ...base, originalName: 'quaderno 1.jpg' }));
  assert.equal(plain.data.original_name, 'quaderno 1.jpg');
  const bracket = parseFrontmatter(renderCard({ ...base, originalName: '[scan].jpg' }));
  assert.deepEqual(bracket.errors, []);
  assert.equal(bracket.data.original_name, '[scan].jpg');
  assert.throws(() => renderCard({ ...base, originalName: 'bad"name.jpg' }), /cannot record file name/);
  assert.throws(() => renderCard({ ...base, originalName: 'bad-->name.jpg' }), /cannot record file name/);
});

test('renderCard writes the comment form and parses back to the same data', () => {
  const input = {
    id: 'src-1a2b3c4d',
    original: 'original.jpg',
    originalName: 'Quaderno 1.jpg',
    sha256: '0'.repeat(64),
    date: '2026-11-09',
    provenance: 'Quaderno del master',
    kind: 'other',
  };
  const text = renderCard(input);
  assert.equal(text.split('\n')[0], METADATA_OPEN);
  assert.equal(text.includes('---'), false);

  const parsed = parseFrontmatter(text);
  assert.equal(parsed.format, 'comment');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.data, {
    id: 'src-1a2b3c4d',
    original: 'original.jpg',
    original_name: 'Quaderno 1.jpg',
    sha256: '0'.repeat(64),
    acquired: '2026-11-09',
    provenance: 'Quaderno del master',
    kind: 'other',
    pages: '0',
    status: 'acquired',
  });
  assert.equal(parsed.body.trimStart().startsWith('# Acquisition src-1a2b3c4d'), true);
});

test('provenance and file names that would close the comment block are refused', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'photo.jpg'), 'x');
    const inventory = buildInventory({ campaignRoot: root, inputs: ['photo.jpg'], baseDir: inputs });
    assert.throws(
      () => acquireSources({ campaignRoot: root, inventory, ...ARGS, provenance: 'fine --> not', baseDir: inputs }),
      /-->/,
    );
    assert.equal(fs.existsSync(path.join(root, 'Fonti')), false);
  });
});
