// Data model of the atlas: where it lives, how it is read, and every validation rule
// that does not need the drawing. Problems are `{ code, file, path, message }`, with
// `file` campaign-relative and `path` pointing inside the file (for example `features[3].at`).

import fs from 'node:fs';
import path from 'node:path';
import { readStructure } from '../../../../../scripts/lib/subjects.mjs';
import { buildWorldIndex } from '../../../../../scripts/lib/world-graph.mjs';
import { isFinitePoint, isUsablePolygon, pointInPolygon } from './geometry.mjs';
import { lockProblems } from './lock.mjs';
import { landMask } from './landmask.mjs';

/** Layers of a geographic atlas (world, continent, region), in drawing order. */
export const GEO_LAYERS = ['terrain', 'relief', 'water', 'biomes', 'political', 'places', 'routes', 'labels'];
/** Layers of an urban atlas (settlement, district), in drawing order. */
export const URBAN_LAYERS = ['ground', 'green', 'walls', 'streets', 'blocks', 'buildings', 'districts', 'labels'];
/**
 * Every layer once, in drawing order: the geographic ones, then the urban ones. `labels` is shared and
 * goes last, so the drawing order of each scale is kept (it is drawn after the features it names).
 */
export const LAYERS = [
  ...GEO_LAYERS.filter((name) => name !== 'labels'),
  ...URBAN_LAYERS.filter((name) => name !== 'labels'),
  'labels',
];
export const PROVENANCES = ['master', 'document', 'agent-choice'];
export const VISIBILITIES = ['public', 'master'];
export const SCOPE_KINDS = ['world', 'continent', 'region', 'settlement', 'district'];
export const URBAN_SCOPE_KINDS = ['settlement', 'district'];
export const ICONS = ['capital', 'city', 'town', 'village', 'fort', 'ruin', 'landmark', 'port'];
export const BUILDING_KINDS = [
  'tavern', 'inn', 'temple', 'shrine', 'palace', 'castle', 'keep', 'tower', 'mill', 'warehouse', 'market',
  'guildhall', 'smithy', 'house', 'shop', 'gatehouse', 'landmark',
];
export const LOT_KINDS = ['house', 'rowhouse', 'shop', 'barn'];
export const CONSTRAINT_KINDS_BY_LAYER = {
  terrain: ['landmass', 'region', 'sea', 'lake', 'open-edge'],
  relief: ['range'],
  biomes: ['biome'],
  water: ['river'],
  political: ['realm'],
  routes: ['road', 'trail', 'sea-route'],
  places: [],
  labels: [],
  ground: ['river', 'coast', 'pond', 'canal'],
  green: ['park'],
  walls: ['wall'],
  streets: ['street', 'square', 'grid'],
  blocks: ['fill'],
  buildings: [],
  districts: ['district'],
};
export const SIDES = ['north', 'south', 'east', 'west'];
export const FEATURE_TYPES = {
  terrain: ['land', 'lake'],
  relief: ['mountains', 'hills'],
  water: ['river', 'lake'],
  biomes: ['forest', 'swamp', 'desert', 'ice', 'grassland'],
  political: ['realm'],
  places: null,
  routes: ['road', 'trail', 'sea-route'],
  labels: null,
  ground: ['water'],
  green: ['park', 'garden', 'field', 'wood', 'orchard'],
  walls: ['wall', 'tower', 'gate'],
  streets: ['street', 'square', 'bridge'],
  blocks: ['block'],
  buildings: null,
  districts: ['district'],
};

const MANIFEST_FILE = 'atlas.json';
const SCHEMA = 1;
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX64 = /^[0-9a-f]{64}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const MAX_SEED = 2 ** 31 - 1;
const SCOPE_UNITS = ['m', 'paces'];
const CHARACTERS = ['poor', 'common', 'rich'];
const STREET_RANKS = ['main', 'secondary', 'lane'];
const WALL_TOWERS = ['corners', 'spaced', 'none'];
const GRID_RANKS = ['secondary', 'lane'];

/** True for a settlement or a district scope: the urban layers apply. */
export function isUrbanScope(kind) {
  return URBAN_SCOPE_KINDS.includes(kind);
}

/** The layers that a scope kind may have: the urban ones for a settlement or district, the geographic ones otherwise. */
export function layersForScope(kind) {
  return isUrbanScope(kind) ? URBAN_LAYERS : GEO_LAYERS;
}

export const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const problem = (code, file, where, message) => ({ code, file, path: where, message });

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
 * Reads the atlas: the manifest and each layer file that exists. Bad JSON becomes an error
 * (code bad-json) and that file is left out.
 * @returns {{ dir: string|null, manifest: object|undefined, layers: Record<string, object>, errors: object[] }}
 */
export function readAtlas(root) {
  const dir = atlasDir(root);
  const errors = [];
  const result = { dir, manifest: undefined, layers: {}, errors };
  if (dir === null) return result;
  result.manifest = readJsonFile(dir, MANIFEST_FILE, errors);
  for (const name of LAYERS) {
    const layer = readJsonFile(dir, `${name}.json`, errors);
    if (layer !== undefined) result.layers[name] = layer;
  }
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

/** Manifest problems, with files relative to the atlas folder. */
export function manifestProblems(manifest) {
  const out = [];
  const bad = (where, message) => out.push(problem('bad-manifest', MANIFEST_FILE, where, message));
  if (!isPlainObject(manifest)) {
    bad('', 'atlas.json must be an object');
    return out;
  }
  if (manifest.schema !== SCHEMA) bad('schema', 'schema must be 1');

  const { scope } = manifest;
  if (!isPlainObject(scope)) {
    bad('scope', 'scope must be an object');
  } else {
    if (!SCOPE_KINDS.includes(scope.kind)) bad('scope.kind', `scope.kind must be one of ${SCOPE_KINDS.join(', ')}`);
    if (!Array.isArray(scope.places) || !scope.places.every((id) => typeof id === 'string')) {
      bad('scope.places', 'scope.places must be a list of strings');
    }
    if (scope.note !== undefined && typeof scope.note !== 'string') bad('scope.note', 'scope.note must be a string');
    if (scope.unit !== undefined && !SCOPE_UNITS.includes(scope.unit)) {
      bad('scope.unit', `scope.unit must be one of ${SCOPE_UNITS.join(', ')}`);
    }
  }

  const { canvas } = manifest;
  if (!isPlainObject(canvas)) {
    bad('canvas', 'canvas must be an object');
  } else {
    for (const side of ['width', 'height']) {
      const value = canvas[side];
      if (!Number.isInteger(value) || value < 100 || value > 20000) {
        bad(`canvas.${side}`, `canvas.${side} must be an integer from 100 to 20000`);
      }
    }
  }

  if (!Number.isInteger(manifest.seed) || manifest.seed < 0 || manifest.seed > MAX_SEED) {
    bad('seed', 'seed must be an integer from 0 to 2^31 - 1');
  }
  if (typeof manifest.style !== 'string' || manifest.style === '') bad('style', 'style must be a non-empty string');

  if (!isPlainObject(manifest.layers)) {
    bad('layers', 'layers must be an object');
  } else {
    for (const [name, entry] of Object.entries(manifest.layers)) {
      const where = `layers.${name}`;
      if (!LAYERS.includes(name)) {
        bad(where, `unknown layer ${name}`);
      } else if (!isPlainObject(entry) || typeof entry.locked !== 'boolean') {
        bad(where, 'a layer entry is { locked: boolean }');
      } else if (entry.locked) {
        const snap = entry.snapshot;
        const okFeatures = isPlainObject(snap?.features)
          && Object.values(snap.features).every((h) => typeof h === 'string' && HEX64.test(h));
        const okConstraints = Array.isArray(snap?.constraints)
          && snap.constraints.every((h) => typeof h === 'string' && HEX64.test(h));
        if (!isPlainObject(snap) || !okConstraints || !okFeatures) {
          bad(`${where}.snapshot`, 'a locked layer needs a snapshot with sha256 hex digests');
        }
      } else if (entry.snapshot !== undefined) {
        bad(`${where}.snapshot`, 'only a locked layer has a snapshot');
      }
    }
  }
  return out;
}

function checkPoint(point, where, ctx, file, out) {
  if (!isFinitePoint(point)) {
    out.push(problem('bad-feature', file, where, 'a point is a list of two finite numbers'));
    return;
  }
  const { canvas } = ctx;
  if (canvas && (point[0] < 0 || point[0] > canvas.width || point[1] < 0 || point[1] > canvas.height)) {
    out.push(problem('out-of-canvas', file, where, `point is outside the ${canvas.width}x${canvas.height} canvas`));
  }
}

function checkPoints(points, min, field, base, file, ctx, out) {
  const where = `${base}.${field}`;
  if (!Array.isArray(points) || points.length < min) {
    out.push(problem('bad-feature', file, where, `${field} needs at least ${min} points`));
    return;
  }
  points.forEach((point, k) => checkPoint(point, `${where}[${k}]`, ctx, file, out));
}

function checkSourceList(sources, base, file, ctx, out) {
  if (!Array.isArray(sources)) {
    out.push(problem('bad-feature', file, `${base}.sources`, 'sources must be a list'));
    return;
  }
  sources.forEach((source, j) => {
    const where = `${base}.sources[${j}]`;
    const valid = isPlainObject(source) && typeof source.file === 'string' && source.file !== ''
      && (source.section === undefined || typeof source.section === 'string');
    if (!valid) {
      out.push(problem('bad-feature', file, where, 'a source is { file, section? }'));
    } else if (!fs.existsSync(path.join(ctx.root, source.file))) {
      out.push(problem('missing-source', file, `${where}.file`, `source file ${source.file} does not exist`));
    }
  });
}

function checkSources(feature, base, file, ctx, out) {
  checkSourceList(feature.sources, base, file, ctx, out);
  if (Array.isArray(feature.sources) && feature.sources.length === 0 && feature.provenance === 'document') {
    out.push(problem('no-sources', file, `${base}.sources`, 'a document provenance needs at least one source'));
  }
}

/** A point of a constraint: two finite numbers. Constraints may lie outside the canvas. */
function constraintPoint(constraint, field, base, file, out) {
  if (!isFinitePoint(constraint[field])) {
    out.push(problem('bad-constraint', file, `${base}.${field}`, `${field} must be a point (two finite numbers)`));
  }
}

function constraintPositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function constraintRoughness(constraint, base, file, out) {
  if (constraint.roughness === undefined) return;
  if (!(typeof constraint.roughness === 'number' && constraint.roughness >= 0 && constraint.roughness <= 1)) {
    out.push(problem('bad-constraint', file, `${base}.roughness`, 'roughness must be a number from 0 to 1'));
  }
}

function constraintId(constraint, base, file, out) {
  if (typeof constraint.id !== 'string' || !ID_RE.test(constraint.id)) {
    out.push(problem('bad-constraint', file, `${base}.id`, 'id must be kebab-case'));
  }
}

/** Kind-specific fields of one terrain constraint. */
function checkConstraintFields(constraint, base, file, ctx, out) {
  const radius = (field) => {
    if (!constraintPositive(constraint[field])) {
      out.push(problem('bad-constraint', file, `${base}.${field}`, `${field} must be a number above 0`));
    }
  };
  switch (constraint.kind) {
    case 'landmass': {
      constraintId(constraint, base, file, out);
      constraintPoint(constraint, 'center', base, file, out);
      const r = constraint.radius;
      if (!Array.isArray(r) || r.length !== 2 || !r.every(constraintPositive)) {
        out.push(problem('bad-constraint', file, `${base}.radius`, 'radius is [rx, ry], both above 0'));
      }
      constraintRoughness(constraint, base, file, out);
      break;
    }
    case 'region': {
      if (typeof constraint.place !== 'string') {
        out.push(problem('bad-constraint', file, `${base}.place`, 'place must be a string'));
      } else {
        const subject = ctx.byId.get(constraint.place);
        if (subject === undefined) {
          out.push(problem('unknown-place', file, `${base}.place`, `${constraint.place} is not a place of the world`));
        } else if (subject.kind !== 'place') {
          out.push(problem('id-not-place', file, `${base}.place`, `${constraint.place} is not a place sheet`));
        }
      }
      constraintPoint(constraint, 'at', base, file, out);
      radius('radius');
      break;
    }
    case 'sea':
      constraintPoint(constraint, 'at', base, file, out);
      radius('radius');
      constraintRoughness(constraint, base, file, out);
      break;
    case 'lake':
      constraintId(constraint, base, file, out);
      constraintPoint(constraint, 'at', base, file, out);
      radius('radius');
      constraintRoughness(constraint, base, file, out);
      break;
    default: // open-edge
      if (!SIDES.includes(constraint.side)) {
        out.push(problem('bad-constraint', file, `${base}.side`, `side must be one of ${SIDES.join(', ')}`));
      }
  }
}

const FOREST_VARIANTS = ['conifer', 'broadleaf'];

/** The optional `name` (text) and `place` (a place sheet of the world) of a realm, on a constraint or a feature. */
function checkRealmNaming(value, base, file, ctx, out, code) {
  if (value.name !== undefined && (typeof value.name !== 'string' || value.name.trim() === '')) {
    out.push(problem(code, file, `${base}.name`, 'name must be a non-empty text'));
  }
  if (value.place === undefined) return;
  if (typeof value.place !== 'string') {
    out.push(problem(code, file, `${base}.place`, 'place must be the id of a place'));
    return;
  }
  const subject = ctx.byId.get(value.place);
  if (subject === undefined) {
    out.push(problem('unknown-place', file, `${base}.place`, `${value.place} is not a place of the world`));
  } else if (subject.kind !== 'place') {
    out.push(problem('id-not-place', file, `${base}.place`, `${value.place} is not a place sheet`));
  }
}

/** The rules of a realm constraint (political layer) and of a district constraint (districts layer). */
function checkRealmConstraint(c, base, file, ctx, out) {
  const bad = (field, message) => out.push(problem('bad-constraint', file, `${base}.${field}`, message));
  const pointsOf = (value, min) => Array.isArray(value) && value.length >= min && value.every(isFinitePoint);
  constraintId(c, base, file, out);
  if (typeof c.color !== 'string' || !COLOR.test(c.color)) bad('color', 'color must be #rrggbb');
  if (!pointsOf(c.seeds, 1)) bad('seeds', 'seeds needs at least one point');
  if (c.cuts !== undefined && !(Array.isArray(c.cuts) && c.cuts.every((cut) => pointsOf(cut, 2)))) {
    bad('cuts', 'cuts must be a list of segments, each two points');
  }
  if (c.reach !== undefined && !constraintPositive(c.reach)) bad('reach', 'reach must be a number above 0');
  checkRealmNaming(c, base, file, ctx, out, 'bad-constraint');
}

const isAngle = (value) => typeof value === 'number' && Number.isFinite(value);
const isSizePair = (value) => Array.isArray(value) && value.length === 2 && value.every(constraintPositive);

/** Kind-specific fields of a constraint of an urban layer. The kind decides the rules (it is checked against the layer before). */
function checkUrbanConstraintFields(c, base, file, ctx, out) {
  const bad = (field, message) => out.push(problem('bad-constraint', file, `${base}.${field}`, message));
  const pointsOf = (value, min) => Array.isArray(value) && value.length >= min && value.every(isFinitePoint);
  const oneOf = (field, list) => {
    if (!list.includes(c[field])) bad(field, `${field} must be one of ${list.join(', ')}`);
  };
  const optionalOneOf = (field, list) => {
    if (c[field] !== undefined) oneOf(field, list);
  };
  const positive = (field) => {
    if (!constraintPositive(c[field])) bad(field, `${field} must be a number above 0`);
  };
  const optionalPositive = (field) => {
    if (c[field] !== undefined) positive(field);
  };
  const optionalAngle = () => {
    if (c.angle !== undefined && !isAngle(c.angle)) bad('angle', 'angle must be a finite number (radians)');
  };
  const optionalCharacter = () => optionalOneOf('character', CHARACTERS);

  if (c.visibility !== undefined && !VISIBILITIES.includes(c.visibility)) {
    bad('visibility', `visibility must be one of ${VISIBILITIES.join(', ')}`);
  }
  constraintId(c, base, file, out);
  switch (c.kind) {
    case 'river':
      constraintPoint(c, 'source', base, file, out);
      constraintPoint(c, 'mouth', base, file, out);
      positive('width');
      if (c.via !== undefined && !pointsOf(c.via, 0)) bad('via', 'via must be a list of points');
      if (c.meander !== undefined && !(typeof c.meander === 'number' && c.meander >= 0 && c.meander <= 1)) {
        bad('meander', 'meander must be a number from 0 to 1');
      }
      break;
    case 'coast':
      oneOf('side', SIDES);
      positive('depth');
      constraintRoughness(c, base, file, out);
      break;
    case 'pond':
      constraintPoint(c, 'at', base, file, out);
      positive('radius');
      constraintRoughness(c, base, file, out);
      break;
    case 'canal':
      if (!pointsOf(c.path, 2)) bad('path', 'path needs at least two points');
      positive('width');
      break;
    case 'park':
      oneOf('type', FEATURE_TYPES.green);
      constraintPoint(c, 'at', base, file, out);
      positive('radius');
      constraintRoughness(c, base, file, out);
      break;
    case 'wall': {
      const hasRing = c.ring !== undefined;
      const hasPath = c.path !== undefined;
      if (hasRing === hasPath) {
        bad('ring', 'give exactly one of ring (a closed perimeter) or path (an open line)');
      } else if (hasRing && !pointsOf(c.ring, 3)) {
        bad('ring', 'ring needs at least three points');
      } else if (hasPath && !pointsOf(c.path, 2)) {
        bad('path', 'path needs at least two points');
      }
      positive('thickness');
      optionalOneOf('towers', WALL_TOWERS);
      optionalPositive('towerSpacing');
      if (c.gates !== undefined) {
        if (!Array.isArray(c.gates) || !c.gates.every(isPlainObject)) {
          bad('gates', 'gates must be a list of { at, width? }');
        } else {
          c.gates.forEach((gate, k) => {
            if (!isFinitePoint(gate.at)) bad(`gates[${k}].at`, 'a gate needs at (a point)');
            if (gate.width !== undefined && !constraintPositive(gate.width)) bad(`gates[${k}].width`, 'width must be a number above 0');
          });
        }
      }
      break;
    }
    case 'street':
      oneOf('rank', STREET_RANKS);
      if (!pointsOf(c.path, 2)) bad('path', 'path needs at least two points');
      optionalPositive('width');
      break;
    case 'square':
      constraintPoint(c, 'at', base, file, out);
      if (!isSizePair(c.size)) bad('size', 'size is [w, h], both above 0');
      optionalAngle();
      break;
    case 'grid':
      if (!pointsOf(c.area, 3)) bad('area', 'area needs at least three points');
      positive('spacing');
      optionalAngle();
      if (c.jitter !== undefined && !(typeof c.jitter === 'number' && c.jitter >= 0 && c.jitter <= 1)) {
        bad('jitter', 'jitter must be a number from 0 to 1');
      }
      optionalOneOf('rank', GRID_RANKS);
      break;
    case 'fill':
      if (c.area !== undefined && !pointsOf(c.area, 3)) bad('area', 'area needs at least three points');
      optionalCharacter();
      if (c.district !== undefined && (typeof c.district !== 'string' || !ID_RE.test(c.district))) {
        bad('district', 'district must be the kebab-case id of a district constraint');
      }
      break;
    case 'district':
      checkRealmConstraint(c, base, file, ctx, out);
      optionalCharacter();
      break;
    default:
      bad('kind', 'unknown urban constraint kind');
  }
}

/** Kind-specific fields of a constraint of the relief, biomes, water, political and routes layers, or of an urban layer. */
function checkLayerConstraintFields(name, c, base, file, ctx, out) {
  if (URBAN_LAYERS.includes(name)) {
    checkUrbanConstraintFields(c, base, file, ctx, out);
    return;
  }
  const bad = (field, message) => out.push(problem('bad-constraint', file, `${base}.${field}`, message));
  const pointsOf = (value, min) => Array.isArray(value) && value.length >= min && value.every(isFinitePoint);
  const oneOf = (field, list) => {
    if (!list.includes(c[field])) bad(field, `${field} must be one of ${list.join(', ')}`);
  };
  switch (name) {
    case 'relief':
      constraintId(c, base, file, out);
      oneOf('type', ['mountains', 'hills']);
      if (!pointsOf(c.spine, 2)) bad('spine', 'spine needs at least two points');
      if (!constraintPositive(c.width)) bad('width', 'width must be a number above 0');
      constraintRoughness(c, base, file, out);
      break;
    case 'biomes':
      constraintId(c, base, file, out);
      oneOf('type', ['forest', 'swamp', 'desert', 'ice', 'grassland']);
      constraintPoint(c, 'at', base, file, out);
      if (!constraintPositive(c.radius)) bad('radius', 'radius must be a number above 0');
      constraintRoughness(c, base, file, out);
      if (c.avoidRelief !== undefined && typeof c.avoidRelief !== 'boolean') bad('avoidRelief', 'avoidRelief must be a boolean');
      if (c.variant !== undefined && (c.type !== 'forest' || !FOREST_VARIANTS.includes(c.variant))) {
        bad('variant', `variant is only for a forest and must be one of ${FOREST_VARIANTS.join(', ')}`);
      }
      break;
    case 'water':
      constraintId(c, base, file, out);
      constraintPoint(c, 'source', base, file, out);
      constraintPoint(c, 'mouth', base, file, out);
      if (c.via !== undefined && !pointsOf(c.via, 0)) bad('via', 'via must be a list of points');
      if (c.meander !== undefined && !(typeof c.meander === 'number' && c.meander >= 0 && c.meander <= 1)) {
        bad('meander', 'meander must be a number from 0 to 1');
      }
      break;
    case 'political':
      checkRealmConstraint(c, base, file, ctx, out);
      break;
    default: // routes
      constraintId(c, base, file, out);
      if (typeof c.from !== 'string') bad('from', 'from must be a place id');
      if (typeof c.to !== 'string') bad('to', 'to must be a place id');
      if (c.via !== undefined && !pointsOf(c.via, 0)) bad('via', 'via must be a list of points');
  }
}

/**
 * One constraint of a layer. Terrain keeps its own rules (provenance is required there).
 * Other layers accept provenance when given. Sources may be empty whatever the provenance.
 */
function checkConstraint(name, constraint, base, file, ctx, out) {
  const kinds = CONSTRAINT_KINDS_BY_LAYER[name] ?? [];
  if (!kinds.includes(constraint.kind)) {
    const message = kinds.length === 0 ? `${name} takes no constraints` : `kind must be one of ${kinds.join(', ')}`;
    out.push(problem('bad-constraint', file, `${base}.kind`, message));
    return;
  }
  const required = name === 'terrain';
  if ((required || constraint.provenance !== undefined) && !PROVENANCES.includes(constraint.provenance)) {
    out.push(problem('bad-feature', file, `${base}.provenance`, `provenance must be one of ${PROVENANCES.join(', ')}`));
  }
  checkSourceList(constraint.sources, base, file, ctx, out);
  if (constraint.note !== undefined && typeof constraint.note !== 'string') {
    out.push(problem('bad-constraint', file, `${base}.note`, 'note must be a string'));
  }
  if (name === 'terrain') checkConstraintFields(constraint, base, file, ctx, out);
  else checkLayerConstraintFields(name, constraint, base, file, ctx, out);
}

/** Every constraint of a layer that has an id must have a different one from the others. */
function checkDuplicateConstraintIds(constraints, file, out) {
  const seen = new Set();
  constraints.forEach((c, k) => {
    if (typeof c.id !== 'string') return;
    if (seen.has(c.id)) out.push(problem('duplicate-id', file, `constraints[${k}].id`, `duplicate constraint id ${c.id}`));
    seen.add(c.id);
  });
}

function checkCommon(feature, base, file, ctx, out) {
  if (typeof feature.id !== 'string' || !ID_RE.test(feature.id)) {
    out.push(problem('bad-feature', file, `${base}.id`, 'id must be kebab-case'));
  }
  if (!PROVENANCES.includes(feature.provenance)) {
    out.push(problem('bad-feature', file, `${base}.provenance`, `provenance must be one of ${PROVENANCES.join(', ')}`));
  }
  if (!VISIBILITIES.includes(feature.visibility)) {
    out.push(problem('bad-feature', file, `${base}.visibility`, `visibility must be one of ${VISIBILITIES.join(', ')}`));
  }
  checkSources(feature, base, file, ctx, out);
}

function checkTyped(name, feature, base, file, ctx, out) {
  const types = FEATURE_TYPES[name];
  if (!types.includes(feature.type)) {
    out.push(problem('bad-feature', file, `${base}.type`, `type must be one of ${types.join(', ')}`));
    return;
  }
  if (name === 'water') {
    if (feature.type === 'river') checkPoints(feature.path, 2, 'path', base, file, ctx, out);
    else checkPoints(feature.polygon, 3, 'polygon', base, file, ctx, out);
  } else {
    checkPoints(feature.polygon, 3, 'polygon', base, file, ctx, out);
  }
}

/** A realm feature (political layer) or a district feature (districts layer, type 'district'). */
function checkPolitical(feature, base, file, ctx, out, type = 'realm') {
  if (feature.type !== type) out.push(problem('bad-feature', file, `${base}.type`, `type must be ${type}`));
  checkRealmNaming(feature, base, file, ctx, out, 'bad-feature');
  checkPoints(feature.seeds, 1, 'seeds', base, file, ctx, out);
  if (typeof feature.color !== 'string' || !COLOR.test(feature.color)) {
    out.push(problem('bad-feature', file, `${base}.color`, 'color must be #rrggbb'));
  }
  if (feature.rules !== undefined && !isPlainObject(feature.rules)) {
    out.push(problem('bad-feature', file, `${base}.rules`, 'rules must be an object'));
  }
  if (Array.isArray(feature.polygons)) {
    feature.polygons.forEach((polygon, n) => checkPoints(polygon, 3, 'polygon', `${base}.polygons[${n}]`, file, ctx, out));
  } else if (feature.polygons !== undefined) {
    out.push(problem('bad-feature', file, `${base}.polygons`, 'polygons must be a list of polygons'));
  }
  if (feature.polygon !== undefined) checkPoints(feature.polygon, 3, 'polygon', base, file, ctx, out);
}

/** The `place` of a feature (a place sheet of the world) and the rule that its id equals it. */
function checkPlaceRef(feature, base, file, ctx, out) {
  if (typeof feature.place !== 'string') {
    out.push(problem('bad-feature', file, `${base}.place`, 'place must be a string'));
  } else {
    const subject = ctx.byId.get(feature.place);
    if (subject === undefined) {
      out.push(problem('unknown-place', file, `${base}.place`, `${feature.place} is not a place of the world`));
    } else if (subject.kind !== 'place') {
      out.push(problem('id-not-place', file, `${base}.place`, `${feature.place} is not a place sheet`));
    }
  }
  if (feature.id !== feature.place) out.push(problem('bad-feature', file, `${base}.id`, 'id must equal place'));
}

function checkPlace(feature, base, file, ctx, out) {
  checkPlaceRef(feature, base, file, ctx, out);
  checkPoint(feature.at, `${base}.at`, ctx, file, out);
  if (!ICONS.includes(feature.icon)) out.push(problem('bad-feature', file, `${base}.icon`, `icon must be one of ${ICONS.join(', ')}`));
}

function checkRoute(feature, base, file, ctx, out) {
  const types = FEATURE_TYPES.routes;
  if (!types.includes(feature.type)) out.push(problem('bad-feature', file, `${base}.type`, `type must be one of ${types.join(', ')}`));
  checkPoints(feature.path, 2, 'path', base, file, ctx, out);
  if (feature.connects === undefined) return;
  if (!Array.isArray(feature.connects)) {
    out.push(problem('bad-feature', file, `${base}.connects`, 'connects must be a list'));
    return;
  }
  feature.connects.forEach((placeId, k) => {
    if (!ctx.placeIds.has(placeId)) {
      out.push(problem('unknown-route-place', file, `${base}.connects[${k}]`, `${placeId} is not in the places layer`));
    }
  });
}

/** A wall line (path, closed), a tower (at, radius) or a gate (at, angle, width). */
function checkWallFeature(feature, base, file, ctx, out) {
  const bad = (field, message) => out.push(problem('bad-feature', file, `${base}.${field}`, message));
  switch (feature.type) {
    case 'wall':
      checkPoints(feature.path, 2, 'path', base, file, ctx, out);
      if (typeof feature.closed !== 'boolean') bad('closed', 'closed must be true or false');
      if (!constraintPositive(feature.thickness)) bad('thickness', 'thickness must be a number above 0');
      break;
    case 'tower':
      checkPoint(feature.at, `${base}.at`, ctx, file, out);
      if (!constraintPositive(feature.radius)) bad('radius', 'radius must be a number above 0');
      break;
    case 'gate':
      checkPoint(feature.at, `${base}.at`, ctx, file, out);
      if (!isAngle(feature.angle)) bad('angle', 'angle must be a finite number (radians)');
      if (!constraintPositive(feature.width)) bad('width', 'width must be a number above 0');
      break;
    default:
      bad('type', `type must be one of ${FEATURE_TYPES.walls.join(', ')}`);
  }
}

/** A street (rank, path), a square (polygon) or a bridge (two points, width). */
function checkStreetFeature(feature, base, file, ctx, out) {
  const bad = (field, message) => out.push(problem('bad-feature', file, `${base}.${field}`, message));
  switch (feature.type) {
    case 'street':
      if (!STREET_RANKS.includes(feature.rank)) bad('rank', `rank must be one of ${STREET_RANKS.join(', ')}`);
      checkPoints(feature.path, 2, 'path', base, file, ctx, out);
      if (feature.width !== undefined && !constraintPositive(feature.width)) bad('width', 'width must be a number above 0');
      break;
    case 'square':
      checkPoints(feature.polygon, 3, 'polygon', base, file, ctx, out);
      break;
    case 'bridge':
      if (Array.isArray(feature.path) && feature.path.length !== 2) bad('path', 'a bridge path has exactly two points');
      else checkPoints(feature.path, 2, 'path', base, file, ctx, out);
      if (!constraintPositive(feature.width)) bad('width', 'width must be a number above 0');
      break;
    default:
      bad('type', `type must be one of ${FEATURE_TYPES.streets.join(', ')}`);
  }
}

/** A block: a polygon, a character and its lots (each a kind, a point, a size and an angle). */
function checkBlockFeature(feature, base, file, ctx, out) {
  const bad = (field, message) => out.push(problem('bad-feature', file, `${base}.${field}`, message));
  checkTyped('blocks', feature, base, file, ctx, out);
  if (!CHARACTERS.includes(feature.character)) bad('character', `character must be one of ${CHARACTERS.join(', ')}`);
  if (!Array.isArray(feature.lots)) {
    bad('lots', 'lots must be a list');
    return;
  }
  feature.lots.forEach((lot, k) => {
    const where = `${base}.lots[${k}]`;
    if (!isPlainObject(lot)) {
      out.push(problem('bad-feature', file, where, 'a lot is an object'));
      return;
    }
    if (!LOT_KINDS.includes(lot.kind)) out.push(problem('bad-feature', file, `${where}.kind`, `kind must be one of ${LOT_KINDS.join(', ')}`));
    checkPoint(lot.at, `${where}.at`, ctx, file, out);
    if (!isSizePair(lot.size)) out.push(problem('bad-feature', file, `${where}.size`, 'size is [w, h], both above 0'));
    if (!isAngle(lot.angle)) out.push(problem('bad-feature', file, `${where}.angle`, 'angle must be a finite number (radians)'));
  });
}

/** A building: a place sheet (id equals place), a point on a block or a square, a kind, optional size and angle. */
function checkBuildingFeature(feature, base, file, ctx, out) {
  checkPlaceRef(feature, base, file, ctx, out);
  checkPoint(feature.at, `${base}.at`, ctx, file, out);
  if (!BUILDING_KINDS.includes(feature.kind)) {
    out.push(problem('bad-feature', file, `${base}.kind`, `kind must be one of ${BUILDING_KINDS.join(', ')}`));
  }
  if (feature.size !== undefined && !isSizePair(feature.size)) out.push(problem('bad-feature', file, `${base}.size`, 'size is [w, h], both above 0'));
  if (feature.angle !== undefined && !isAngle(feature.angle)) out.push(problem('bad-feature', file, `${base}.angle`, 'angle must be a finite number (radians)'));
}

/** A district: a political-style feature of type district, with an optional character. */
function checkDistrictFeature(feature, base, file, ctx, out) {
  checkPolitical(feature, base, file, ctx, out, 'district');
  if (feature.character !== undefined && !CHARACTERS.includes(feature.character)) {
    out.push(problem('bad-feature', file, `${base}.character`, `character must be one of ${CHARACTERS.join(', ')}`));
  }
}

function checkLabel(feature, base, file, ctx, out) {
  const match = typeof feature.target === 'string' ? /^([a-z]+)\/(.+)$/.exec(feature.target) : null;
  const targetLayers = LAYERS.filter((l) => l !== 'labels');
  if (match === null || !targetLayers.includes(match[1]) || !ctx.featureIds.get(match[1])?.has(match[2])) {
    out.push(problem('unknown-label-target', file, `${base}.target`, 'target must be "<layer>/<id>" of an existing feature'));
  }
  if (feature.text !== undefined && typeof feature.text !== 'string') {
    out.push(problem('bad-feature', file, `${base}.text`, 'text must be a string'));
  }
  if (feature.at !== undefined) checkPoint(feature.at, `${base}.at`, ctx, file, out);
  if (feature.size !== undefined && !(typeof feature.size === 'number' && feature.size > 0)) {
    out.push(problem('bad-feature', file, `${base}.size`, 'size must be a number above 0'));
  }
  if (feature.hidden !== undefined && typeof feature.hidden !== 'boolean') {
    out.push(problem('bad-feature', file, `${base}.hidden`, 'hidden must be a boolean'));
  }
}

function checkFeatureShape(name, feature, base, file, ctx, out) {
  switch (name) {
    case 'terrain':
    case 'relief':
    case 'water':
    case 'biomes':
      checkTyped(name, feature, base, file, ctx, out);
      if (name === 'biomes' && feature.variant !== undefined && (feature.type !== 'forest' || !FOREST_VARIANTS.includes(feature.variant))) {
        out.push(problem('bad-feature', file, `${base}.variant`, `variant is only for a forest and must be one of ${FOREST_VARIANTS.join(', ')}`));
      }
      break;
    case 'political':
      checkPolitical(feature, base, file, ctx, out);
      break;
    case 'places':
      checkPlace(feature, base, file, ctx, out);
      break;
    case 'routes':
      checkRoute(feature, base, file, ctx, out);
      break;
    case 'ground':
    case 'green':
      checkTyped(name, feature, base, file, ctx, out);
      break;
    case 'walls':
      checkWallFeature(feature, base, file, ctx, out);
      break;
    case 'streets':
      checkStreetFeature(feature, base, file, ctx, out);
      break;
    case 'blocks':
      checkBlockFeature(feature, base, file, ctx, out);
      break;
    case 'buildings':
      checkBuildingFeature(feature, base, file, ctx, out);
      break;
    case 'districts':
      checkDistrictFeature(feature, base, file, ctx, out);
      break;
    default:
      checkLabel(feature, base, file, ctx, out);
  }
}

/**
 * Problems of one layer file. `ctx` carries the canvas, the root, the world index and the ids
 * of the places and of every layer (see validateAtlas).
 */
export function layerProblems(name, layer, ctx) {
  const file = `${name}.json`;
  if (!isPlainObject(layer)) return [problem('bad-layer', file, '', 'layer file must be an object')];
  const out = [];
  if (layer.layer !== name) out.push(problem('bad-layer', file, 'layer', `layer must be "${name}"`));
  if (!Array.isArray(layer.constraints) || !layer.constraints.every(isPlainObject)) {
    out.push(problem('bad-layer', file, 'constraints', 'constraints must be a list of objects'));
  } else {
    layer.constraints.forEach((constraint, k) => {
      checkConstraint(name, constraint, `constraints[${k}]`, file, ctx, out);
    });
    checkDuplicateConstraintIds(layer.constraints, file, out);
  }
  if (!Array.isArray(layer.features)) {
    out.push(problem('bad-layer', file, 'features', 'features must be a list'));
    return out;
  }
  const seen = new Set();
  layer.features.forEach((feature, i) => {
    const base = `features[${i}]`;
    if (!isPlainObject(feature)) {
      out.push(problem('bad-feature', file, base, 'a feature is an object'));
      return;
    }
    if (typeof feature.id === 'string' && seen.has(feature.id)) {
      out.push(problem('duplicate-id', file, `${base}.id`, `duplicate id ${feature.id} in ${name}`));
    } else if (typeof feature.id === 'string') {
      seen.add(feature.id);
    }
    checkCommon(feature, base, file, ctx, out);
    checkFeatureShape(name, feature, base, file, ctx, out);
  });
  return out;
}

/** Cross-layer checks of the geographic and the urban layers. */
export function crossLayerProblems(layers, ctx) {
  return [...geographicCrossProblems(layers, ctx), ...urbanCrossProblems(layers)];
}

/** Urban cross-layer checks: a building is not in water, and it stands on a block or a square when there are any. */
function urbanCrossProblems(layers) {
  const featuresOf = (name) => (Array.isArray(layers[name]?.features) ? layers[name].features.filter(isPlainObject) : []);
  const water = featuresOf('ground').filter((f) => f.type === 'water' && isUsablePolygon(f.polygon)).map((f) => f.polygon);
  const blocks = [
    ...featuresOf('blocks').filter((f) => f.type === 'block' && isUsablePolygon(f.polygon)),
    ...featuresOf('streets').filter((f) => f.type === 'square' && isUsablePolygon(f.polygon)),
  ].map((f) => f.polygon);

  const out = [];
  featuresOf('buildings').forEach((feature, i) => {
    if (!isFinitePoint(feature.at)) return;
    const where = `features[${i}].at`;
    if (water.some((polygon) => pointInPolygon(feature.at, polygon))) {
      out.push(problem('building-in-water', 'buildings.json', where, `${feature.id} is in water`));
    }
    if (blocks.length > 0 && !blocks.some((polygon) => pointInPolygon(feature.at, polygon))) {
      out.push(problem('building-not-on-block', 'buildings.json', where, `${feature.id} is not on a block or a square`));
    }
  });
  return out;
}

/** Geographic cross-layer checks: places must not be in the sea, nor inside a lake. Run only when there is land. */
function geographicCrossProblems(layers, ctx) {
  const terrain = Array.isArray(layers.terrain?.features) ? layers.terrain.features.filter(isPlainObject) : [];
  if (!terrain.some((f) => f.type === 'land')) return [];

  const landPolygons = terrain.filter((f) => f.type === 'land' && isUsablePolygon(f.polygon)).map((f) => f.polygon);
  const lakePolygons = [
    ...terrain.filter((f) => f.type === 'lake' && isUsablePolygon(f.polygon)),
    ...(Array.isArray(layers.water?.features) ? layers.water.features : [])
      .filter((f) => isPlainObject(f) && f.type === 'lake' && isUsablePolygon(f.polygon)),
  ].map((f) => f.polygon);

  const out = [];
  const places = Array.isArray(layers.places?.features) ? layers.places.features : [];
  places.forEach((feature, i) => {
    if (!isPlainObject(feature) || !isFinitePoint(feature.at)) return;
    const where = `features[${i}].at`;
    if (!landPolygons.some((polygon) => pointInPolygon(feature.at, polygon))) {
      out.push(problem('place-in-sea', 'places.json', where, `${feature.id} is not on land`));
    }
    if (lakePolygons.some((polygon) => pointInPolygon(feature.at, polygon))) {
      out.push(problem('place-in-lake', 'places.json', where, `${feature.id} is inside a lake`));
    }
  });
  if (ctx.canvas) {
    // A port must be on the coast: within four grid cells of water (sea or lake).
    const mask = landMask({ canvas: ctx.canvas, terrain: layers.terrain });
    places.forEach((feature, i) => {
      if (!isPlainObject(feature) || !isFinitePoint(feature.at) || feature.icon !== 'port') return;
      if (mask.waterDistance(feature.at[0], feature.at[1]) > mask.cell * 4) {
        out.push(problem('port-not-coast', 'places.json', `features[${i}].at`, `${feature.id} is a port too far from the water`));
      }
    });
  }
  return out;
}

function featureIdsOf(layers) {
  const ids = new Map();
  for (const name of LAYERS) {
    const features = Array.isArray(layers[name]?.features) ? layers[name].features : [];
    ids.set(name, new Set(features.filter((f) => isPlainObject(f) && typeof f.id === 'string').map((f) => f.id)));
  }
  return ids;
}

/**
 * Validates the whole atlas: the manifest, every layer, the locks and the cross-layer checks.
 * @param {string} root campaign folder
 * @param {{ manifest: object|undefined, layers: object, errors: object[] }} atlas as read by readAtlas
 * @param {{ worldIndex?: object }} [options] the world index; built from root when omitted
 * @returns {object[]} problems sorted by file then path, files campaign-relative
 */
export function validateAtlas(root, atlas, { worldIndex } = {}) {
  const folder = atlasFolder(root);
  if (folder === null) {
    return [problem('no-atlas', 'campaign.yaml', 'structure', 'campaign.yaml declares no atlas folder')];
  }
  const index = worldIndex ?? buildWorldIndex(root);
  const layers = atlas.layers ?? {};
  const manifest = atlas.manifest;
  const problems = [...(atlas.errors ?? [])];

  if (manifest !== undefined) {
    problems.push(...manifestProblems(manifest));
  } else if (!problems.some((p) => p.file === MANIFEST_FILE)) {
    problems.push(problem('bad-manifest', MANIFEST_FILE, '', 'atlas.json is missing'));
  }

  const canvas = isPlainObject(manifest?.canvas) && Number.isInteger(manifest.canvas.width)
    && Number.isInteger(manifest.canvas.height)
    ? manifest.canvas
    : null;
  const ctx = {
    root,
    canvas,
    byId: new Map(index.subjects.map((s) => [s.id, s])),
    placeIds: new Set((Array.isArray(layers.places?.features) ? layers.places.features : []).map((f) => f?.id)),
    featureIds: featureIdsOf(layers),
  };

  const kind = manifest?.scope?.kind;
  if (SCOPE_KINDS.includes(kind)) {
    const allowed = layersForScope(kind);
    for (const name of LAYERS) {
      if (layers[name] !== undefined && !allowed.includes(name)) {
        problems.push(problem('wrong-scale-layer', `${name}.json`, '', `${name} is not a layer of a ${kind} atlas`));
      }
    }
  }

  for (const name of LAYERS) {
    if (layers[name] !== undefined) problems.push(...layerProblems(name, layers[name], ctx));
  }
  problems.push(...lockProblems(manifest, layers));
  problems.push(...crossLayerProblems(layers, ctx));

  return prefixProblems(folder, problems).sort(
    (a, b) => compareText(a.file, b.file) || compareText(a.path, b.path) || compareText(a.code, b.code),
  );
}
