// Synthetic terrain for an atlas that has no terrain layer (an urban atlas: a settlement or a district).
// The geographic generators (relief, biomes, water, political, routes) need a terrain layer. Without one,
// the land is the first island of the ground layer when there is one, otherwise the whole canvas. The water
// of the ground layer that is a river, a canal or a pond becomes a lake; the sea pieces of an island are not
// lakes. Nothing here is written to disk: the layers of the atlas stay as they are, and this terrain only
// feeds the generators in memory (see withTerrain).
// Ambiguity resolved: a lake keeps the provenance, visibility and sources of its ground feature; the land
// keeps the fixed values of the spec (agent-choice, public, no sources), as in lib/terrain.mjs.

import { isUsablePolygon } from '../geometry.mjs';

const LAKE_KINDS = ['river', 'canal', 'pond'];

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const copyPolygon = (polygon) => polygon.map(([x, y]) => [x, y]);
const featuresOf = (layer) => (Array.isArray(layer?.features) ? layer.features.filter(isPlainObject) : []);

/**
 * The terrain layer `{ layer: 'terrain', constraints: [], features }` of an atlas without one.
 * @param {{ canvas: { width: number, height: number }, layers?: object }} input
 * @returns {{ layer: 'terrain', constraints: [], features: object[] }}
 */
export function syntheticTerrain({ canvas, layers = {} }) {
  const ground = featuresOf(layers.ground);
  const island = ground.find((f) => f.type === 'land' && isUsablePolygon(f.polygon));
  const outline = island
    ? copyPolygon(island.polygon)
    : [[0, 0], [canvas.width, 0], [canvas.width, canvas.height], [0, canvas.height]];
  const land = {
    id: 'land-1',
    type: 'land',
    polygon: outline,
    provenance: 'agent-choice',
    visibility: 'public',
    sources: [],
  };
  const lakes = ground
    .filter((f) => f.type === 'water' && LAKE_KINDS.includes(f.kind) && isUsablePolygon(f.polygon))
    .map((f) => ({
      id: f.id,
      type: 'lake',
      polygon: copyPolygon(f.polygon),
      provenance: f.provenance ?? 'agent-choice',
      visibility: f.visibility ?? 'public',
      sources: Array.isArray(f.sources) ? f.sources.map((s) => ({ ...s })) : [],
    }));
  return { layer: 'terrain', constraints: [], features: [land, ...lakes] };
}

/**
 * The layers the geographic generators read. When the terrain layer already has land, the layers are returned
 * unchanged (the same object). Otherwise a synthetic terrain is added, and the input is not modified.
 * @param {object} layers the layers of the atlas, by name
 * @param {{ width: number, height: number }} canvas
 */
export function withTerrain(layers, canvas) {
  const current = layers ?? {};
  if (featuresOf(current.terrain).some((f) => f.type === 'land')) return layers;
  return { ...current, terrain: syntheticTerrain({ canvas, layers: current }) };
}
