import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildInventory, sha256Buffer } from './ingest-inventory.mjs';

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: fonti',
  '    folder: Fonti',
  '    type: sources',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '',
].join('\n');

/** Runs `fn` on a temporary campaign root and an inputs folder outside it. */
function withEnv(fn, campaignYaml = CAMPAIGN) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-ingest-inv-'));
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

/** Creates an acquisition folder whose card records `sha256`. */
function recordAcquired(root, id, sha256) {
  write(path.join(root, 'Fonti', id, 'card.md'), `---\nid: ${id}\nsha256: ${sha256}\n---\n`);
}

test('normal case: relative and absolute inputs are hashed, ids derived, nothing written', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'photo.jpg'), 'photo bytes');
    write(path.join(inputs, 'notes.txt'), 'some notes');
    const before = fs.readdirSync(root).sort();

    const inv = buildInventory({ campaignRoot: root, inputs: ['photo.jpg'], baseDir: inputs });
    const sha = sha256Buffer(Buffer.from('photo bytes'));

    assert.equal(inv.sources_folder, 'Fonti');
    assert.deepEqual(inv.errors, []);
    assert.deepEqual(inv.files, [
      {
        input: 'photo.jpg',
        name: 'photo.jpg',
        ext: '.jpg',
        size: 11,
        sha256: sha,
        id: `src-${sha.slice(0, 8)}`,
        status: 'new',
        duplicate_of: null,
      },
    ]);
    assert.deepEqual(fs.readdirSync(root).sort(), before);

    const abs = buildInventory({ campaignRoot: root, inputs: [path.join(inputs, 'notes.txt')], baseDir: root });
    assert.equal(abs.files[0].name, 'notes.txt');
    assert.equal(abs.files[0].status, 'new');
  });
});

test('same call gives the same output', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'a.jpg'), 'aaa');
    write(path.join(inputs, 'b.jpg'), 'bbb');
    const first = buildInventory({ campaignRoot: root, inputs: ['a.jpg', 'b.jpg'], baseDir: inputs });
    const second = buildInventory({ campaignRoot: root, inputs: ['a.jpg', 'b.jpg'], baseDir: inputs });
    assert.deepEqual(first, second);
  });
});

test('a folder expands to its files, sorted, dotfiles skipped', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'scans', 'b.txt'), 'bee');
    write(path.join(inputs, 'scans', 'a', 'c.txt'), 'cee');
    write(path.join(inputs, 'scans', '.hidden'), 'secret');
    const inv = buildInventory({ campaignRoot: root, inputs: ['scans'], baseDir: inputs });
    assert.deepEqual(
      inv.files.map((file) => file.input),
      [path.join('scans', 'a', 'c.txt'), path.join('scans', 'b.txt')],
    );
    assert.deepEqual(inv.errors, []);
  });
});

test('duplicate-input: a second file with the same bytes in the same call', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'x.jpg'), 'same');
    write(path.join(inputs, 'y.jpg'), 'same');
    const inv = buildInventory({ campaignRoot: root, inputs: ['x.jpg', 'y.jpg'], baseDir: inputs });
    assert.equal(inv.files[0].status, 'new');
    assert.equal(inv.files[1].status, 'duplicate-input');
    assert.equal(inv.files[1].duplicate_of, 'x.jpg');
    assert.equal(inv.files[1].id, inv.files[0].id);
  });
});

test('duplicate-acquired: the folder already holds the same original', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'x.jpg'), 'kept');
    const sha = sha256Buffer(Buffer.from('kept'));
    const id = `src-${sha.slice(0, 8)}`;
    recordAcquired(root, id, sha);
    const inv = buildInventory({ campaignRoot: root, inputs: ['x.jpg'], baseDir: inputs });
    assert.equal(inv.files[0].status, 'duplicate-acquired');
    assert.equal(inv.files[0].duplicate_of, id);
    assert.deepEqual(inv.errors, []);
  });
});

test('id collision: a folder with the same id but another sha256 is an error', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'x.jpg'), 'collide');
    const sha = sha256Buffer(Buffer.from('collide'));
    const id = `src-${sha.slice(0, 8)}`;
    recordAcquired(root, id, '2'.repeat(64));
    const inv = buildInventory({ campaignRoot: root, inputs: ['x.jpg'], baseDir: inputs });
    assert.equal(inv.files.length, 0);
    assert.equal(inv.errors.length, 1);
    assert.match(inv.errors[0], /id collision/);
  });
});

test('no category of type sources is an error', () => {
  const noSources = [
    'name: Test',
    'structure:',
    '  - id: trama',
    '    folder: Trama',
    '    type: plot',
    '',
  ].join('\n');
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'x.jpg'), 'x');
    const inv = buildInventory({ campaignRoot: root, inputs: ['x.jpg'], baseDir: inputs });
    assert.equal(inv.sources_folder, null);
    assert.deepEqual(inv.files, []);
    assert.deepEqual(inv.errors, ['no category of type sources']);
  }, noSources);
});

test('an unreadable input is an error and is left out of the files', () => {
  withEnv(({ root, inputs }) => {
    write(path.join(inputs, 'ok.jpg'), 'ok');
    const inv = buildInventory({ campaignRoot: root, inputs: ['missing.jpg', 'ok.jpg'], baseDir: inputs });
    assert.equal(inv.errors.length, 1);
    assert.match(inv.errors[0], /cannot read missing\.jpg/);
    assert.deepEqual(inv.files.map((file) => file.name), ['ok.jpg']);
  });
});
