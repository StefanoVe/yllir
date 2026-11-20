import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as model from './model.mjs';
import {
  PROVENANCES, VISIBILITIES, SCOPE_KINDS, ICONS, LABEL_GROUPS, readAtlas, manifestProblems, labelsProblems,
  validateAtlas,
} from './model.mjs';
import {
  cleanupCampaigns, makeCampaign, standardCampaign, baseManifest, emptyLabels, writeAtlas, square, MASTER,
  STRUCTURE, campaignYaml,
} from './test-support.mjs';

after(cleanupCampaigns);

const CANVAS = { width: 1000, height: 1000 };
const INDEX = {
  subjects: [
    { id: 'north', kind: 'place', file: 'World/North/North.md' },
    { id: 'mara', kind: 'character', file: 'People/Mara.md' },
  ],
};

/** A labels object with one item of every kind, all valid for CANVAS and INDEX. */
function fullLabels() {
  return emptyLabels({
    lands: [{ id: 'l1', text: 'Nord', x: 700, y: 300, size: 34, provenance: 'document', sources: [{ file: 'Mondo/Mondo.md', section: 'Geografia' }], visibility: 'public' }],
    regions: [{ id: 'r1', text: 'Regno di X', x: 600, y: 500, size: 22, territory: 't1', ...MASTER }],
    nature: [{ id: 'n1', text: 'Lago Grigio', x: 800, y: 520, size: 16, ...MASTER }],
    places: [{ id: 'p1', place: 'north', x: 810, y: 640, kind: 'town', ...MASTER }],
    territories: [
      { id: 't1', color: '#b03a2e', seeds: [[640, 520]], separate: [], add: [], remove: [], subtract: [], ...MASTER },
      { id: 't2', color: '#2e6fb0', seeds: [[100, 100]], subtract: ['t1'], ...MASTER },
    ],
  });
}

const codesOf = (problems) => problems.map((p) => p.code);

function labelCheck(labels, options = {}) {
  return labelsProblems(labels, { canvas: CANVAS, worldIndex: INDEX, ...options });
}

test('the exported vocabulary is the one of the design', () => {
  assert.deepEqual(PROVENANCES, ['master', 'document', 'agent-choice']);
  assert.deepEqual(VISIBILITIES, ['public', 'master']);
  assert.deepEqual(SCOPE_KINDS, ['world', 'continent', 'region', 'settlement', 'district']);
  assert.deepEqual(ICONS, ['capital', 'city', 'town', 'village', 'fort', 'ruin', 'landmark', 'port']);
  assert.deepEqual(LABEL_GROUPS, ['lands', 'regions', 'nature', 'places', 'territories']);
});

test('the module exports exactly the names of the rewrite, and no layer names', () => {
  assert.deepEqual(Object.keys(model).sort(), [
    'ICONS', 'LABEL_GROUPS', 'PROVENANCES', 'SCOPE_KINDS', 'VISIBILITIES', 'atlasDir', 'atlasFolder',
    'isPlainObject', 'labelsProblems', 'manifestProblems', 'prefixProblems', 'readAtlas', 'validateAtlas', 'writeJson',
  ]);
});

test('readAtlas: a missing labels.json gives the default labels', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: baseManifest(), labels: null });
  const atlas = readAtlas(root);
  assert.equal(atlas.dir, path.join(root, 'Atlas'));
  assert.deepEqual(atlas.labels, {
    lands: [], regions: [], nature: [], places: [], territories: [], legend: { show: true, corner: 'top-left' },
  });
  assert.deepEqual(atlas.errors, []);
});

test('readAtlas: bad JSON is an error with code bad-json, and that file is left undefined', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: null, labels: null });
  fs.writeFileSync(path.join(root, 'Atlas', 'atlas.json'), '{ not json');
  fs.writeFileSync(path.join(root, 'Atlas', 'labels.json'), '[1,');
  const atlas = readAtlas(root);
  assert.equal(atlas.manifest, undefined);
  assert.equal(atlas.labels, undefined);
  assert.deepEqual(codesOf(atlas.errors), ['bad-json', 'bad-json']);
  assert.deepEqual(atlas.errors.map((e) => e.file), ['atlas.json', 'labels.json']);
});

test('readAtlas: a campaign without an atlas folder reads nothing', () => {
  const root = makeCampaign({}, { yaml: campaignYaml(STRUCTURE.filter((s) => s.type !== 'atlas')) });
  assert.deepEqual(readAtlas(root), { dir: null, manifest: undefined, labels: undefined, errors: [] });
});

test('manifestProblems: a valid manifest has none; the optional parts may be missing', () => {
  assert.deepEqual(manifestProblems(baseManifest()), []);
  const minimal = baseManifest();
  delete minimal.base;
  delete minimal.land;
  delete minimal.style;
  assert.deepEqual(manifestProblems(minimal), []);
  const noSea = baseManifest();
  delete noSea.land.sea;
  assert.deepEqual(manifestProblems(noSea), []);
});

test('manifestProblems: version, scope, canvas and style are checked', () => {
  const paths = (m) => manifestProblems(m).map((p) => p.path);
  assert.deepEqual(paths(baseManifest({ version: 1 })), ['version']);
  assert.deepEqual(paths(baseManifest({ scope: { kind: 'planet', places: [] } })), ['scope.kind']);
  assert.deepEqual(paths(baseManifest({ scope: { kind: 'region', places: [1] } })), ['scope.places']);
  assert.deepEqual(paths(baseManifest({ canvas: { width: 15, height: 1000 } })), ['canvas.width']);
  assert.deepEqual(paths(baseManifest({ canvas: { width: 1000.5, height: 1000 } })), ['canvas.width']);
  assert.deepEqual(paths(baseManifest({ style: '' })), ['style']);
});

test('manifestProblems: a partial base or land is refused, and file names must be plain', () => {
  const base = (b) => manifestProblems(baseManifest({ base: b })).map((p) => p.path);
  assert.deepEqual(base({ file: 'base.png', sha256: 'a'.repeat(64) }), ['base.locked']);
  assert.deepEqual(base({ file: 'base.png', sha256: 'XYZ', locked: false }), ['base.sha256']);
  assert.deepEqual(base({ file: '../base.png', sha256: 'a'.repeat(64), locked: false }), ['base.file']);
  assert.deepEqual(base({ file: 'maps/base.png', sha256: 'a'.repeat(64), locked: false }), ['base.file']);
  const land = (l) => manifestProblems(baseManifest({ land: l })).map((p) => p.path);
  assert.deepEqual(land({ file: 'land.png', sha256: 'a'.repeat(64), locked: false, sea: { color: 'blue', tolerance: 40 } }), ['land.sea']);
  assert.deepEqual(land({ file: 'land.png', sha256: 'a'.repeat(64), locked: false, sea: { color: '#1c3a4a', tolerance: 300 } }), ['land.sea']);
});

test('labelsProblems: the full sample is valid', () => {
  assert.deepEqual(labelCheck(fullLabels()), []);
});

test('labelsProblems: every group must be a list, and the legend must be well formed', () => {
  const labels = fullLabels();
  delete labels.nature;
  labels.legend = { show: 'yes', corner: 'middle' };
  const problems = labelCheck(labels);
  assert.ok(problems.some((p) => p.path === 'nature' && p.code === 'bad-labels'));
  assert.ok(problems.some((p) => p.path === 'legend.show'));
  assert.ok(problems.some((p) => p.path === 'legend.corner'));
});

test('labelsProblems: ids are unique across every group, territories included', () => {
  const labels = fullLabels();
  labels.nature[0].id = 'l1';
  const problems = labelCheck(labels);
  assert.deepEqual(codesOf(problems), ['duplicate-id']);
  assert.equal(problems[0].path, 'nature[0].id');
});

test('labelsProblems: text labels need text and a size above 0; positions must be inside the canvas', () => {
  const labels = fullLabels();
  labels.lands[0].text = '';
  labels.nature[0].size = 0;
  labels.regions[0].x = 1001;
  labels.nature[0].y = Number.NaN;
  const problems = labelCheck(labels);
  const paths = problems.map((p) => p.path);
  assert.ok(paths.includes('lands[0].text'));
  assert.ok(paths.includes('nature[0].size'));
  assert.ok(paths.includes('regions[0]'));
  assert.ok(paths.includes('nature[0]'));
  assert.ok(problems.every((p) => p.code === 'bad-label'));
});

test('labelsProblems: without a canvas the positions are not bounded', () => {
  const labels = fullLabels();
  labels.regions[0].x = 99999;
  assert.deepEqual(labelsProblems(labels, { canvas: null, worldIndex: INDEX }), []);
});

test('labelsProblems: a place must be a subject of kind place, and needs a known icon', () => {
  const labels = fullLabels();
  labels.places[0].place = 'mara';
  labels.places[0].kind = 'castle';
  const problems = labelCheck(labels);
  assert.ok(problems.some((p) => p.code === 'bad-reference' && p.path === 'places[0].place'));
  assert.ok(problems.some((p) => p.path === 'places[0].kind'));
  assert.deepEqual(labelCheck(fullLabels(), { worldIndex: null }), []);
});

test('labelsProblems: a place item may carry no text', () => {
  const labels = fullLabels();
  assert.equal(labels.places[0].text, undefined);
  assert.deepEqual(labelCheck(labels), []);
});

test('labelsProblems: a region must name a territory id', () => {
  const labels = fullLabels();
  labels.regions[0].territory = 'nowhere';
  assert.deepEqual(codesOf(labelCheck(labels)), ['bad-reference']);
});

test('labelsProblems: provenance, visibility and sources', () => {
  const labels = fullLabels();
  labels.lands[0].provenance = 'guess';
  labels.nature[0].visibility = 'secret';
  labels.lands[0].sources = [{ section: 'no file' }];
  labels.regions[0].provenance = 'document';
  delete labels.regions[0].sources;
  const paths = labelCheck(labels).map((p) => p.path);
  assert.ok(paths.includes('lands[0].provenance'));
  assert.ok(paths.includes('nature[0].visibility'));
  assert.ok(paths.includes('lands[0].sources[0]'));
  assert.ok(paths.includes('regions[0].sources'));
});

test('labelsProblems: a territory has a color, seeds inside the canvas, and well formed polygons', () => {
  const labels = fullLabels();
  labels.territories[0].color = 'red';
  labels.territories[0].seeds = [[2000, 5]];
  labels.territories[0].add = [[[1, 1], [2, 2]]];
  labels.territories[0].separate = [square(10, 10, 20, 20)];
  const paths = labelCheck(labels).map((p) => p.path);
  assert.ok(paths.includes('territories[0].color'));
  assert.ok(paths.includes('territories[0].seeds[0]'));
  assert.ok(paths.includes('territories[0].add[0]'));
});

test('labelsProblems: separate polygons of a territory are valid when they have 3 points or more', () => {
  const labels = fullLabels();
  labels.territories[0].separate = [square(10, 10, 20, 20)];
  assert.deepEqual(labelCheck(labels), []);
});

test('labelsProblems: subtract names territories listed earlier only', () => {
  const later = fullLabels();
  later.territories[0].subtract = ['t2'];
  assert.deepEqual(codesOf(labelCheck(later)), ['bad-reference']);

  const self = fullLabels();
  self.territories[1].subtract = ['t2'];
  assert.deepEqual(codesOf(labelCheck(self)), ['bad-reference']);

  const unknown = fullLabels();
  unknown.territories[1].subtract = ['ghost'];
  assert.deepEqual(codesOf(labelCheck(unknown)), ['bad-reference']);
});

test('validateAtlas: a complete atlas on disk has no problems', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: baseManifest(), labels: fullLabels() });
  assert.deepEqual(validateAtlas(root, readAtlas(root)), []);
});

test('validateAtlas: a missing base picture is reported; a missing land mask only when the base exists', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: baseManifest(), labels: fullLabels(), pictures: [] });
  const noBase = validateAtlas(root, readAtlas(root));
  assert.deepEqual(noBase.map((p) => [p.code, p.file]), [['missing-file', 'Atlas/base.png']]);

  const root2 = standardCampaign();
  writeAtlas(root2, { manifest: baseManifest(), labels: fullLabels(), pictures: ['base.png'] });
  const noLand = validateAtlas(root2, readAtlas(root2));
  assert.deepEqual(noLand.map((p) => [p.code, p.file]), [['missing-file', 'Atlas/land.png']]);
});

test('validateAtlas: a campaign without a base declared needs no picture', () => {
  const root = standardCampaign();
  const manifest = baseManifest();
  delete manifest.base;
  delete manifest.land;
  writeAtlas(root, { manifest, labels: emptyLabels(), pictures: [] });
  assert.deepEqual(validateAtlas(root, readAtlas(root)), []);
});

test('validateAtlas: bad JSON, a missing manifest and bad labels are reported with campaign-relative files', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: null, labels: null, pictures: [] });
  fs.writeFileSync(path.join(root, 'Atlas', 'labels.json'), '{');
  const problems = validateAtlas(root, readAtlas(root));
  assert.deepEqual(problems.map((p) => [p.code, p.file]), [
    ['bad-manifest', 'Atlas/atlas.json'],
    ['bad-json', 'Atlas/labels.json'],
  ]);

  const root2 = standardCampaign();
  writeAtlas(root2, { manifest: baseManifest({ version: 1 }), labels: fullLabels() });
  fs.rmSync(path.join(root2, 'Atlas', 'base.png'));
  const more = validateAtlas(root2, readAtlas(root2));
  assert.deepEqual(more.map((p) => [p.code, p.file, p.path]), [
    ['bad-manifest', 'Atlas/atlas.json', 'version'],
    ['missing-file', 'Atlas/base.png', 'base.file'],
  ]);
});

test('validateAtlas: a place of the labels is checked against the world of the campaign', () => {
  const root = standardCampaign();
  const labels = fullLabels();
  labels.places[0].place = 'nobody';
  writeAtlas(root, { manifest: baseManifest(), labels });
  const problems = validateAtlas(root, readAtlas(root));
  assert.deepEqual(codesOf(problems), ['bad-reference']);
  assert.equal(problems[0].file, 'Atlas/labels.json');
});

test('validateAtlas: a campaign with no atlas folder is reported', () => {
  const root = makeCampaign({}, { yaml: campaignYaml(STRUCTURE.filter((s) => s.type !== 'atlas')) });
  assert.deepEqual(codesOf(validateAtlas(root, { errors: [] })), ['no-atlas']);
});

test('validateAtlas: with a canvas too small to use, positions are not bounded but the manifest is reported', () => {
  const root = standardCampaign();
  const labels = fullLabels();
  labels.regions[0].x = 5000;
  writeAtlas(root, { manifest: baseManifest({ canvas: { width: 3, height: 3 } }), labels });
  const codes = codesOf(validateAtlas(root, readAtlas(root)));
  assert.ok(codes.includes('bad-manifest'));
  assert.ok(!codes.includes('bad-label'));
});
