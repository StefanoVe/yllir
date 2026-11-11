import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planGeographicLayout, applyGeographicLayout } from './geographic-layout.mjs';

function fixture({ language = 'en' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-geo-'));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), [
    'language:', `  main: ${language}`, 'structure:',
    '  - id: plot', '    type: plot', '    folder: Plot',
    '  - id: places', '    type: places', '    folder: World',
    '  - id: people', '    type: subjects', '    folder: People',
    '  - id: objects', '    type: objects', '    folder: Objects',
  ].join('\n') + '\n');
  const put = (rel, body) => { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
  const place = (id, title) => `---\nid: ${id}\n---\n# ${title}\n`;
  put('World/World.md', place('world', 'World'));
  put('World/World/Coast/Coast.md', place('coast', 'Coast'));
  put('World/World/Coast/Port.md', place('port', 'Port'));
  put('World/World/Coast/Market.md', place('market', 'Market'));
  put('People/Ada.md', '---\nid: ada\nlocation: [port, market]\n---\n# Ada\n[Coast](../World/World/Coast/Coast.md)\n![map](img/portrait.png)\n');
  put('Objects/Relic.md', '---\nid: relic\nlocation: [port]\n---\n# Relic\n');
  put('Plot/Session 1/Event.md', '---\nid: arrival\nappearances:\n  - subject: ada\n    location: [port]\n  - subject: relic\n    location: [market]\n---\n# Arrival\n');
  put('People/img/portrait.png', 'image');
  return { root, put };
}

function cleanup(root) { fs.rmSync(root, { recursive: true, force: true }); }

test('plans common-ancestor canonical sheets, precise subject views, event views, and rewrites relative assets', () => {
  const { root } = fixture();
  try {
    const plan = planGeographicLayout(root);
    assert.equal(plan.status, 'ready', JSON.stringify(plan.errors));
    assert.deepEqual(plan.moves.map((m) => [m.from, m.to]), [
      ['Objects/Relic.md', 'Objects/World/Coast/Relic.md'],
      ['People/Ada.md', 'People/World/Coast/Ada.md'],
    ]);
    assert.equal(plan.pathMap['People/Ada.md'], 'People/World/Coast/Ada.md');
    assert.equal(plan.pathMap['Objects/Relic.md'], 'Objects/World/Coast/Relic.md');
    assert(plan.links.some((l) => l.path === 'People/World/Coast/Port/Ada.md'));
    assert(plan.links.some((l) => l.path === 'Plot/By location/World/Coast/Port/arrival.md'));
    const rewrite = plan.rewrites.find((r) => r.file === 'People/World/Coast/Ada.md');
    assert.match(rewrite.content, /\(\.\.\/\.\.\/\.\.\/World\/World\/Coast\/Coast\.md\)/);
    assert.match(rewrite.content, /\.\.\/\.\.\/img\/portrait\.png/);
    const applied = applyGeographicLayout(root, plan, { files: ['People/Ada.md', 'Objects/Relic.md', 'People/Ada.md'] });
    assert.equal(applied.status, 'applied', JSON.stringify(applied.errors));
    assert.deepEqual(applied.finalFiles, ['People/World/Coast/Ada.md', 'Objects/World/Coast/Relic.md']);
    assert.deepEqual(applied.changedFiles, ['Objects/World/Coast/Relic.md', 'People/World/Coast/Ada.md']);
    assert.equal(fs.readFileSync(path.join(root, 'People/World/Coast/Ada.md'), 'utf8'), rewrite.content);
    assert.equal(fs.readFileSync(path.join(root, 'People/img/portrait.png'), 'utf8'), 'image');
    const again = planGeographicLayout(root);
    assert.equal(again.status, 'ready', JSON.stringify(again.errors));
    assert.equal(again.migrationRequired, false);
    assert.equal(applyGeographicLayout(root, again).status, 'applied');
  } finally { cleanup(root); }
});

test('a stale snapshot rejects the entire plan before changing files', () => {
  const { root } = fixture();
  try {
    const plan = planGeographicLayout(root);
    fs.appendFileSync(path.join(root, 'People/Ada.md'), 'new\n');
    const result = applyGeographicLayout(root, plan);
    assert.equal(result.status, 'rejected');
    assert(fs.existsSync(path.join(root, 'People/Ada.md')));
    assert(!fs.existsSync(path.join(root, 'People/World/Coast/Ada.md')));
  } finally { cleanup(root); }
});

test('missing location ids and unowned view collisions block planning', () => {
  const { root, put } = fixture();
  try {
    put('Objects/Relic.md', '---\nid: relic\nlocation: [missing]\n---\n# Relic\n');
    assert.equal(planGeographicLayout(root).status, 'blocked');
    put('Objects/Relic.md', '---\nid: relic\nlocation: [port]\n---\n# Relic\n');
    put('People/World/Coast/Port/Ada.md', 'someone elses file');
    assert.equal(planGeographicLayout(root).status, 'blocked');
  } finally { cleanup(root); }
});

test('new-sheet overlay is planned against expected post-draft content', () => {
  const { root } = fixture();
  try {
    const content = '---\nid: new-person\nlocation: [port]\n---\n# New Person\n';
    const plan = planGeographicLayout(root, { overlayFiles: [{ path: 'People/New.md', content }] });
    assert.equal(plan.status, 'ready', JSON.stringify(plan.errors));
    assert(plan.moves.some((m) => m.from === 'People/New.md' && m.to === 'People/World/Coast/Port/New.md'));
    fs.writeFileSync(path.join(root, 'People/New.md'), content);
    assert.equal(applyGeographicLayout(root, plan).status, 'applied');
    assert(fs.existsSync(path.join(root, 'People/World/Coast/Port/New.md')));
  } finally { cleanup(root); }
});

test('italian campaign uses localized unplaced and by-location folders, and replanning is clean', () => {
  const { root, put } = fixture({ language: 'it' });
  try {
    put('Objects/Stone.md', '---\nid: stone\n---\n# Stone\n');
    const plan = planGeographicLayout(root);
    assert.equal(plan.status, 'ready', JSON.stringify(plan.errors));
    assert(plan.moves.some((m) => m.from === 'Objects/Stone.md' && m.to === 'Objects/Da collocare/Stone.md'));
    assert(plan.links.some((l) => l.path === 'Plot/Per luogo/World/Coast/Port/arrival.md'));
    assert(!plan.links.some((l) => l.path.includes('By location')));
    const applied = applyGeographicLayout(root, plan);
    assert.equal(applied.status, 'applied', JSON.stringify(applied.errors));
    assert(fs.existsSync(path.join(root, 'Objects/Da collocare/Stone.md')));
    assert(fs.lstatSync(path.join(root, 'Plot/Per luogo/World/Coast/Port/arrival.md')).isSymbolicLink());
    const again = planGeographicLayout(root);
    assert.equal(again.status, 'ready', JSON.stringify(again.errors));
    assert.equal(again.migrationRequired, false);
    assert.equal(applyGeographicLayout(root, again).status, 'applied');
  } finally { cleanup(root); }
});
