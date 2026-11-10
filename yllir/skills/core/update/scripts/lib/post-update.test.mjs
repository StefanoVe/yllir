import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completePostUpdate, preparePostUpdate, verifyPostUpdateDrafts } from './post-update.mjs';

const roots = [];
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function campaign(language, sheets) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-post-update-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'campaign.yaml'), `language:\n  main: ${language}\nstructure:\n  - id: subjects\n    folder: Subjects\n    type: subjects\n`);
  for (const [file, text] of Object.entries(sheets)) {
    const target = path.join(root, 'Subjects', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return root;
}

const itSheet = (table = '## Statistiche\n\nCA: 13\nPF: 24\nVelocità: 9 m\nAttacco: Morso +4\nEquipaggiamento: Spada\n') => `---\nid: guardia\ntemplate: npc\n---\n\n# Guardia\n\nDescrizione stabile.\n\n${table}\n<!-- master -->\n## Master\n\nNon toccare.\n<!-- /master -->\n`;
const enSheet = () => `---\nid: guard\ntemplate: npc\n---\n\n# Guard\n\nStable description.\n\n## Statistics\n\nAC: 13\nHP: 24\nSpeed: 30 ft.\nAttack: Bite +4\nEquipment: Sword\n<!-- master -->\n## Master\n\nKeep exact.\n<!-- /master -->\n`;

test('Italian and English statistics blocks stage as drafts without changing source files', () => {
  for (const [language, file, source] of [['it', 'Guardia.md', itSheet()], ['en', 'Guard.md', enSheet()]]) {
    const root = campaign(language, { [file]: source });
    const before = fs.readFileSync(path.join(root, 'Subjects', file), 'utf8');
    const result = preparePostUpdate(root, { writeDrafts: true });
    assert.equal(result.status, 'pending');
    assert.deepEqual(result.drafted, [`Subjects/${file}`]);
    assert.deepEqual(result.pending, []);
    assert.equal(fs.readFileSync(path.join(root, 'Subjects', file), 'utf8'), before);
    const draft = fs.readFileSync(path.join(root, '.campaign/state/write/draft/Subjects', file), 'utf8');
    assert.match(draft, /\|/);
    assert.match(draft, /24/);
    assert.match(draft, language === 'it' ? /### Attacchi e capacità/ : /### Attacks and abilities/);
    assert.match(draft, language === 'it' ? /### Equipaggiamento/ : /### Equipment/);
    assert.match(draft, /<!-- master -->\n## Master\n\n(?:Non toccare\.|Keep exact\.)\n<!-- \/master -->/);
    assert.deepEqual(verifyPostUpdateDrafts(root, [`Subjects/${file}`]), { status: 'verified', errors: [] });
  }
});

test('ambiguous prose stays byte-exact and is reported pending', () => {
  const source = itSheet('## Statistiche\n\nLa guardia è resistente al freddo.\n');
  const root = campaign('it', { 'Guardia.md': source });
  const result = preparePostUpdate(root, { writeDrafts: true });
  assert.equal(result.status, 'pending');
  assert.deepEqual(result.drafted, []);
  assert.deepEqual(result.pending.map((item) => item.file), ['Subjects/Guardia.md']);
  assert.equal(fs.readFileSync(path.join(root, '.campaign/state/write/draft/Subjects/Guardia.md'), 'utf8'), source);
});

test('verification blocks a partially converted prose table before write-sequence', () => {
  const root = campaign('it', { 'Guardia.md': itSheet('## Statistiche\n\nLa guardia è resistente al freddo.\n') });
  const rel = 'Subjects/Guardia.md';
  preparePostUpdate(root, { writeDrafts: true });
  const draftPath = path.join(root, '.campaign/state/write/draft', rel);
  const partial = fs.readFileSync(draftPath, 'utf8').replace(
    'La guardia è resistente al freddo.',
    'La guardia è resistente al freddo.\n\n### Caratteristiche\n\n| Caratteristica | Valore |\n| --- | --- |\n| Resistenza al freddo | sì |',
  );
  fs.writeFileSync(draftPath, partial);
  const result = verifyPostUpdateDrafts(root, [rel]);
  assert.equal(result.status, 'failed');
  assert.ok(result.errors.some((error) => error.code === 'legacy-statistics-remain'));
  assert.equal(fs.readFileSync(path.join(root, 'Subjects/Guardia.md'), 'utf8').includes('La guardia è resistente al freddo.'), true);
});

test('unsupported campaign language stays pending instead of being treated as clean', () => {
  const root = campaign('fr', { 'Guardia.md': itSheet() });
  const result = preparePostUpdate(root, { writeDrafts: true });
  assert.equal(result.status, 'pending');
  assert.equal(result.errors[0].code, 'unsupported-language');
  assert.deepEqual(completePostUpdate(root).status, 'pending');
  assert.equal(fs.existsSync(path.join(root, '.campaign/state/update.yaml')), false);
});

test('external symlinked sheets are never staged or changed', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-post-update-outside-'));
  roots.push(outside);
  const externalFile = path.join(outside, 'Outside.md');
  fs.writeFileSync(externalFile, itSheet());
  const root = campaign('it', {});
  fs.mkdirSync(path.join(root, 'Subjects'));
  fs.symlinkSync(externalFile, path.join(root, 'Subjects/Outside.md'));
  const result = preparePostUpdate(root, { writeDrafts: true });
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.candidates, []);
  assert.match(fs.readFileSync(externalFile, 'utf8'), /CA: 13/);
});

test('draft verification rejects outside-section changes and stale source after interruption', () => {
  const root = campaign('it', { 'Guardia.md': itSheet() });
  const rel = 'Subjects/Guardia.md';
  preparePostUpdate(root, { writeDrafts: true });
  const draftPath = path.join(root, '.campaign/state/write/draft', rel);
  fs.writeFileSync(draftPath, fs.readFileSync(draftPath, 'utf8').replace('Descrizione stabile.', 'Testo alterato.'));
  assert.equal(verifyPostUpdateDrafts(root, [rel]).errors[0].code, 'outside-statistics-changed');
  preparePostUpdate(root, { writeDrafts: true });
  fs.writeFileSync(path.join(root, rel), fs.readFileSync(path.join(root, rel), 'utf8').replace('Descrizione stabile.', 'Modificato a mano.'));
  assert.equal(preparePostUpdate(root, { writeDrafts: true }).status, 'failed');
  assert.equal(verifyPostUpdateDrafts(root, [rel]).errors[0].code, 'source-changed');
});

test('completion is recorded only after a clean rescan and only for a pending completed update', () => {
  const root = campaign('it', { 'Guardia.md': itSheet() });
  preparePostUpdate(root, { writeDrafts: true });
  fs.mkdirSync(path.join(root, '.campaign/state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.campaign/state/update.yaml'), 'status: completed\nsheet_migration_id: "statistics-tables-v1"\nsheet_migration: pending\n');
  const converted = `---\nid: guardia\ntemplate: npc\n---\n\n# Guardia\n\nDescrizione stabile.\n\n## Statistiche\n\n### Caratteristiche\n\n| Caratteristica | Valore |\n| --- | --- |\n| CA | 13 |\n| PF | 24 |\n| Velocità | 9 m |\n\n<!-- master -->\n## Master\n\nNon toccare.\n<!-- /master -->\n`;
  fs.writeFileSync(path.join(root, 'Subjects/Guardia.md'), converted);
  const result = completePostUpdate(root);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.converted, ['Subjects/Guardia.md']);
  assert.match(fs.readFileSync(path.join(root, '.campaign/state/update.yaml'), 'utf8'), /sheet_migration: complete/);
});

test('dry-run never clears a stale pending marker', () => {
  const root = campaign('it', {});
  fs.mkdirSync(path.join(root, '.campaign/state'), { recursive: true });
  const file = path.join(root, '.campaign/state/update.yaml');
  const original = 'status: completed\nsheet_migration_id: "statistics-tables-v1"\nsheet_migration: pending\n';
  fs.writeFileSync(file, original);
  assert.equal(completePostUpdate(root).status, 'complete');
  // Restore the pending marker to model a stale state that a dry-run may inspect.
  fs.writeFileSync(file, original);
  const before = fs.readFileSync(file, 'utf8');
  assert.deepEqual(preparePostUpdate(root), { status: 'complete', drafted: [], pending: [], candidates: [], errors: [] });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
