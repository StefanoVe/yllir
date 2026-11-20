// Helpers for the tests of the atlas: temporary campaigns with place sheets, and small valid
// atlases written to disk. Used only by *.test.mjs files.

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
 * Makes a temporary campaign folder. Only the folders of the given files are created; the
 * structure comes from `yaml` (default: STRUCTURE).
 * @param {Record<string, string>} files campaign-relative paths with their content
 * @param {{ yaml?: string }} [options]
 * @returns {string} absolute path
 */
export function makeCampaign(files = {}, { yaml } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-atlas-'));
  created.push(root);
  fs.writeFileSync(path.join(root, 'campaign.yaml'), yaml ?? campaignYaml());
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

/** A valid manifest (version 2, region scope, 1000x1000 canvas, base and land with hashes); overrides replace top-level fields. */
export function baseManifest(overrides = {}) {
  const hash = 'a'.repeat(64);
  return {
    version: 2,
    scope: { kind: 'region', places: [], note: 'test' },
    style: 'fantasy-color',
    canvas: { width: 1000, height: 1000 },
    base: { file: 'base.png', sha256: hash, locked: false },
    land: { file: 'land.png', sha256: hash, locked: false, sea: { color: '#1c3a4a', tolerance: 40 } },
    ...overrides,
  };
}

/** Labels with every group empty and the default legend; overrides replace groups. */
export function emptyLabels(overrides = {}) {
  return {
    lands: [],
    regions: [],
    nature: [],
    places: [],
    territories: [],
    legend: { show: true, corner: 'top-left' },
    ...overrides,
  };
}

/** A provenance and visibility a master-written item carries. */
export const MASTER = { provenance: 'master', visibility: 'public', sources: [] };

/** A square of land, as a polygon. */
export function square(x1, y1, x2, y2) {
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}

/**
 * Writes the atlas folder: atlas.json, labels.json (when given), and the picture files as
 * placeholder bytes (when `pictures` lists them). Pass `null` for a file to leave it out.
 * @param {string} root campaign folder (must declare the atlas folder, see STRUCTURE)
 * @param {{ manifest?: object|null, labels?: object|null, pictures?: string[] }} [parts]
 * @returns {string} the atlas folder, absolute
 */
export function writeAtlas(root, { manifest = baseManifest(), labels = emptyLabels(), pictures = ['base.png', 'land.png'] } = {}) {
  const dir = path.join(root, 'Atlas');
  fs.mkdirSync(dir, { recursive: true });
  if (manifest !== null) fs.writeFileSync(path.join(dir, 'atlas.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (labels !== null) fs.writeFileSync(path.join(dir, 'labels.json'), `${JSON.stringify(labels, null, 2)}\n`);
  for (const name of pictures) fs.writeFileSync(path.join(dir, name), Buffer.from('placeholder'));
  return dir;
}

/** Reads a file of the atlas folder, as text. */
export function readAtlasFile(root, name) {
  return fs.readFileSync(path.join(root, 'Atlas', name), 'utf8');
}
