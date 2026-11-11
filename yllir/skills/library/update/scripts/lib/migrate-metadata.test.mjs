import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyMetadataMigration, listMetadataFiles, planMetadataMigration } from './migrate-metadata.mjs';
import { loadRegistry } from './registry.mjs';
import { detect, apply } from '../../migrations/metadata-comment-v1/deterministic.mjs';

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-metadata-'));
  tempDirs.push(dir);
  return dir;
}

function write(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const CONFIG = `schema: 1

campaign:
  name: "Prova"
  seed: Seme.md

structure:
  - id: trama
    folder: Trama
    type: plot
  - id: personaggi
    folder: Personaggi
    type: subjects
  - id: esterno
    folder: Esterno
    type: external
  - id: fonti
    folder: Fonti
    type: sources
  - id: assente
    folder: Assente
    type: free
`;

/** A campaign with the old frontmatter in every place the migration must reach. */
function campaign() {
  const root = tmp();
  write(root, 'campaign.yaml', CONFIG);
  write(root, 'Seme.md', '---\nid: seme\n---\n# Seme\n');
  write(root, 'Personaggi/asha.md', '---\nid: asha-vey\nname: Asha Vey\n---\n# Asha\n\nTesto.\n');
  write(root, 'Trama/sessione-1/scena-1.md', '---\nid: scena-1\n---\n# Scena\n');
  write(root, '.campaign/state/x/topic.md', '---\nid: topic\n---\nNote.\n');
  return root;
}

// ---------------------------------------------------------------- conversion

test('the seed, a sheet, a scene in a plot folder and a state note are converted; bodies stay byte-identical', () => {
  const root = campaign();
  const bodies = {
    'Seme.md': '# Seme\n',
    'Personaggi/asha.md': '# Asha\n\nTesto.\n',
    'Trama/sessione-1/scena-1.md': '# Scena\n',
    '.campaign/state/x/topic.md': 'Note.\n',
  };
  const result = applyMetadataMigration(root);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.changed, ['.campaign/state/x/topic.md', 'Personaggi/asha.md', 'Seme.md', 'Trama/sessione-1/scena-1.md']);
  assert.equal(read(root, 'Seme.md'), '<!-- yllir\nid: seme\n-->\n# Seme\n');
  assert.equal(read(root, 'Personaggi/asha.md'), '<!-- yllir\nid: asha-vey\nname: Asha Vey\n-->\n# Asha\n\nTesto.\n');
  assert.equal(read(root, 'Trama/sessione-1/scena-1.md'), '<!-- yllir\nid: scena-1\n-->\n# Scena\n');
  assert.equal(read(root, '.campaign/state/x/topic.md'), '<!-- yllir\nid: topic\n-->\nNote.\n');
  for (const [file, body] of Object.entries(bodies)) {
    assert.ok(read(root, file).endsWith(body), `${file}: the body changed`);
  }
});

test('files with \\r\\n line breaks keep them', () => {
  const root = tmp();
  write(root, 'campaign.yaml', CONFIG);
  write(root, 'Seme.md', '---\r\nid: seme\r\n---\r\n# Seme\r\nRiga.\r\n');
  const result = applyMetadataMigration(root);
  assert.deepEqual(result.changed, ['Seme.md']);
  assert.equal(read(root, 'Seme.md'), '<!-- yllir\r\nid: seme\r\n-->\r\n# Seme\r\nRiga.\r\n');
});

test('a file already in comment form, a file without a header and a file with an unclosed block are not changed', () => {
  const root = tmp();
  write(root, 'campaign.yaml', CONFIG);
  const comment = '<!-- yllir\nid: gia\n-->\n# Gia\n';
  const plain = '# Senza intestazione\n\n--- non e un blocco\n';
  const unclosed = '---\nid: aperto\n# Nessuna chiusura\n';
  write(root, 'Personaggi/gia.md', comment);
  write(root, 'Personaggi/plain.md', plain);
  write(root, 'Personaggi/aperto.md', unclosed);
  assert.deepEqual(planMetadataMigration(root).changed, []);
  const result = applyMetadataMigration(root);
  assert.deepEqual(result.changed, []);
  assert.equal(read(root, 'Personaggi/gia.md'), comment);
  assert.equal(read(root, 'Personaggi/plain.md'), plain);
  assert.equal(read(root, 'Personaggi/aperto.md'), unclosed);
});

test('external folders, the customizations, the originals of a sources folder and CLAUDE.md are not changed; a card of a sources folder is', () => {
  const root = campaign();
  write(root, 'Esterno/nota.md', '---\nid: nota\n---\n# Nota\n');
  write(root, '.campaign/customizations.md', '---\nid: custom\n---\n# Mie\n');
  write(root, 'Fonti/acq-1/original.md', '---\nid: orig\n---\nTrascrizione fedele.\n');
  write(root, 'Fonti/acq-1/card.md', '---\nid: card\n---\n# Scheda\n');
  write(root, 'CLAUDE.md', '---\nid: claude\n---\n# Istruzioni\n');
  const originalBytes = read(root, 'Fonti/acq-1/original.md');
  const listed = listMetadataFiles(root);
  assert.ok(listed.includes('Fonti/acq-1/card.md'));
  for (const file of ['Esterno/nota.md', '.campaign/customizations.md', 'Fonti/acq-1/original.md', 'CLAUDE.md']) {
    assert.equal(listed.includes(file), false, `${file} must not be listed`);
  }
  applyMetadataMigration(root);
  assert.equal(read(root, 'Esterno/nota.md'), '---\nid: nota\n---\n# Nota\n');
  assert.equal(read(root, '.campaign/customizations.md'), '---\nid: custom\n---\n# Mie\n');
  assert.equal(read(root, 'Fonti/acq-1/original.md'), originalBytes);
  assert.equal(read(root, 'CLAUDE.md'), '---\nid: claude\n---\n# Istruzioni\n');
  assert.equal(read(root, 'Fonti/acq-1/card.md'), '<!-- yllir\nid: card\n-->\n# Scheda\n');
});

test('symbolic links are neither followed nor changed, files or folders', () => {
  const root = campaign();
  const outside = tmp();
  write(outside, 'fuori.md', '---\nid: fuori\n---\n# Fuori\n');
  write(outside, 'cartella/dentro.md', '---\nid: dentro\n---\n# Dentro\n');
  fs.symlinkSync(path.join(outside, 'fuori.md'), path.join(root, 'Personaggi/link.md'));
  fs.symlinkSync(path.join(outside, 'cartella'), path.join(root, 'Trama/linkcartella'));
  const listed = listMetadataFiles(root);
  assert.equal(listed.some((file) => file.includes('link')), false);
  assert.equal(listed.some((file) => file.includes('dentro')), false);
  applyMetadataMigration(root);
  assert.equal(read(outside, 'fuori.md'), '---\nid: fuori\n---\n# Fuori\n');
  assert.equal(read(outside, 'cartella/dentro.md'), '---\nid: dentro\n---\n# Dentro\n');
});

test('a missing structure folder is skipped without an error', () => {
  const root = campaign();
  const plan = planMetadataMigration(root);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.status, 'pending');
});

test('a campaign without a readable campaign.yaml lists nothing', () => {
  const root = tmp();
  write(root, 'Personaggi/asha.md', '---\nid: asha\n---\n# Asha\n');
  assert.deepEqual(listMetadataFiles(root), []);
});

// ---------------------------------------------------------------- plan, apply, idempotence

test('planning writes nothing; after apply the plan is complete; a second apply changes nothing', () => {
  const root = campaign();
  const files = listMetadataFiles(root);
  const before = files.map((file) => read(root, file));

  const plan = planMetadataMigration(root);
  assert.equal(plan.status, 'pending');
  assert.equal(plan.changed.length, 4);
  assert.deepEqual(plan.skipped, []);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(files.map((file) => read(root, file)), before);

  assert.equal(applyMetadataMigration(root).status, 'complete');
  const planned = planMetadataMigration(root);
  assert.equal(planned.status, 'complete');
  assert.deepEqual(planned.changed, []);

  const afterFirst = files.map((file) => read(root, file));
  const second = applyMetadataMigration(root);
  assert.equal(second.status, 'complete');
  assert.deepEqual(second.changed, []);
  assert.deepEqual(files.map((file) => read(root, file)), afterFirst);
});

test('listed files are campaign-relative, forward slashes and sorted', () => {
  const root = campaign();
  const listed = listMetadataFiles(root);
  assert.deepEqual(listed, [...listed].sort());
  assert.ok(listed.every((file) => !file.includes('\\') && !path.isAbsolute(file)));
});

// ---------------------------------------------------------------- deterministic.mjs

test('detect is true while a file has the old form and false once converted', () => {
  const root = campaign();
  assert.equal(detect(root), true);
  applyMetadataMigration(root);
  assert.equal(detect(root), false);
});

test('apply with dryRun reports the pending files and writes nothing; apply converts them', () => {
  const root = campaign();
  const before = read(root, 'Seme.md');
  const dry = apply(root, { dryRun: true });
  assert.equal(dry.status, 'pending');
  assert.equal(dry.changed.length, 4);
  assert.deepEqual(dry.errors, []);
  assert.equal(read(root, 'Seme.md'), before);

  const real = apply(root);
  assert.equal(real.status, 'complete');
  assert.equal(real.changed.length, 4);
  assert.equal(read(root, 'Seme.md'), '<!-- yllir\nid: seme\n-->\n# Seme\n');
});

// ---------------------------------------------------------------- registry

test('the migration is registered last, after every other migration of the folder', () => {
  const registry = loadRegistry();
  assert.deepEqual(registry.errors, []);
  const last = registry.migrations.at(-1);
  assert.equal(last.id, 'metadata-comment-v1');
  assert.equal(last.needed, 'detect');
  assert.equal(last.version_record_before, false);
  assert.deepEqual(
    [...last.after].sort(),
    registry.migrations.slice(0, -1).map((m) => m.id).sort(),
  );
});
