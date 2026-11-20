// Data model of the atlas: where it lives, how it is read, and every validation rule
// that does not need the drawing. The atlas is a painted base picture (base.png) plus data:
// atlas.json (manifest), land.png (land mask) and labels.json (labels, places, territories).
// Problems are `{ code, file, path, message }`, with `file` relative to the atlas folder in
// this module, and campaign-relative once validateAtlas has prefixed them.

import fs from 'node:fs';
import path from 'node:path';
import { readStructure } from '../../../../../scripts/lib/subjects.mjs';
import { buildWorldIndex } from '../../../../../scripts/lib/world-graph.mjs';

export const PROVENANCES = ['master', 'document', 'agent-choice'];
export const VISIBILITIES = ['public', 'master'];
export const SCOPE_KINDS = ['world', 'continent', 'region', 'settlement', 'district'];
export const ICONS = ['capital', 'city', 'town', 'village', 'fort', 'ruin', 'landmark', 'port'];
export const LABEL_GROUPS = ['lands', 'regions', 'nature', 'places', 'territories'];

const MANIFEST_FILE = 'atlas.json';
const LABELS_FILE = 'labels.json';
const BASE_DEFAULT_FILE = 'base.png';
const LAND_DEFAULT_FILE = 'land.png';
const VERSION = 2;
const MIN_SIDE = 16;
const TEXT_GROUPS = ['lands', 'regions', 'nature'];
const POINT_GROUPS = ['lands', 'regions', 'nature', 'places'];
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const HEX64 = /^[0-9a-f]{64}$/;
const COLOR = /^#[0-9a-f]{6}$/i;

export const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isNonEmptyString = (value) => typeof value === 'string' && value !== '';
const isPoint = (value) => Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber);
const isPlainName = (value) => isNonEmptyString(value) && !/[\\/]/.test(value) && !value.includes('..');

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const problem = (code, file, where, message) => ({ code, file, path: where, message });

/** Labels of an atlas without a labels.json: nothing placed, legend shown top-left. */
function defaultLabels() {
  return {
    lands: [],
    regions: [],
    nature: [],
    places: [],
    territories: [],
    legend: { show: true, corner: 'top-left' },
  };
}

/** Campaign-relative atlas folder from the structure of campaign.yaml, or null. */
export function atlasFolder(root) {
  const { structure } = readStructure(root);
  const entry = (structure ?? []).find((e) => e.type === 'atlas' && typeof e.folder === 'string');
  if (!entry) return null;
  const folder = path.posix.normalize(entry.folder).replace(/\/+$/, '');
  return folder === '' || folder === '.' ? null : folder;
}

/** Absolute atlas folder, or null when the campaign declares none. */
export function atlasDir(root) {
  const folder = atlasFolder(root);
  return folder === null ? null : path.resolve(root, folder);
}

function readJsonFile(dir, name, errors) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    errors.push(problem('bad-json', name, '', `${name} is not valid JSON: ${err.message}`));
    return undefined;
  }
}

/**
 * Reads the atlas: atlas.json and labels.json. Bad JSON becomes an error (code bad-json) and that
 * file is left undefined. A missing labels.json gives the default labels.
 * @returns {{ dir: string|null, manifest: object|undefined, labels: object|undefined, errors: object[] }}
 */
export function readAtlas(root) {
  const dir = atlasDir(root);
  const errors = [];
  const result = { dir, manifest: undefined, labels: undefined, errors };
  if (dir === null) return result;
  result.manifest = readJsonFile(dir, MANIFEST_FILE, errors);
  result.labels = fs.existsSync(path.join(dir, LABELS_FILE))
    ? readJsonFile(dir, LABELS_FILE, errors)
    : defaultLabels();
  return result;
}

/** Writes JSON with two-space indentation and a trailing newline, through a temporary file. */
export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** Prefixes the atlas-relative file of each problem with the atlas folder. */
export function prefixProblems(folder, problems) {
  return problems.map((p) => ({ ...p, file: path.posix.join(folder, p.file) }));
}

/** Problems of atlas.json, with files relative to the atlas folder. */
export function manifestProblems(manifest) {
  const out = [];
  const bad = (where, message) => out.push(problem('bad-manifest', MANIFEST_FILE, where, message));
  if (!isPlainObject(manifest)) {
    bad('', 'atlas.json must be an object');
    return out;
  }
  if (manifest.version !== VERSION) bad('version', `version must be ${VERSION}`);

  const { scope } = manifest;
  if (!isPlainObject(scope)) {
    bad('scope', 'scope must be an object');
  } else {
    if (!SCOPE_KINDS.includes(scope.kind)) bad('scope.kind', `scope.kind must be one of ${SCOPE_KINDS.join(', ')}`);
    if (scope.places !== undefined && !(Array.isArray(scope.places) && scope.places.every((id) => typeof id === 'string'))) {
      bad('scope.places', 'scope.places must be a list of strings');
    }
    if (scope.note !== undefined && typeof scope.note !== 'string') bad('scope.note', 'scope.note must be a string');
  }

  if (manifest.style !== undefined && !isNonEmptyString(manifest.style)) {
    bad('style', 'style must be a non-empty string');
  }

  const { canvas } = manifest;
  if (!isPlainObject(canvas)) {
    bad('canvas', 'canvas must be an object');
  } else {
    for (const side of ['width', 'height']) {
      const value = canvas[side];
      if (!Number.isInteger(value) || value < MIN_SIDE) bad(`canvas.${side}`, `canvas.${side} must be a whole number of at least ${MIN_SIDE}`);
    }
  }

  if (manifest.base !== undefined) {
    const { base } = manifest;
    if (!isPlainObject(base)) {
      bad('base', 'base must be an object');
    } else {
      if (!isPlainName(base.file)) bad('base.file', 'base.file must be a plain file name');
      if (!HEX64.test(base.sha256 ?? '')) bad('base.sha256', 'base.sha256 must be a 64-character hex hash');
      if (typeof base.locked !== 'boolean') bad('base.locked', 'base.locked must be true or false');
    }
  }

  if (manifest.land !== undefined) {
    const { land } = manifest;
    if (!isPlainObject(land)) {
      bad('land', 'land must be an object');
    } else {
      if (!isPlainName(land.file)) bad('land.file', 'land.file must be a plain file name');
      if (!HEX64.test(land.sha256 ?? '')) bad('land.sha256', 'land.sha256 must be a 64-character hex hash');
      if (typeof land.locked !== 'boolean') bad('land.locked', 'land.locked must be true or false');
      if (land.sea !== undefined) {
        const sea = land.sea;
        if (!isPlainObject(sea) || !COLOR.test(sea.color ?? '') || !isFiniteNumber(sea.tolerance)
          || sea.tolerance < 0 || sea.tolerance > 255) {
          bad('land.sea', 'land.sea must be { color: "#rrggbb", tolerance: 0 to 255 }');
        }
      }
    }
  }
  return out;
}

/**
 * Problems of labels.json: shape, unique ids across every group, positions inside the canvas,
 * and the references (territories, places). Files are relative to the atlas folder.
 * @param {object} labels the parsed labels.json
 * @param {{ canvas?: {width: number, height: number}|null, worldIndex?: { subjects: object[] }|null }} [options]
 *   canvas is the canvas of a valid manifest (positions are not bounded when it is null);
 *   worldIndex, when given, is where place ids are checked (a subject of kind place).
 */
export function labelsProblems(labels, { canvas = null, worldIndex = null } = {}) {
  const out = [];
  const bad = (code, where, message) => out.push(problem(code, LABELS_FILE, where, message));
  if (!isPlainObject(labels)) {
    bad('bad-labels', '', 'labels.json must be an object');
    return out;
  }
  for (const group of LABEL_GROUPS) {
    if (!Array.isArray(labels[group])) bad('bad-labels', group, `${group} must be a list`);
  }
  if (labels.legend !== undefined) {
    if (!isPlainObject(labels.legend)) {
      bad('bad-labels', 'legend', 'legend must be an object');
    } else {
      if (typeof labels.legend.show !== 'boolean') bad('bad-labels', 'legend.show', 'legend.show must be true or false');
      if (!CORNERS.includes(labels.legend.corner)) bad('bad-labels', 'legend.corner', `legend.corner must be one of ${CORNERS.join(', ')}`);
    }
  }

  const listOf = (group) => (Array.isArray(labels[group]) ? labels[group] : []);
  const territoryIds = new Set(
    listOf('territories').filter(isPlainObject).map((t) => t.id).filter(isNonEmptyString),
  );
  const placeIds = worldIndex
    ? new Set((worldIndex.subjects ?? []).filter((s) => s?.kind === 'place').map((s) => s.id))
    : null;
  const inCanvas = (x, y) => canvas === null
    || (x >= 0 && y >= 0 && x <= canvas.width && y <= canvas.height);

  const metaProblems = (item, where) => {
    if (!PROVENANCES.includes(item.provenance)) {
      bad('bad-label', `${where}.provenance`, `provenance must be one of ${PROVENANCES.join(', ')}`);
    }
    if (item.visibility !== undefined && !VISIBILITIES.includes(item.visibility)) {
      bad('bad-label', `${where}.visibility`, `visibility must be one of ${VISIBILITIES.join(', ')}`);
    }
    if (item.provenance === 'document' && !Array.isArray(item.sources)) {
      bad('bad-label', `${where}.sources`, 'a document provenance needs a list of sources');
    }
    if (item.sources !== undefined) {
      if (!Array.isArray(item.sources)) {
        bad('bad-label', `${where}.sources`, 'sources must be a list');
      } else {
        item.sources.forEach((source, k) => {
          const valid = isPlainObject(source) && isNonEmptyString(source.file)
            && (source.section === undefined || typeof source.section === 'string');
          if (!valid) bad('bad-label', `${where}.sources[${k}]`, 'a source is { file, section? }');
        });
      }
    }
  };

  const polygonsProblems = (value, where) => {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      bad('bad-label', where, 'must be a list of polygons');
      return;
    }
    value.forEach((polygon, k) => {
      if (!Array.isArray(polygon) || polygon.length < 3 || !polygon.every(isPoint)) {
        bad('bad-label', `${where}[${k}]`, 'a polygon needs at least 3 [x, y] points');
      }
    });
  };

  const seen = new Set();
  const earlierTerritories = new Set();
  for (const group of LABEL_GROUPS) {
    listOf(group).forEach((item, i) => {
      const where = `${group}[${i}]`;
      if (!isPlainObject(item)) {
        bad('bad-label', where, 'must be an object');
        return;
      }
      if (!isNonEmptyString(item.id)) {
        bad('bad-label', `${where}.id`, 'id must be a non-empty string');
      } else if (seen.has(item.id)) {
        bad('duplicate-id', `${where}.id`, `id ${item.id} is used more than once`);
      } else {
        seen.add(item.id);
      }

      if (group === 'territories') {
        if (!COLOR.test(item.color ?? '')) bad('bad-label', `${where}.color`, 'color must be "#rrggbb"');
        if (!Array.isArray(item.seeds)) {
          bad('bad-label', `${where}.seeds`, 'seeds must be a list of [x, y] points');
        } else {
          item.seeds.forEach((seed, k) => {
            if (!isPoint(seed) || !inCanvas(seed[0], seed[1])) {
              bad('bad-label', `${where}.seeds[${k}]`, 'a seed is an [x, y] point inside the canvas');
            }
          });
        }
        for (const key of ['separate', 'add', 'remove']) polygonsProblems(item[key], `${where}.${key}`);
        if (item.subtract !== undefined) {
          if (!Array.isArray(item.subtract) || !item.subtract.every(isNonEmptyString)) {
            bad('bad-label', `${where}.subtract`, 'subtract must be a list of territory ids');
          } else {
            item.subtract.forEach((id, k) => {
              if (!earlierTerritories.has(id)) {
                bad('bad-reference', `${where}.subtract[${k}]`, `${id} must name a territory listed earlier`);
              }
            });
          }
        }
        if (isNonEmptyString(item.id)) earlierTerritories.add(item.id);
        metaProblems(item, where);
        return;
      }

      if (POINT_GROUPS.includes(group)) {
        if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y) || !inCanvas(item.x, item.y)) {
          bad('bad-label', where, 'x and y must be numbers inside the canvas');
        }
      }
      if (TEXT_GROUPS.includes(group)) {
        if (!isNonEmptyString(item.text)) bad('bad-label', `${where}.text`, 'text must be a non-empty string');
        if (!isFiniteNumber(item.size) || item.size <= 0) bad('bad-label', `${where}.size`, 'size must be a number above 0');
      }
      if (group === 'places') {
        if (!isNonEmptyString(item.place)) {
          bad('bad-label', `${where}.place`, 'place must be a subject id');
        } else if (placeIds && !placeIds.has(item.place)) {
          bad('bad-reference', `${where}.place`, `${item.place} is not a place of the world`);
        }
        if (!ICONS.includes(item.kind)) bad('bad-label', `${where}.kind`, `kind must be one of ${ICONS.join(', ')}`);
      }
      if (group === 'regions' && !territoryIds.has(item.territory)) {
        bad('bad-reference', `${where}.territory`, 'territory must name a territory id');
      }
      metaProblems(item, where);
    });
  }
  return out;
}

/** Canvas of a manifest when it is usable for positions, otherwise null. */
function usableCanvas(manifest) {
  const canvas = manifest?.canvas;
  if (!isPlainObject(canvas)) return null;
  const ok = [canvas.width, canvas.height].every((n) => Number.isInteger(n) && n >= MIN_SIDE);
  return ok ? { width: canvas.width, height: canvas.height } : null;
}

/** Missing picture files: the base named by the manifest, and the land mask when the base exists. */
function fileProblems(dir, manifest) {
  const out = [];
  if (!isPlainObject(manifest) || manifest.base === undefined) return out;
  const baseFile = isPlainObject(manifest.base) && isPlainName(manifest.base.file)
    ? manifest.base.file
    : BASE_DEFAULT_FILE;
  if (!fs.existsSync(path.join(dir, baseFile))) {
    out.push(problem('missing-file', baseFile, 'base.file', `${baseFile} is missing`));
    return out;
  }
  const landFile = isPlainObject(manifest.land) && isPlainName(manifest.land.file)
    ? manifest.land.file
    : LAND_DEFAULT_FILE;
  if (!fs.existsSync(path.join(dir, landFile))) {
    out.push(problem('missing-file', landFile, 'land.file', `${landFile} is missing`));
  }
  return out;
}

/**
 * Every problem of the atlas: unreadable files, the manifest, the labels, and the picture files.
 * @param {string} root campaign folder
 * @param {{ manifest?: object, labels?: object, errors?: object[] }} atlas as read by readAtlas
 * @param {{ worldIndex?: object }} [options] the world index; built from root when omitted
 * @returns {object[]} problems sorted by file then path, files campaign-relative
 */
export function validateAtlas(root, atlas, { worldIndex } = {}) {
  const folder = atlasFolder(root);
  if (folder === null) {
    return [problem('no-atlas', 'campaign.yaml', 'structure', 'campaign.yaml declares no atlas folder')];
  }
  const index = worldIndex ?? buildWorldIndex(root);
  const manifest = atlas.manifest;
  const problems = [...(atlas.errors ?? [])];

  if (manifest !== undefined) {
    problems.push(...manifestProblems(manifest));
  } else if (!problems.some((p) => p.file === MANIFEST_FILE)) {
    problems.push(problem('bad-manifest', MANIFEST_FILE, '', 'atlas.json is missing'));
  }

  if (atlas.labels !== undefined) {
    problems.push(...labelsProblems(atlas.labels, { canvas: usableCanvas(manifest), worldIndex: index }));
  }

  problems.push(...fileProblems(path.resolve(root, folder), manifest));

  return prefixProblems(folder, problems).sort(
    (a, b) => compareText(a.file, b.file) || compareText(a.path, b.path) || compareText(a.code, b.code),
  );
}
