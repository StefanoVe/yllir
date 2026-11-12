import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildJob, joinPrompt, placeImage, slugify, subjectDescription } from './image-job.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_CLI = path.join(HERE, '..', 'image-prompt.mjs');
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
---
# Oria Brunel

## Aspetto

Una giovane cartografa dai capelli rossi, con un mantello verde scuro.

## Ruolo

Traccia le strade del [borgo](Mondo/borgo.md).

| Oggetto | Nota |
| --- | --- |
| Bussola | d'ottone |

<!-- master -->
## Master

Segreto: SEGRETO-7731 e il codice del suo rifugio.
<!-- /master -->
`;

const STYLE_PROMPT = 'Ritratto a figura intera, stile acquerello su carta antica. {SUBJECT_DESCRIPTION}\n';

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function makeCampaign() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-image-job-'));
  tmpDirs.push(root);
  write(root, 'campaign.yaml', CONFIG);
  write(root, 'Seme del mondo.md', 'Il mondo nasconde SEGRETO-7731 sotto la valle.\n');
  write(root, 'Personaggi/Oria Brunel.md', SHEET);
  write(root, 'Giocatori/Lino.md', '# Lino\n\nUn giocatore.\n\n<!-- master -->\nSEGRETO-7731\n<!-- /master -->\n');
  write(root, '.campaign/styles/base/profile.yaml', 'id: base\nnegative: "testo, filigrana"\nwidth: 1024\nheight: 1024\n');
  write(root, '.campaign/styles/base/prompt.md', STYLE_PROMPT);
  return root;
}

function makeInbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-image-inbox-'));
  tmpDirs.push(dir);
  return dir;
}

/** Simulates the runner: writes result.png and run.json into a job folder. */
function fakeRunOutput(root, jobDir, parameters = { width: 1024, height: 1024 }) {
  fs.writeFileSync(path.join(jobDir, 'result.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(jobDir, 'run.json'), JSON.stringify({ provider: 'comfyui', parameters }));
  return root;
}

function sidecarKeys(text) {
  return text
    .split('\n')
    .filter((line) => /^[a-z_]+:/.test(line))
    .map((line) => line.split(':')[0]);
}

test('generate job carries the public text and the style, never master-only text', () => {
  const root = makeCampaign();
  const result = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate' });
  assert.equal(result.ok, true);
  assert.equal(result.jobId, 'oria-brunel-generate-1');
  assert.match(result.job.prompt, /cartografa dai capelli rossi/);
  assert.match(result.job.prompt, /stile acquerello su carta antica/);
  assert.equal(result.job.negative, 'testo, filigrana');
  assert.equal(result.job.width, 1024);
  assert.equal(result.job.height, 1024);
  assert.equal(result.job.style, 'base');
  assert.equal(result.job.input, null);
  assert.equal(result.job.document, 'Personaggi/Oria Brunel.md');
  assert.equal(typeof result.job.seed, 'number');
  const text = fs.readFileSync(path.join(result.jobDir, 'job.json'), 'utf8');
  assert.ok(text.endsWith('\n'));
  assert.ok(!text.includes('SEGRETO-7731'));
  assert.ok(!text.includes('Segreto'));
});

test('the world seed is refused as not public', () => {
  const root = makeCampaign();
  const result = buildJob({ root, document: 'Seme del mondo.md', operation: 'generate' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not-public');
  assert.ok(!fs.existsSync(path.join(root, '.campaign', 'state', 'images')));
});

test('a document in a master-only folder is refused as not public', () => {
  const root = makeCampaign();
  const result = buildJob({ root, document: 'Giocatori/Lino.md', operation: 'generate' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not-public');
});

test('a missing document is not-found', () => {
  const root = makeCampaign();
  const result = buildJob({ root, document: 'Personaggi/Nessuno.md', operation: 'generate' });
  assert.equal(result.error, 'not-found');
});

test('a missing style folder is no-style', () => {
  const root = makeCampaign();
  fs.rmSync(path.join(root, '.campaign', 'styles'), { recursive: true, force: true });
  const result = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no-style');
});

test('a prompt without the placeholder is bad-style', () => {
  const root = makeCampaign();
  write(root, '.campaign/styles/base/prompt.md', 'Solo testo, senza segnaposto.\n');
  const result = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate' });
  assert.equal(result.error, 'bad-style');
});

test('a second job of the same document gets -2', () => {
  const root = makeCampaign();
  const first = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate' });
  const second = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate' });
  assert.equal(first.jobId, 'oria-brunel-generate-1');
  assert.equal(second.jobId, 'oria-brunel-generate-2');
  assert.ok(fs.existsSync(path.join(second.jobDir, 'job.json')));
});

test('a request of 301 characters is refused', () => {
  const root = makeCampaign();
  const result = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate', request: 'x'.repeat(301) });
  assert.equal(result.error, 'request-too-long');
});

test('a request is appended to the prompt', () => {
  const root = makeCampaign();
  const result = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate', request: 'sfondo notturno' });
  assert.equal(result.ok, true);
  assert.match(result.job.prompt, /\. sfondo notturno$/);
});

test('placing a job writes the image, the sidecar and the draft with the embed under the title', () => {
  const root = makeCampaign();
  const job = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate' });
  fakeRunOutput(root, job.jobDir);
  const result = placeImage({
    root,
    document: 'Personaggi/Oria Brunel.md',
    alt: 'Ritratto di Oria Brunel',
    jobId: job.jobId,
    provider: 'comfyui',
    review: 'Sembra giusto',
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.image, 'Personaggi/img/oria-brunel.png');
  assert.equal(result.sidecar, 'Personaggi/img/oria-brunel.yaml');
  assert.equal(result.draft, 'Personaggi/Oria Brunel.md');
  assert.ok(fs.existsSync(path.join(root, 'Personaggi', 'img', 'oria-brunel.png')));

  const sidecar = fs.readFileSync(path.join(root, 'Personaggi', 'img', 'oria-brunel.yaml'), 'utf8');
  assert.deepEqual(sidecarKeys(sidecar), ['provider', 'operation', 'document', 'effective_prompt', 'references', 'parameters', 'review']);
  assert.ok(sidecar.includes(`effective_prompt: ${JSON.stringify(job.job.prompt)}`));
  assert.ok(sidecar.includes('parameters:\n  width: 1024\n  height: 1024\n'));
  assert.ok(sidecar.includes('review: "Sembra giusto"'));
  assert.ok(!sidecar.includes('SEGRETO-7731'));

  const draft = fs.readFileSync(path.join(root, '.campaign', 'drafts', 'Personaggi', 'Oria Brunel.md'), 'utf8');
  const expected = SHEET.replace('# Oria Brunel\n', '# Oria Brunel\n\n![Ritratto di Oria Brunel](img/oria-brunel.png)\n');
  assert.equal(draft, expected);
});

test('the sidecar parameters parse with parseYamlLite as a block mapping', () => {
  const root = makeCampaign();
  const job = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate' });
  fakeRunOutput(root, job.jobDir, { width: 1024, height: 1024 });
  const placed = placeImage({ root, document: 'Personaggi/Oria Brunel.md', alt: 'Ritratto', jobId: job.jobId, provider: 'comfyui' });
  assert.equal(placed.ok, true, placed.message);

  const sidecar = fs.readFileSync(path.join(root, 'Personaggi', 'img', 'oria-brunel.yaml'), 'utf8');
  const parsed = parseYamlLite(sidecar);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data.parameters.width, 1024);
  assert.equal(parsed.data.parameters.height, 1024);
  assert.equal(parsed.data.provider, 'comfyui');
  assert.equal(parsed.data.review, '');
});

test('placing again gives -2 and the draft keeps one embed', () => {
  const root = makeCampaign();
  const job = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate' });
  fakeRunOutput(root, job.jobDir);
  const base = { root, document: 'Personaggi/Oria Brunel.md', alt: 'Ritratto', jobId: job.jobId, provider: 'comfyui' };
  placeImage(base);
  const second = placeImage(base);
  assert.equal(second.ok, true);
  assert.equal(second.image, 'Personaggi/img/oria-brunel-2.png');
  assert.equal(second.sidecar, 'Personaggi/img/oria-brunel-2.yaml');
  const draft = fs.readFileSync(path.join(root, '.campaign', 'drafts', 'Personaggi', 'Oria Brunel.md'), 'utf8');
  assert.equal(draft.split('](img/').length - 1, 1);
  assert.ok(draft.includes('![Ritratto](img/oria-brunel-2.png)'));
});

test('an upload keeps its extension, has no effective prompt and gets a free name', () => {
  const root = makeCampaign();
  const inbox = makeInbox();
  const photo = path.join(inbox, 'photo.jpg');
  fs.writeFileSync(photo, Buffer.from([0xff, 0xd8, 0xff]));
  const job = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate' });
  fakeRunOutput(root, job.jobDir);
  placeImage({ root, document: 'Personaggi/Oria Brunel.md', alt: 'Ritratto', jobId: job.jobId, provider: 'comfyui' });
  placeImage({ root, document: 'Personaggi/Oria Brunel.md', alt: 'Ritratto', jobId: job.jobId, provider: 'comfyui' });

  const result = placeImage({ root, document: 'Personaggi/Oria Brunel.md', alt: 'Foto', file: photo, provider: 'upload' });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.image, 'Personaggi/img/oria-brunel-3.jpg');
  const sidecar = fs.readFileSync(path.join(root, 'Personaggi', 'img', 'oria-brunel-3.yaml'), 'utf8');
  assert.ok(sidecar.includes('provider: "upload"'));
  assert.ok(sidecar.includes('operation: "upload"'));
  assert.ok(sidecar.includes('effective_prompt: null'));
  const draft = fs.readFileSync(path.join(root, '.campaign', 'drafts', 'Personaggi', 'Oria Brunel.md'), 'utf8');
  assert.ok(draft.includes('![Foto](img/oria-brunel-3.jpg)'));
  assert.equal(draft.split('](img/').length - 1, 1);
});

test('an upload of a .gif is bad-format', () => {
  const root = makeCampaign();
  const inbox = makeInbox();
  const gif = path.join(inbox, 'anim.gif');
  fs.writeFileSync(gif, 'GIF89a');
  const result = placeImage({ root, document: 'Personaggi/Oria Brunel.md', alt: 'Animazione', file: gif, provider: 'upload' });
  assert.equal(result.error, 'bad-format');
});

test('an empty alt or one with ] is bad-alt', () => {
  const root = makeCampaign();
  const inbox = makeInbox();
  const photo = path.join(inbox, 'photo.png');
  fs.writeFileSync(photo, 'PNG');
  assert.equal(placeImage({ root, document: 'Personaggi/Oria Brunel.md', alt: '  ', file: photo, provider: 'upload' }).error, 'bad-alt');
  assert.equal(placeImage({ root, document: 'Personaggi/Oria Brunel.md', alt: 'a]b', file: photo, provider: 'upload' }).error, 'bad-alt');
});

test('remove_background needs an existing image and places a -no-background file without draft', () => {
  const root = makeCampaign();
  assert.equal(
    buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'remove_background' }).error,
    'no-image',
  );
  write(root, 'Personaggi/img/oria-brunel.png', 'PNG');

  const job = buildJob({
    root,
    document: 'Personaggi/Oria Brunel.md',
    operation: 'remove_background',
    image: 'Personaggi/img/oria-brunel.png',
  });
  assert.equal(job.ok, true, job.message);
  assert.equal(job.jobId, 'oria-brunel-remove-background-1');
  assert.equal(job.job.prompt, '');
  assert.equal(job.job.style, null);
  assert.equal(job.job.input, path.join(root, 'Personaggi', 'img', 'oria-brunel.png'));

  fakeRunOutput(root, job.jobDir, {});
  const placed = placeImage({
    root,
    document: 'Personaggi/Oria Brunel.md',
    alt: 'Ritratto senza sfondo',
    jobId: job.jobId,
    provider: 'comfyui',
  });
  assert.equal(placed.ok, true, placed.message);
  assert.equal(placed.image, 'Personaggi/img/oria-brunel-no-background.png');
  assert.equal(placed.draft, null);
  assert.ok(fs.existsSync(path.join(root, 'Personaggi', 'img', 'oria-brunel-no-background.yaml')));
  assert.ok(!fs.existsSync(path.join(root, '.campaign', 'drafts')));
});

test('slugify', () => {
  assert.equal(slugify('Oria Brunel'), 'oria-brunel');
  assert.equal(slugify('Città d’Ombra'), 'citta-d-ombra');
});

test('subjectDescription drops images, comments and tables and keeps the words', () => {
  const text = '# Titolo\n\n![ritratto](img/a.png)\n\nVive a [Borgo](Mondo/b.md).\n<!-- nota -->\n| a | b |\n| - | - |\n\nFine.';
  assert.equal(subjectDescription(text), 'Titolo Vive a Borgo. Fine.');
  assert.equal(subjectDescription('uno due tre quattro', 10), 'uno due');
});

test('the prompt CLI prints the job and never the prompt text', () => {
  const root = makeCampaign();
  const run = spawnSync(process.execPath, [PROMPT_CLI, root, '--document', 'Personaggi/Oria Brunel.md', '--operation', 'generate'], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^job: oria-brunel-generate-1\n/m);
  assert.ok(run.stdout.trimEnd().endsWith('exit: 0'));
  assert.ok(!run.stdout.includes('acquerello'));
  assert.ok(!run.stdout.includes('cartografa'));
});

test('both CLIs with no arguments print usage and exit 2', () => {
  for (const cli of [PROMPT_CLI, PLACE_CLI]) {
    const run = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.match(run.stdout, /exit: 2\n$/);
    assert.match(run.stderr, /usage:/);
  }
});

const MAP_PROMPT = 'Mappa di battaglia pulita, nessuna prospettiva. {SUBJECT_DESCRIPTION}\n';

function addMapStyle(root) {
  write(root, '.campaign/styles/map/profile.yaml', 'id: map\nnegative: "testo, griglia, prospettiva"\nwidth: 512\nheight: 512\n');
  write(root, '.campaign/styles/map/prompt.md', MAP_PROMPT);
}

test('a map job uses the map style, the fixed request and the grid size, never master-only text', () => {
  const root = makeCampaign();
  addMapStyle(root);
  const result = buildJob({
    root,
    document: 'Personaggi/Oria Brunel.md',
    operation: 'generate',
    purpose: 'map',
    cells: { cols: 24, rows: 16 },
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.jobId, 'oria-brunel-map-1');
  assert.equal(result.job.style, 'map');
  assert.equal(result.job.purpose, 'map');
  assert.deepEqual(result.job.cells, { cols: 24, rows: 16 });
  assert.equal(result.job.reference, null);
  assert.equal(result.job.width, 1536);
  assert.equal(result.job.height, 1024);
  assert.equal(result.job.negative, 'testo, griglia, prospettiva');
  assert.match(result.job.prompt, /^Mappa di battaglia pulita/);
  assert.match(result.job.prompt, /cartografa dai capelli rossi/);
  assert.match(result.job.prompt, /Top-down orthographic battle map seen from directly above/);
  assert.match(result.job.prompt, /The area is 24 squares wide and 16 squares tall;/);
  assert.ok(!result.job.prompt.includes('SEGRETO'));
  const onDisk = JSON.parse(fs.readFileSync(path.join(result.jobDir, 'job.json'), 'utf8'));
  assert.equal(onDisk.purpose, 'map');
  assert.deepEqual(onDisk.cells, { cols: 24, rows: 16 });
  assert.ok(!JSON.stringify(onDisk).includes('SEGRETO'));
});

test('a tall map gets the height of 1536 and the width from the grid', () => {
  const root = makeCampaign();
  addMapStyle(root);
  const result = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate', purpose: 'map', cells: { cols: 16, rows: 24 } });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.job.width, 1024);
  assert.equal(result.job.height, 1536);
});

test('a map job without the map style is no-style', () => {
  const root = makeCampaign();
  const result = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate', purpose: 'map', cells: { cols: 24, rows: 16 } });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no-style');
  assert.match(result.message, /map/);
});

test('a map job with cells outside 8..60 is bad-cells', () => {
  const root = makeCampaign();
  addMapStyle(root);
  for (const cells of [{ cols: 7, rows: 10 }, { cols: 10, rows: 61 }, { cols: 10.5, rows: 10 }, null]) {
    const result = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate', purpose: 'map', cells });
    assert.equal(result.error, 'bad-cells');
  }
});

test('a map job only supports generate', () => {
  const root = makeCampaign();
  addMapStyle(root);
  const result = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'remove_background', purpose: 'map', cells: { cols: 24, rows: 16 } });
  assert.equal(result.error, 'bad-operation');
});

test('a map reference outside the maps folder is bad-reference, one inside is kept', () => {
  const root = makeCampaign();
  addMapStyle(root);
  const inbox = makeInbox();
  const plan = path.join(inbox, 'plan.png');
  fs.writeFileSync(plan, 'PNG');
  const outside = buildJob({
    root,
    document: 'Personaggi/Oria Brunel.md',
    operation: 'generate',
    purpose: 'map',
    cells: { cols: 24, rows: 16 },
    reference: plan,
  });
  assert.equal(outside.error, 'bad-reference');

  const inside = path.join(root, '.campaign', 'state', 'maps', 'plan-map', 'plan.png');
  write(root, '.campaign/state/maps/plan-map/plan.png', 'PNG');
  const ok = buildJob({
    root,
    document: 'Personaggi/Oria Brunel.md',
    operation: 'generate',
    purpose: 'map',
    cells: { cols: 24, rows: 16 },
    reference: inside,
  });
  assert.equal(ok.ok, true, ok.message);
  assert.equal(ok.job.reference, inside);
});

test('an image job is marked purpose image with no reference', () => {
  const root = makeCampaign();
  const result = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate' });
  assert.equal(result.job.purpose, 'image');
  assert.equal(result.job.reference, null);
  assert.equal(result.job.cells, undefined);
});

test('the image prompt CLI takes --purpose map with --cells and refuses invalid combinations with usage', () => {
  const root = makeCampaign();
  addMapStyle(root);
  const run = spawnSync(
    process.execPath,
    [PROMPT_CLI, root, '--document', 'Personaggi/Oria Brunel.md', '--operation', 'generate', '--purpose', 'map', '--cells', '24x16'],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^job: oria-brunel-map-1\n/m);
  assert.ok(!run.stdout.includes('Top-down'));

  const noCells = spawnSync(
    process.execPath,
    [PROMPT_CLI, root, '--document', 'Personaggi/Oria Brunel.md', '--operation', 'generate', '--purpose', 'map'],
    { encoding: 'utf8' },
  );
  assert.equal(noCells.status, 2);
  const cellsOnImage = spawnSync(
    process.execPath,
    [PROMPT_CLI, root, '--document', 'Personaggi/Oria Brunel.md', '--operation', 'generate', '--cells', '24x16'],
    { encoding: 'utf8' },
  );
  assert.equal(cellsOnImage.status, 2);
});

test('the prompt has no newline before a period and no double period, for image and map jobs', () => {
  const root = makeCampaign();
  addMapStyle(root);
  const image = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate', request: 'sfondo notturno.' });
  const map = buildJob({
    root,
    document: 'Personaggi/Oria Brunel.md',
    operation: 'generate',
    purpose: 'map',
    cells: { cols: 24, rows: 16 },
    request: 'rovine.',
  });
  const bare = buildJob({ root, document: 'Personaggi/Oria Brunel.md', operation: 'generate' });
  for (const result of [image, map, bare]) {
    assert.equal(result.ok, true, result.message);
    assert.ok(!result.job.prompt.includes('\n.'), result.job.prompt);
    assert.ok(!result.job.prompt.includes('..'), result.job.prompt);
    assert.ok(!result.job.prompt.includes('\n'), result.job.prompt);
  }
  assert.match(image.job.prompt, /acquerello su carta antica\. Oria Brunel/);
  assert.match(image.job.prompt, /\. sfondo notturno$/);
  assert.match(map.job.prompt, /\. rovine\. Top-down orthographic/);
  assert.match(map.job.prompt, /squares wide and 16 squares tall;/);
  assert.match(map.job.prompt, /follow the attached plan when one is attached\.$/);
  assert.equal(bare.job.prompt.endsWith('\n'), false);
});

test('joinPrompt trims the style text and removes its final period before appending', () => {
  assert.equal(joinPrompt('Stile pulito. Dalla breccia.\n', ['Top-down.']), 'Stile pulito. Dalla breccia. Top-down.');
  assert.equal(joinPrompt('Stile pulito.\n', []), 'Stile pulito.');
  assert.equal(joinPrompt('Stile.\n', ['  ', '']), 'Stile.');
});
