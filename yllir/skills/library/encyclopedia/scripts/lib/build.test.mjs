import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildEncyclopedia, buildDir } from './build.mjs';
import { decryptLocked } from './locked.mjs';
import { makeJpeg, makePng, sheet, campaignYaml, cleanupCampaigns } from './test-support.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../encyclopedia.mjs');
const INIT = path.resolve(HERE, '../../../new-campaign/scripts/init-campaign.mjs');
const extra = [];
after(() => {
  cleanupCampaigns();
  for (const dir of extra) fs.rmSync(dir, { recursive: true, force: true });
});

const PIER = sheet({
  id: 'porto-di-selce',
  body: '# Porto di Selce\n\n![Lanterna sul molo](img/molo.png)\n\nA grey harbour. The [ledger keeper](../Personaggi/Ilde%20Varno.md) waits. A [hidden place](../Oggetti/Nascosto.md) is plain text. [that man](../Giocatori/Traditore.md) too.',
  master: 'The pier hides a smuggler route nobody mentions.',
});
const ILDE = sheet({
  id: 'ilde-varno',
  body: '# Ilde Varno\n\nKeeps the harbour ledger.\n\n<!-- locked: diario -->\nIlde wrote that the lamp was lit on the night of the storm.\n<!-- /locked -->',
  master: '### Codici\n\n- diario: ascia-9',
  meta: ['merged_ids: [ilde-vecchia]'],
});
const LANTERN = sheet({ id: 'lanterna-ottone', body: '# Lanterna di ottone\n\n![Brass lantern](lanterna.jpg)\n\nA brass lantern.' });
const TRAITOR = sheet({ id: 'traditore', body: '# Vettore Nero\n\nThe hidden traitor of the guild.' });
const FILES = {
  'Mondo/porto.md': PIER,
  'Personaggi/Ilde Varno.md': ILDE,
  'Oggetti/Lanterna.md': LANTERN,
  'Giocatori/Traditore.md': TRAITOR,
  'Mondo/img/molo.png': makePng([['tEXt', 'Author\0Photographer Name'], ['eXIf', 'GPS']]),
  'Oggetti/lanterna.jpg': makeJpeg([[0xe1, 'Exif\0\0GPS-LOCATION'], [0xe0, 'JFIF\0']]),
};

function fixture(files = FILES, { yaml } = {}) {
  // The campaign is created with the framework's own script, then given the test structure.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-enc-init-'));
  extra.push(root);
  execFileSync(process.execPath, [INIT, root, '--name', 'Test Campaign', '--language', 'en', '--register', 'plain', '--world', 'W', '--seed', 'World seed.md'], { stdio: 'pipe' });
  fs.writeFileSync(path.join(root, 'campaign.yaml'), yaml ?? campaignYaml({ extra: 'encyclopedia:\n  title: "Atlas of Test"\n  base_url: "http://localhost:8080/c"' }));
  fs.writeFileSync(path.join(root, 'World seed.md'), '# World seed\n\nThe year 312 is a lie.\n');
  fs.writeFileSync(path.join(root, '.campaign', 'retired-ids.json'), '{ "ids": ["vecchio-porto"] }\n');
  for (const folder of ['Mondo', 'Personaggi', 'Oggetti', 'Varie', 'Giocatori', 'Fonti']) fs.mkdirSync(path.join(root, folder), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

function listAll(dir, base = dir) {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, listAll(full, base));
    else out[path.relative(base, full).split(path.sep).join('/')] = fs.readFileSync(full).toString('base64');
  }
  return out;
}

test('a full build of a campaign made by init-campaign passes every check and writes the whole site', async () => {
  const root = fixture();
  const report = await buildEncyclopedia(root);
  assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => c.status === 'fail')));
  assert.equal(report.entries, 3);
  assert.deepEqual(report.checks.map((c) => c.id).sort(), [
    'change-summary', 'locked-codes', 'locked-roundtrip', 'no-image-metadata', 'no-master-links',
    'no-private-folders', 'no-reserved-text', 'no-player-references', 'no-secret-shapes', 'real-player-names',
  ].sort());
  assert.equal(report.baseUrl, 'http://localhost:8080/c/');
  assert.equal(report.previewUrl, '/enc/');
  const dir = buildDir(root);
  for (const file of ['index.html', '404.html', 'search.json', 'report.json', 'assets/site.css', 'assets/site.js',
    'e/porto-di-selce/index.html', 'e/ilde-varno/index.html', 'e/lanterna-ottone/index.html', 'e/ilde-vecchia/index.html', 'e/vecchio-porto/index.html']) {
    assert.ok(fs.existsSync(path.join(dir, file)), file);
  }
  assert.equal(fs.readdirSync(path.join(root, '.campaign', 'cache')).some((n) => n.includes('tmp-')), false);
});

test('the reserved text, the hidden title, the codes and the locked plain text never appear in any file', async () => {
  const root = fixture();
  assert.equal((await buildEncyclopedia(root)).ok, true);
  const dir = buildDir(root);
  const everything = Object.values(listAll(dir)).map((b64) => Buffer.from(b64, 'base64').toString('latin1')).join('\n');
  for (const secret of ['smuggler', 'Vettore', 'hidden traitor', 'ascia-9', 'lamp was lit', 'Photographer', 'GPS', '312', 'Master', '<!-- master']) {
    assert.equal(everything.includes(secret), false, secret);
  }
  const hiddenMaster = fs.readFileSync(path.join(dir, 'e/porto-di-selce/index.html'), 'utf8');
  assert.equal(hiddenMaster.includes('Nascosto'), false);
});

test('a locked text opens with its code, through the same data the page stores', async () => {
  const root = fixture();
  assert.equal((await buildEncyclopedia(root)).ok, true);
  const html = fs.readFileSync(path.join(buildDir(root), 'e/ilde-varno/index.html'), 'utf8');
  const attrs = /data-label="diario" data-salt="([^"]+)" data-iv="([^"]+)" data-cipher="([^"]+)"/.exec(html);
  assert.ok(attrs, 'the locked block is written');
  const plain = await decryptLocked({ code: 'ascia-9', salt: attrs[1], iv: attrs[2], cipher: attrs[3] });
  assert.match(plain, /lamp was lit/);
  await assert.rejects(decryptLocked({ code: 'ascia-0', salt: attrs[1], iv: attrs[2], cipher: attrs[3] }));
});

test('the same inputs give the same files: two builds at the same instant are identical', async () => {
  const root = fixture();
  process.env.YLLIR_NOW = '2026-11-12T10:00:00.000Z';
  try {
    await buildEncyclopedia(root);
    const first = listAll(buildDir(root));
    await buildEncyclopedia(root);
    const second = listAll(buildDir(root));
    await buildEncyclopedia(root);
    const third = listAll(buildDir(root));
    assert.deepEqual(second, third, 'a rebuild over an identical previous build is identical in every file');
    const differing = Object.keys(first).filter((k) => first[k] !== second[k]);
    assert.deepEqual(differing, ['report.json'], 'only the change summary differs from the first build');
  } finally {
    delete process.env.YLLIR_NOW;
  }
});

test('a failed build leaves the previous build untouched and no temporary folder behind', async () => {
  const root = fixture();
  assert.equal((await buildEncyclopedia(root)).ok, true);
  const before = listAll(buildDir(root));
  fs.writeFileSync(path.join(root, 'Mondo/porto.md'), PIER.replace('A grey harbour.', 'A grey harbour where Vettore Nero hides.'));
  const failed = await buildEncyclopedia(root);
  assert.equal(failed.ok, false);
  assert.equal(failed.checks.find((c) => c.id === 'no-reserved-text').status, 'fail');
  assert.deepEqual(listAll(buildDir(root)), before, 'the saved build is exactly as before');
  const cache = fs.readdirSync(path.join(root, '.campaign', 'cache'));
  assert.deepEqual(cache.filter((n) => n.includes('tmp-') || n.includes('.old-')), []);
  assert.equal(failed.previewUrl, '/enc/', 'the previous build is still previewable');
});

test('a merged id redirects to its survivor, and a retired id with no survivor gets a plain page', async () => {
  const root = fixture();
  assert.equal((await buildEncyclopedia(root)).ok, true);
  const dir = buildDir(root);
  const redirect = fs.readFileSync(path.join(dir, 'e/ilde-vecchia/index.html'), 'utf8');
  assert.match(redirect, /<meta http-equiv="refresh" content="0; url=\.\.\/\.\.\/e\/ilde-varno\/">/);
  assert.match(redirect, /<a href="\.\.\/\.\.\/e\/ilde-varno\/">Ilde Varno<\/a>/);
  const gone = fs.readFileSync(path.join(dir, 'e/vecchio-porto/index.html'), 'utf8');
  assert.match(gone, /no longer available/);
  assert.equal(gone.includes('http-equiv="refresh"'), false);
});

test('every page is served under a strict CSP: no inline script, no style attribute, no javascript links', async () => {
  const root = fixture();
  assert.equal((await buildEncyclopedia(root)).ok, true);
  const dir = buildDir(root);
  const pages = Object.keys(listAll(dir)).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 5);
  for (const page of pages) {
    const html = fs.readFileSync(path.join(dir, page), 'utf8');
    assert.equal(/<script(?![^>]*\bsrc=)/i.test(html), false, `${page}: inline script`);
    assert.equal(/<style/i.test(html), false, `${page}: style element`);
    assert.equal(/\sstyle=/i.test(html), false, `${page}: style attribute`);
    assert.equal(/javascript:|data:/i.test(html), false, `${page}: script or data link`);
    assert.equal(/href="[^"]*#master/i.test(html), false, `${page}: master link`);
  }
});

test('the index lists entries by category with a filter box; the picture is copied without metadata', async () => {
  const root = fixture();
  assert.equal((await buildEncyclopedia(root)).ok, true);
  const dir = buildDir(root);
  const index = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(index, /<input id="filter"/);
  assert.match(index, /<h2 id="cat-0">Luoghi<\/h2>/);
  assert.match(index, /<a href="e\/porto-di-selce\/">Porto di Selce<\/a>/);
  const search = JSON.parse(fs.readFileSync(path.join(dir, 'search.json'), 'utf8'));
  assert.deepEqual(search.map((s) => s.id), ['porto-di-selce', 'ilde-varno', 'lanterna-ottone']);
  assert.equal(search.some((s) => s.text.includes('lamp was lit')), false);
  const images = fs.readdirSync(path.join(dir, 'assets/img'));
  assert.equal(images.length, 2);
  for (const name of images) {
    const bytes = fs.readFileSync(path.join(dir, 'assets/img', name));
    assert.equal(bytes.includes(Buffer.from('GPS')) || bytes.includes(Buffer.from('Photographer')), false, name);
  }
});

test('Italian campaigns get Italian pages and messages', async () => {
  const root = fixture(FILES, { yaml: campaignYaml({ lang: 'it', extra: 'encyclopedia:\n  title: "Atlante"' }) });
  const report = await buildEncyclopedia(root);
  assert.equal(report.ok, true);
  assert.match(fs.readFileSync(path.join(buildDir(root), 'index.html'), 'utf8'), /lang="it"/);
  assert.match(fs.readFileSync(path.join(buildDir(root), 'e/ilde-vecchia/index.html'), 'utf8'), /unita a/);
});

test('a module that is off, or a broken configuration, refuses the build with a plain message', async () => {
  const off = fixture(FILES, { yaml: campaignYaml({ encyclopedia: false }) });
  const offReport = await buildEncyclopedia(off);
  assert.equal(offReport.ok, false);
  assert.equal(offReport.checks[0].id, 'module');
  const broken = fixture(FILES, { yaml: 'schema: 2\n' });
  assert.equal((await buildEncyclopedia(broken)).ok, false);
});

test('CLI: build exits 0 and prints the report, a refused build exits 1, status reads the saved build, usage exits 2', () => {
  const root = fixture();
  const status0 = spawnSync(process.execPath, [CLI, 'status', root], { encoding: 'utf8' });
  assert.equal(status0.status, 0);
  assert.match(status0.stdout, /"built": false/);
  assert.match(status0.stdout.trimEnd(), /exit: 0$/);

  const built = spawnSync(process.execPath, [CLI, 'build', root], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stdout);
  assert.match(built.stdout.trimEnd(), /exit: 0$/);
  const report = JSON.parse(built.stdout.replace(/exit: \d+\n?$/, ''));
  assert.equal(report.ok, true);

  const status1 = spawnSync(process.execPath, [CLI, 'status', root], { encoding: 'utf8' });
  assert.match(status1.stdout, /"built": true/);

  fs.writeFileSync(path.join(root, 'Mondo/porto.md'), PIER.replace('A grey harbour.', 'A grey harbour, sk-abcdefghijklmnopqrstuv.'));
  const refused = spawnSync(process.execPath, [CLI, 'build', root], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stdout.trimEnd(), /exit: 1$/);

  const usage = spawnSync(process.execPath, [CLI, 'publish', root], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  const noArgs = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(noArgs.status, 2);
});
