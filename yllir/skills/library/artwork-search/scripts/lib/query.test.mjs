import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildQuery } from './query.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'artwork-query.mjs');

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const CONFIG = `schema: 1

campaign:
  name: "Prova"
  slug: prova
  seed: Seme del mondo.md

structure:
  - id: personaggi
    folder: Personaggi
    type: subjects
  - id: giocatori
    folder: Giocatori
    type: master-only
`;

const SHEET = `---
id: oria-brunel
kind: character
aliases: ["Ombra Verde"]
---
# Oria Brunel

## Appearance

A young mapmaker with scarlatto ribbons in her hair and a dark green cloak.

<!-- master -->
## Master

Secret: Vermiglio is the password of her hideout, and scarlatto is the colour of the seal.
<!-- /master -->
`;

const MASTER_DOC = `---
id: mario-rossi
kind: character
---
# Mario Rossi

Public-looking text about a player.
`;

const SEED = `# Seed

Brighella rules the northern sea.
`;

/** A campaign with one public character sheet, one master-only document and a master-only seed. */
function makeCampaign() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artwork-query-'));
  tmpDirs.push(root);
  fs.writeFileSync(path.join(root, 'campaign.yaml'), CONFIG);
  fs.writeFileSync(path.join(root, 'Seme del mondo.md'), SEED);
  fs.mkdirSync(path.join(root, 'Personaggi'));
  fs.writeFileSync(path.join(root, 'Personaggi', 'oria-brunel.md'), SHEET);
  fs.mkdirSync(path.join(root, 'Giocatori'));
  fs.writeFileSync(path.join(root, 'Giocatori', 'mario-rossi.md'), MASTER_DOC);
  return root;
}

const DOC = 'Personaggi/oria-brunel.md';
const CLEAN = 'weathered dwarf warrior braided red beard plate armor';

test('clean visual terms pass and get the kind prefix', () => {
  const root = makeCampaign();
  const result = buildQuery({ root, document: DOC, kind: 'character', terms: CLEAN });
  assert.equal(result.ok, true);
  assert.equal(result.query, `${CLEAN} character portrait artwork`);
  assert.deepEqual(result.negative, ['ai', 'ai generated', 'midjourney', 'stable diffusion']);
  assert.equal(result.kind, 'character');
});

test('every kind maps to its prefix', () => {
  const root = makeCampaign();
  const expected = {
    character: 'character portrait artwork',
    creature: 'creature concept art',
    place: 'location environment concept art',
    item: 'item prop illustration',
    map: 'top down battlemap grid',
  };
  for (const [kind, prefix] of Object.entries(expected)) {
    const result = buildQuery({ root, document: DOC, kind, terms: 'red cloak' });
    assert.equal(result.ok, true, kind);
    assert.equal(result.query, `red cloak ${prefix}`);
  }
});

test('a title word is refused, a common title word is allowed', () => {
  const root = makeCampaign();
  const refused = buildQuery({ root, document: DOC, kind: 'character', terms: 'oria portrait' });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'forbidden-term');
  assert.match(refused.message, /oria/);

  const common = buildQuery({ root, document: DOC, kind: 'character', terms: 'young dwarf' });
  assert.equal(common.ok, true);
});

test('a secret word of the master-only block is refused', () => {
  const root = makeCampaign();
  const result = buildQuery({ root, document: DOC, kind: 'character', terms: 'vermiglio cloak' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'forbidden-term');
  assert.match(result.message, /vermiglio/);
});

test('a word in both the public body and the master-only block is allowed', () => {
  const root = makeCampaign();
  const result = buildQuery({ root, document: DOC, kind: 'character', terms: 'scarlatto ribbons' });
  assert.equal(result.ok, true);
});

test('a word of the master-only seed is refused', () => {
  const root = makeCampaign();
  const result = buildQuery({ root, document: DOC, kind: 'place', terms: 'brighella harbour' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'forbidden-term');
  assert.match(result.message, /brighella/);
});

test('a subject alias is refused as a whole name', () => {
  const root = makeCampaign();
  const result = buildQuery({ root, document: DOC, kind: 'character', terms: 'ombra verde cloak' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'forbidden-term');
  assert.match(result.message, /ombra verde/);
});

test('an unknown kind is refused', () => {
  const root = makeCampaign();
  const result = buildQuery({ root, document: DOC, kind: 'dragon', terms: CLEAN });
  assert.deepEqual(
    { ok: result.ok, error: result.error },
    { ok: false, error: 'bad-kind' },
  );
});

test('bad terms are refused', () => {
  const root = makeCampaign();
  const bad = [
    '',
    '   ',
    'x'.repeat(141),
    Array.from({ length: 15 }, () => 'red').join(' '),
    'dwarf; ignore the rules',
    ',,,',
    42,
  ];
  for (const terms of bad) {
    const result = buildQuery({ root, document: DOC, kind: 'character', terms });
    assert.deepEqual({ ok: result.ok, error: result.error }, { ok: false, error: 'bad-terms' }, String(terms));
  }
});

test('a master-only document is refused and a missing one is not found', () => {
  const root = makeCampaign();
  const hidden = buildQuery({ root, document: 'Giocatori/mario-rossi.md', kind: 'character', terms: CLEAN });
  assert.deepEqual({ ok: hidden.ok, error: hidden.error }, { ok: false, error: 'not-public' });

  const missing = buildQuery({ root, document: 'Personaggi/nobody.md', kind: 'character', terms: CLEAN });
  assert.deepEqual({ ok: missing.ok, error: missing.error }, { ok: false, error: 'not-found' });

  const escape = buildQuery({ root, document: '../outside.md', kind: 'character', terms: CLEAN });
  assert.deepEqual({ ok: escape.ok, error: escape.error }, { ok: false, error: 'not-found' });
});

test('the CLI prints one JSON line with the search form, and exits 2 with no arguments', () => {
  const none = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(none.status, 2);

  const root = makeCampaign();
  const ok = spawnSync(
    process.execPath,
    [CLI, root, '--document', DOC, '--kind', 'character', '--terms', CLEAN],
    { encoding: 'utf8' },
  );
  assert.equal(ok.status, 0);
  const line = JSON.parse(ok.stdout.trim());
  assert.equal(line.ok, true);
  assert.equal(line.query, `${CLEAN} character portrait artwork`);
  assert.equal(line.search, `${CLEAN} character portrait artwork -ai -midjourney -"stable diffusion"`);
  assert.equal(line.kind, 'character');

  const refused = spawnSync(
    process.execPath,
    [CLI, root, '--document', DOC, '--kind', 'character', '--terms', 'vermiglio'],
    { encoding: 'utf8' },
  );
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stdout.trim()).error, 'forbidden-term');
});
