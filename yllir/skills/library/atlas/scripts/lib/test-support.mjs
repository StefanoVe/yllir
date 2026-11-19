// Helpers for the tests of the atlas: temporary campaigns with place sheets, and small
// valid atlases written to disk. Used only by *.test.mjs files.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created = [];

/** Removes every temporary campaign made by this module (call from an `after` hook). */
export function cleanupCampaigns() {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export const STRUCTURE = [
  { id: 'luoghi', folder: 'World', type: 'places' },
  { id: 'atlante', folder: 'Atlas', type: 'atlas' },
  { id: 'persone', folder: 'People', type: 'subjects' },
];

/** campaign.yaml text with the given structure. */
export function campaignYaml(structure = STRUCTURE) {
  const lines = [
    'schema: 1',
    'campaign:',
    '  name: "Atlas Test"',
    '  slug: atlas-test',
    'structure:',
  ];
  for (const c of structure) lines.push(`  - id: ${c.id}`, `    folder: ${c.folder}`, `    type: ${c.type}`);
  return `${lines.join('\n')}\n`;
}

/**
 * A place sheet in the form the framework writes: a metadata comment, a title and a description.
 * @param {{ id: string, title: string, kind?: string, body?: string }} sheet
 */
export function placeSheet({ id, title, kind = 'place', body = 'A small town.' }) {
  return [
    '<!-- yllir',
    `id: ${id}`,
    `kind: ${kind}`,
    'provenance: master',
    '-->',
    `# ${title}`,
    '',
    '## Description',
    '',
    `*${body}*`,
    '',
  ].join('\n');
}

/**
 * Makes a temporary campaign folder with the folders of STRUCTURE.
 * @param {Record<string, string>} files campaign-relative paths with their content
 * @param {{ yaml?: string }} [options]
 * @returns {string} absolute path
 */
export function makeCampaign(files = {}, { yaml } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-atlas-'));
  created.push(root);
  fs.writeFileSync(path.join(root, 'campaign.yaml'), yaml ?? campaignYaml());
  for (const folder of ['World', 'Atlas', 'People']) fs.mkdirSync(path.join(root, folder), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/**
 * A campaign with three places (north, port-ash in the folder of north, south), and one
 * character (mara) that is not a place.
 */
export function standardCampaign(extra = {}) {
  return makeCampaign({
    'World/North/North.md': placeSheet({ id: 'north', title: 'North' }),
    'World/North/Port Ash.md': placeSheet({ id: 'port-ash', title: 'Port Ash' }),
    'World/South.md': placeSheet({ id: 'south', title: 'South' }),
    'People/Mara.md': placeSheet({ id: 'mara', title: 'Mara', kind: 'character' }),
    ...extra,
  });
}

/** A valid manifest; overrides replace top-level fields. */
export function baseManifest(overrides = {}) {
  return {
    schema: 1,
    scope: { kind: 'region', places: [], note: 'test' },
    canvas: { width: 1000, height: 1000 },
    seed: 42,
    style: 'default',
    layers: {},
    ...overrides,
  };
}

/** A square of land, as a polygon. */
export function square(x1, y1, x2, y2) {
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}

/** A terrain layer with one land feature covering the middle of the canvas. */
export function terrainLayer(features = []) {
  return {
    layer: 'terrain',
    constraints: [],
    features: features.length > 0 ? features : [landFeature('land-main', square(100, 100, 900, 900))],
  };
}

export function landFeature(id, polygon, extra = {}) {
  return { id, type: 'land', polygon, provenance: 'master', visibility: 'public', sources: [], ...extra };
}

/** A places layer with one feature per place id, each at the given point. */
export function placesLayer(entries) {
  return {
    layer: 'places',
    constraints: [],
    features: entries.map(([id, at]) => ({
      id,
      place: id,
      at,
      icon: 'town',
      provenance: 'master',
      visibility: 'public',
      sources: [],
    })),
  };
}

/** Writes Atlas/atlas.json and the layer files, from objects. Layers with a null value are not written. */
export function writeAtlas(root, { manifest = baseManifest(), layers = {} } = {}) {
  const dir = path.join(root, 'Atlas');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'atlas.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [name, layer] of Object.entries(layers)) {
    if (layer === null) continue;
    fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(layer, null, 2)}\n`);
  }
  return dir;
}

/** Reads a layer file of the atlas on disk, as text. */
export function readAtlasFile(root, name) {
  return fs.readFileSync(path.join(root, 'Atlas', name), 'utf8');
}
