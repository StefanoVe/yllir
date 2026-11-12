import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { placeMap, placeSection } from './map-place.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLACE_CLI = path.join(HERE, '..', 'image-place.mjs');

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const CONFIG = `schema: 1

campaign:
  name: "Prova"
  slug: prova
  seed: Seme del mondo.md

language:
  main: it

structure:
  - id: personaggi
    folder: Personaggi
    type: subjects
`;

const SHEET = `---
id: oria-brunel
kind: character
---
# Oria Brunel

## Aspetto

Una giovane cartografa dai capelli rossi.

<!-- master -->
## Master

Segreto: SEGRETO-7731 e il codice del suo rifugio.
<!-- /master -->
`;

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-map-place-'));
  tmpDirs.push(root);
  write(root, 'campaign.yaml', CONFIG);
  write(root, 'Personaggi/Oria Brunel.md', SHEET);
  return root;
}

/** A nav report of the real shape (schema generate2dmap.nav_report.v1): status and an array of targets. */
function navReport({ status = 'pass', reachable = [true, true] } = {}) {
  return {
    schema: 'generate2dmap.nav_report.v1',
    status,
    targets: reachable.map((ok, i) => ({ kind: 'interaction', id: `target-${i}`, point: [100 + i, 200], reachable: ok, steps: 10, node: [99, 199], reason: null })),
  };
}

/** A finished map job with small dummy files, as the map pipeline leaves them. */
function makeMapJob(root, { id = 'oria-brunel-map-1', document = 'Personaggi/Oria Brunel.md', skip = null, nav = navReport() } = {}) {
  const dir = path.join(root, '.campaign', 'state', 'maps', id);
  const files = {
    'job.json': JSON.stringify({ id, document, cols: 24, rows: 16, cell: 64 }),
    'fit/background.png': 'PNG-BG',
    'grid/map-grid.png': 'PNG-GRID',
    'map.uvtt': 'UVTT',
    'tiled/map.tmj': '{"tilesets":[{"image":"images/tiles.png"}]}',
    'tiled/images/tiles.png': 'PNG-TILES',
    'preview/preview.html': '<!doctype html><p>preview</p>',
    'nav/nav-report.json': JSON.stringify(nav),
    'layout.json': '{}',
  };
  for (const [rel, text] of Object.entries(files)) {
    if (rel !== skip) write(dir, rel, text);
  }
  return id;
}

function makeImageJob(root, id = 'oria-brunel-map-1') {
  write(root, `.campaign/state/images/${id}/job.json`, JSON.stringify({ id, operation: 'generate', prompt: 'Mappa pulita. 24 squares' }));
  return id;
}

function place(root, extra = {}) {
  return placeMap({
    root,
    document: 'Personaggi/Oria Brunel.md',
    mapJob: 'oria-brunel-map-1',
    imageJob: 'oria-brunel-map-1',
    provider: 'comfyui',
    alt: 'Mappa del rifugio',
    review: 'Sembra giusto',
    ...extra,
  });
}

const DRAFT = (root) => fs.readFileSync(path.join(root, '.campaign', 'drafts', 'Personaggi', 'Oria Brunel.md'), 'utf8');

test('placing a map copies every file under one stem, writes the sidecar and the draft section', () => {
  const root = makeRoot();
  makeMapJob(root);
  makeImageJob(root);
  const result = place(root);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.draft, 'Personaggi/Oria Brunel.md');
  const expectedFiles = [
    'Personaggi/img/oria-brunel-map.png',
    'Personaggi/img/oria-brunel-map-grid.png',
    'Personaggi/img/oria-brunel-map.uvtt',
    'Personaggi/img/oria-brunel-map-preview.html',
    'Personaggi/img/oria-brunel-map-tiled/map.tmj',
    'Personaggi/img/oria-brunel-map-tiled/images/tiles.png',
    'Personaggi/img/oria-brunel-map.yaml',
  ].sort();
  assert.deepEqual(result.files, expectedFiles);
  for (const file of expectedFiles) assert.ok(fs.existsSync(path.join(root, file)), file);
  assert.equal(fs.readFileSync(path.join(root, 'Personaggi/img/oria-brunel-map.png'), 'utf8'), 'PNG-BG');
  assert.equal(fs.readFileSync(path.join(root, 'Personaggi/img/oria-brunel-map-tiled/map.tmj'), 'utf8'), '{"tilesets":[{"image":"images/tiles.png"}]}');

  const sidecar = fs.readFileSync(path.join(root, 'Personaggi/img/oria-brunel-map.yaml'), 'utf8');
  assert.match(sidecar, /^provider: "comfyui"$/m);
  assert.match(sidecar, /^operation: "map"$/m);
  assert.match(sidecar, /^document: "Personaggi\/Oria Brunel\.md"$/m);
  assert.match(sidecar, /^effective_prompt: "Mappa pulita\. 24 squares"$/m);
  assert.match(sidecar, /^references: \[\]$/m);
  assert.match(sidecar, /^  cols: 24$/m);
  assert.match(sidecar, /^  rows: 16$/m);
  assert.match(sidecar, /^  cell: 64$/m);
  assert.match(sidecar, /^  third_party: "agent-sprite-forge@72fa5ad92d79b811acff464da32c8f3b1caa010f"$/m);
  assert.match(sidecar, /^  checks: "nav targets 2, unreachable 0"$/m);
  assert.match(sidecar, /^review: "Sembra giusto"$/m);
  assert.ok(!sidecar.includes('SEGRETO'));

  const original = fs.readFileSync(path.join(root, 'Personaggi/Oria Brunel.md'), 'utf8');
  const draft = DRAFT(root);
  const section = [
    '<!-- yllir:map -->',
    '## Mappa',
    '',
    '![Mappa del rifugio](img/oria-brunel-map-grid.png)',
    '',
    '[Senza griglia](img/oria-brunel-map.png) · [Anteprima navigabile](img/oria-brunel-map-preview.html) · ' +
      '[Tavolo virtuale](img/oria-brunel-map.uvtt) · [Tiled](img/oria-brunel-map-tiled/map.tmj)',
    '<!-- /yllir:map -->',
  ].join('\n');
  const masterAt = original.indexOf('<!-- master -->');
  assert.equal(draft, original.slice(0, masterAt).replace(/\n*$/, '\n') + '\n' + section + '\n\n' + original.slice(masterAt));
  assert.equal(draft.slice(draft.indexOf('<!-- master -->')), original.slice(masterAt), 'master block identical');
});

test('a second placement of a document that already has the section uses -map-2 and replaces the section', () => {
  const root = makeRoot();
  makeMapJob(root);
  makeImageJob(root);
  place(root);
  // The master accepts the draft: it becomes the document, and the next placement sees the section.
  fs.writeFileSync(path.join(root, 'Personaggi/Oria Brunel.md'), DRAFT(root));
  const second = place(root, { alt: 'Secondo rifugio' });
  assert.equal(second.ok, true, second.message);
  assert.ok(second.files.includes('Personaggi/img/oria-brunel-map-2.png'));
  assert.ok(second.files.includes('Personaggi/img/oria-brunel-map-2.yaml'));
  const draft = DRAFT(root);
  assert.equal(draft.split('## Mappa').length - 1, 1);
  assert.ok(draft.includes('![Secondo rifugio](img/oria-brunel-map-2-grid.png)'));
  assert.ok(!draft.includes('oria-brunel-map-grid.png'));
  assert.ok(draft.includes('<!-- master -->\n## Master'));
  assert.ok(draft.endsWith('<!-- /master -->\n'));
});

const BLOCK_OLD = ['<!-- yllir:map -->', '## Mappa', '', '![vecchio](img/old.png)', '<!-- /yllir:map -->'];
const BLOCK_NEW = ['<!-- yllir:map -->', '## Mappa', '', '![nuovo](img/new.png)', '<!-- /yllir:map -->'];

test('placeSection inserts the block before the master marker, one blank line around it', () => {
  const text = '# Titolo\n\nTesto.\n\n<!-- master -->\n## Master\n\nSegreto.\n<!-- /master -->\n';
  const out = placeSection(text, BLOCK_NEW);
  assert.equal(out, `# Titolo\n\nTesto.\n\n${BLOCK_NEW.join('\n')}\n\n<!-- master -->\n## Master\n\nSegreto.\n<!-- /master -->\n`);
});

test('placeSection replaces an existing block between its markers and keeps the text around it', () => {
  const text = `# Titolo\n\n${BLOCK_OLD.join('\n')}\n\nAltro testo.\n\n<!-- master -->\nSegreto.\n`;
  const out = placeSection(text, BLOCK_NEW);
  assert.equal(out, `# Titolo\n\n${BLOCK_NEW.join('\n')}\n\nAltro testo.\n\n<!-- master -->\nSegreto.\n`);
});

test('placeSection never touches a marker pair inside the master block', () => {
  const text = '# Titolo\n\nTesto.\n\n<!-- master -->\n' + BLOCK_OLD.join('\n') + '\n<!-- /master -->\n';
  const out = placeSection(text, BLOCK_NEW);
  assert.equal(out, `# Titolo\n\nTesto.\n\n${BLOCK_NEW.join('\n')}\n\n<!-- master -->\n${BLOCK_OLD.join('\n')}\n<!-- /master -->\n`);
});

test('placeSection refuses an opening marker without its closing marker', () => {
  const text = '# Titolo\n\n<!-- yllir:map -->\n## Mappa\n\n<!-- master -->\n';
  assert.equal(placeSection(text, BLOCK_NEW), null);
});

test('a document whose block has no closing marker is bad-section and nothing is written', () => {
  const root = makeRoot();
  write(root, 'Personaggi/Oria Brunel.md', '# Oria Brunel\n\n<!-- yllir:map -->\n## Mappa\n\n<!-- master -->\n');
  makeMapJob(root);
  makeImageJob(root);
  const result = place(root);
  assert.equal(result.error, 'bad-section');
  assert.ok(!fs.existsSync(path.join(root, 'Personaggi', 'img')));
  assert.ok(!fs.existsSync(path.join(root, '.campaign', 'drafts')));
});

test('an English campaign gets the English heading and labels', () => {
  const root = makeRoot();
  write(root, 'campaign.yaml', CONFIG.replace('main: it', 'main: en'));
  makeMapJob(root);
  makeImageJob(root);
  const result = place(root);
  assert.equal(result.ok, true, result.message);
  const draft = DRAFT(root);
  assert.match(draft, /^## Map$/m);
  assert.ok(draft.includes('[Without grid](img/oria-brunel-map.png) · [Interactive preview]'));
  assert.ok(draft.includes('[Virtual tabletop](img/oria-brunel-map.uvtt)'));
});

test('a map job made for another document is wrong-document and writes nothing', () => {
  const root = makeRoot();
  makeMapJob(root, { document: 'Personaggi/Altro.md' });
  makeImageJob(root);
  const result = place(root);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'wrong-document');
  assert.ok(!fs.existsSync(path.join(root, 'Personaggi', 'img')));
  assert.ok(!fs.existsSync(path.join(root, '.campaign', 'drafts')));
});

test('a missing map file is missing-file and names the file', () => {
  const root = makeRoot();
  makeMapJob(root, { skip: 'grid/map-grid.png' });
  makeImageJob(root);
  const result = place(root);
  assert.equal(result.error, 'missing-file');
  assert.match(result.message, /grid\/map-grid\.png/);
  assert.ok(!fs.existsSync(path.join(root, 'Personaggi', 'img')));
});

test('a bad alt, a missing map job and a missing image job are refused', () => {
  const root = makeRoot();
  makeMapJob(root);
  makeImageJob(root);
  assert.equal(place(root, { alt: 'a]b' }).error, 'bad-alt');
  assert.equal(place(root, { alt: '  ' }).error, 'bad-alt');
  assert.equal(place(root, { mapJob: 'Nessuna' }).error, 'not-found');
  assert.equal(place(root, { mapJob: 'nessuna' }).error, 'not-found');
  assert.equal(place(root, { imageJob: 'nessuna' }).error, 'not-found');
});

test('a nav report that did not pass, or has an unreachable target, is bad-map-job and writes nothing', () => {
  const failedStatus = makeRoot();
  makeMapJob(failedStatus, { nav: navReport({ status: 'fail' }) });
  makeImageJob(failedStatus);
  assert.equal(place(failedStatus).error, 'bad-map-job');

  const unreachable = makeRoot();
  makeMapJob(unreachable, { nav: navReport({ reachable: [true, false] }) });
  makeImageJob(unreachable);
  const refused = place(unreachable);
  assert.equal(refused.error, 'bad-map-job');
  assert.match(refused.message, /1 target/);
  assert.ok(!fs.existsSync(path.join(unreachable, 'Personaggi', 'img')));
  assert.ok(!fs.existsSync(path.join(unreachable, '.campaign', 'drafts')));
});

test('the image place CLI with --kind map prints files and draft and exits 0', () => {
  const root = makeRoot();
  makeMapJob(root);
  makeImageJob(root);
  const run = spawnSync(
    process.execPath,
    [PLACE_CLI, root, '--kind', 'map', '--document', 'Personaggi/Oria Brunel.md', '--alt', 'Mappa', '--provider', 'comfyui', '--job', 'oria-brunel-map-1', '--map-job', 'oria-brunel-map-1'],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^files: .*Personaggi\/img\/oria-brunel-map\.png/m);
  assert.match(run.stdout, /^draft: Personaggi\/Oria Brunel\.md$/m);
  assert.ok(run.stdout.trimEnd().endsWith('exit: 0'));
});
