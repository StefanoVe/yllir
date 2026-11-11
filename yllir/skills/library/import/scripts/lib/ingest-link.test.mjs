import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInventory } from './ingest-inventory.mjs';

const CLI = fileURLToPath(new URL('../ingest-link.mjs', import.meta.url));

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

const GOOD_DOC = '---\nid: scena-1\ntitle: Scena uno\n---\nTesto della scena.\n';

/** Runs `fn` on a temporary campaign root (with a Trama folder) and an inputs folder outside it. */
function withEnv(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-ingest-link-'));
  try {
    const root = path.join(base, 'campaign');
    const inputs = path.join(base, 'inputs');
    fs.mkdirSync(path.join(root, 'Trama'), { recursive: true });
    fs.mkdirSync(inputs);
    fs.writeFileSync(path.join(root, 'campaign.yaml'), CAMPAIGN);
    return fn({ base, root, inputs });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Builds the inventory of `names` (relative to `inputs`) with the real inventory code and writes it to base/inventory.json. */
function inventoryFor(base, root, inputs, names) {
  const inventory = buildInventory({ campaignRoot: root, inputs: names, baseDir: inputs });
  const file = path.join(base, 'inventory.json');
  fs.writeFileSync(file, `${JSON.stringify(inventory, null, 2)}\n`);
  return file;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Runs the CLI with `cwd` as the working directory, so inputs resolve like in real use. */
function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd });
}

test('candidates mode finds a complete .md and ignores the others', () => {
  withEnv(({ base, root, inputs }) => {
    write(path.join(inputs, 'scena.md'), GOOD_DOC);
    write(path.join(inputs, 'notes.txt'), GOOD_DOC); // right content, wrong extension
    write(path.join(inputs, 'plain.md'), 'Just text, no front matter.\n'); // no front matter
    write(path.join(inputs, 'copy.md'), GOOD_DOC); // same bytes as scena.md: duplicate-input, not new
    const inventory = inventoryFor(base, root, inputs, ['scena.md', 'notes.txt', 'plain.md', 'copy.md']);

    const result = runCli(inputs, [root, '--mode', 'candidates', '--inventory', inventory]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'candidates: 1\ncandidate: scena.md\nexit: 0\n');
    assert.equal(readJson(inventory).files.find((f) => f.input === 'scena.md').status, 'new');
  });
});

test('link mode creates a symlink to the original and updates the inventory', () => {
  withEnv(({ base, root, inputs }) => {
    const original = path.join(inputs, 'scena.md');
    write(original, GOOD_DOC);
    const inventory = inventoryFor(base, root, inputs, ['scena.md']);
    const out = path.join(base, 'out', 'links.json');

    const result = runCli(inputs, [
      root,
      '--mode', 'link',
      '--inventory', inventory,
      '--category-folder', 'Trama',
      '--inputs', 'scena.md',
      '--out', out,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^linked: 1, external: 1, refused: 0\n/);
    assert.match(result.stdout, /external: Trama\/scena\.md\n/);
    assert.match(result.stdout, /exit: 0\n$/);

    const target = path.join(root, 'Trama', 'scena.md');
    assert.ok(fs.lstatSync(target).isSymbolicLink());
    assert.equal(fs.readlinkSync(target), fs.realpathSync(original));
    assert.equal(fs.readFileSync(target, 'utf8'), GOOD_DOC);
    assert.equal(fs.readFileSync(original, 'utf8'), GOOD_DOC);

    const entry = readJson(inventory).files.find((f) => f.input === 'scena.md');
    assert.equal(entry.status, 'linked');
    assert.equal(entry.linked_as, 'Trama/scena.md');
    assert.equal(entry.external, true);

    assert.deepEqual(readJson(out), {
      links: [{ input: 'scena.md', path: 'Trama/scena.md', external: true }],
      refused: [],
    });
  });
});

test('external is false for an original inside the campaign and true outside it', () => {
  withEnv(({ base, root, inputs }) => {
    write(path.join(inputs, 'fuori.md'), GOOD_DOC);
    const inside = path.join(root, 'Inbox', 'dentro.md');
    write(inside, '---\nid: scena-2\n---\nDentro.\n');
    const inventory = inventoryFor(base, root, inputs, ['fuori.md', path.join(root, 'Inbox', 'dentro.md')]);
    const out = path.join(base, 'links.json');

    const result = runCli(inputs, [
      root,
      '--mode', 'link',
      '--inventory', inventory,
      '--category-folder', 'Trama',
      '--inputs', `fuori.md,${inside}`,
      '--out', out,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^linked: 2, external: 1, refused: 0\n/);
    const links = readJson(out).links;
    assert.deepEqual(
      links.map((link) => [link.path, link.external]),
      [
        ['Trama/fuori.md', true],
        ['Trama/dentro.md', false],
      ],
    );
    const dentro = readJson(inventory).files.find((f) => f.name === 'dentro.md');
    assert.equal(dentro.external, false);
    assert.equal(fs.readFileSync(inside, 'utf8'), '---\nid: scena-2\n---\nDentro.\n');
  });
});

test('refusal when the name already exists, even as a broken symlink; nothing is overwritten', () => {
  withEnv(({ base, root, inputs }) => {
    write(path.join(inputs, 'scena.md'), GOOD_DOC);
    write(path.join(root, 'Trama', 'scena.md'), 'Existing canon text.\n');
    const inventory = inventoryFor(base, root, inputs, ['scena.md']);
    const out = path.join(base, 'links.json');

    const first = runCli(inputs, [
      root, '--mode', 'link', '--inventory', inventory,
      '--category-folder', 'Trama', '--inputs', 'scena.md', '--out', out,
    ]);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /^linked: 0, external: 0, refused: 1\n/);
    assert.match(first.stdout, /refused: scena\.md: already exists: Trama\/scena\.md\n/);
    assert.equal(fs.readFileSync(path.join(root, 'Trama', 'scena.md'), 'utf8'), 'Existing canon text.\n');
    assert.equal(readJson(inventory).files[0].status, 'new');

    fs.rmSync(path.join(root, 'Trama', 'scena.md'));
    fs.symlinkSync(path.join(base, 'nowhere.md'), path.join(root, 'Trama', 'scena.md'));
    const second = runCli(inputs, [
      root, '--mode', 'link', '--inventory', inventory,
      '--category-folder', 'Trama', '--inputs', 'scena.md', '--out', out,
    ]);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /refused: scena\.md: already exists/);
    assert.equal(fs.readlinkSync(path.join(root, 'Trama', 'scena.md')), path.join(base, 'nowhere.md'));
    assert.equal(readJson(inventory).files[0].status, 'new');
  });
});

test('refusal for a non-candidate: the file stays new and no symlink is created', () => {
  withEnv(({ base, root, inputs }) => {
    write(path.join(inputs, 'notes.txt'), GOOD_DOC);
    const inventory = inventoryFor(base, root, inputs, ['notes.txt']);
    const out = path.join(base, 'links.json');

    const result = runCli(inputs, [
      root, '--mode', 'link', '--inventory', inventory,
      '--category-folder', 'Trama', '--inputs', 'notes.txt', '--out', out,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^linked: 0, external: 0, refused: 1\n/);
    assert.match(result.stdout, /refused: notes\.txt: not a candidate: not a \.md file\n/);
    assert.equal(fs.existsSync(path.join(root, 'Trama', 'notes.txt')), false);
    assert.equal(readJson(inventory).files[0].status, 'new');
    assert.equal(readJson(out).links.length, 0);
  });
});

test('refusal when another input in the same call has the same name', () => {
  withEnv(({ base, root, inputs }) => {
    write(path.join(inputs, 'a', 'scena.md'), GOOD_DOC);
    write(path.join(inputs, 'b', 'scena.md'), '---\nid: scena-b\n---\nAltra versione.\n');
    const inventory = inventoryFor(base, root, inputs, ['a/scena.md', 'b/scena.md']);
    const out = path.join(base, 'links.json');

    const result = runCli(inputs, [
      root, '--mode', 'link', '--inventory', inventory,
      '--category-folder', 'Trama', '--inputs', 'a/scena.md,b/scena.md', '--out', out,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^linked: 0, external: 0, refused: 2\n/);
    assert.equal(fs.existsSync(path.join(root, 'Trama', 'scena.md')), false);
  });
});

test('a category folder outside the campaign is an error (exit 1)', () => {
  withEnv(({ base, root, inputs }) => {
    write(path.join(inputs, 'scena.md'), GOOD_DOC);
    const inventory = inventoryFor(base, root, inputs, ['scena.md']);
    const result = runCli(inputs, [
      root, '--mode', 'link', '--inventory', inventory,
      '--category-folder', '../inputs', '--inputs', 'scena.md', '--out', path.join(base, 'links.json'),
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /error: category folder must be inside the campaign\n/);
    assert.match(result.stdout, /exit: 1\n$/);
    assert.equal(readJson(inventory).files[0].status, 'new');
  });
});

test('a missing inventory is an error (exit 1)', () => {
  withEnv(({ base, root, inputs }) => {
    const result = runCli(inputs, [root, '--mode', 'candidates', '--inventory', path.join(base, 'none.json')]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /error: cannot read inventory/);
    assert.match(result.stdout, /exit: 1\n$/);
  });
});

test('missing --mode is a usage error (exit 2)', () => {
  withEnv(({ base, root, inputs }) => {
    const inventory = inventoryFor(base, root, inputs, []);
    const result = runCli(inputs, [root, '--inventory', inventory]);
    assert.equal(result.status, 2);
    assert.match(result.stdout, /exit: 2\n$/);
  });
});
