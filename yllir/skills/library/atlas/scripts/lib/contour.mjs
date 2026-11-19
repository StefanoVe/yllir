// Contours of a sampled field and ring tools for the atlas: marching squares to closed rings,
// signed area, Ramer-Douglas-Peucker simplification and Chaikin smoothing.
// Canvas coordinates, y grows downwards. Samples outside the grid count as sea.

const SEA = -1;

/**
 * Closed rings of the isoline `threshold` of a field sampled on a grid.
 * Sample (i, j) of the field (index j * gw + i) lies at (i * cell, j * cell).
 * The grid is surrounded by sea, so every ring is closed, including the ones that reach the edge.
 * Saddles are resolved with the average of the four corners.
 * @param {ArrayLike<number>} field gw * gh values
 * @returns {number[][][]} rings, each a list of [x, y]; the points are not rounded
 */
export function marchingSquares(field, gw, gh, cell, threshold = 0) {
  const sample = (p, q) => {
    const i = p - 1;
    const j = q - 1;
    return i >= 0 && i < gw && j >= 0 && j < gh ? field[j * gw + i] : SEA;
  };
  const coord = (p) => (p - 1) * cell;
  const inside = (v) => v > threshold;
  const points = new Map();
  const adjacency = new Map();

  /** Key and crossing point of the edge between two neighbouring padded samples, or null. */
  function edge(p, q, r, s) {
    const va = sample(p, q);
    const vb = sample(r, s);
    if (inside(va) === inside(vb)) return null;
    const key = p === r ? `v${p},${Math.min(q, s)}` : `h${Math.min(p, r)},${q}`;
    if (!points.has(key)) {
      const t = (threshold - va) / (vb - va);
      points.set(key, [coord(p) + t * (coord(r) - coord(p)), coord(q) + t * (coord(s) - coord(q))]);
    }
    return key;
  }

  function link(a, b) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }

  for (let q = 0; q <= gh; q++) {
    for (let p = 0; p <= gw; p++) {
      const top = edge(p, q, p + 1, q);
      const right = edge(p + 1, q, p + 1, q + 1);
      const bottom = edge(p, q + 1, p + 1, q + 1);
      const left = edge(p, q, p, q + 1);
      const crossed = [top, right, bottom, left].filter((k) => k !== null);
      if (crossed.length === 2) {
        link(crossed[0], crossed[1]);
      } else if (crossed.length === 4) {
        const va = sample(p, q);
        const vb = sample(p + 1, q);
        const vc = sample(p + 1, q + 1);
        const vd = sample(p, q + 1);
        const centreInside = (va + vb + vc + vd) / 4 > threshold;
        const cutInside = !centreInside;
        // The corners cut off are the ones whose inside state is cutInside; each is bounded by two edges.
        const corners = [
          [inside(va), top, left],
          [inside(vb), top, right],
          [inside(vc), right, bottom],
          [inside(vd), bottom, left],
        ];
        for (const [state, e1, e2] of corners) {
          if (state === cutInside) link(e1, e2);
        }
      }
    }
  }

  const rings = [];
  const seen = new Set();
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const ring = [];
    let previous = null;
    let current = start;
    let valid = true;
    do {
      const neighbours = adjacency.get(current);
      if (!neighbours || neighbours.length !== 2) {
        valid = false;
        break;
      }
      seen.add(current);
      ring.push(points.get(current));
      const next = neighbours[0] !== previous ? neighbours[0] : neighbours[1];
      previous = current;
      current = next;
    } while (current !== start);
    if (valid && ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** Signed shoelace area of a closed ring: positive for one orientation, negative for the other. */
export function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer-Douglas-Peucker on an open polyline; keeps both ends. */
function douglasPeucker(points, tolerance) {
  const n = points.length;
  if (n < 3) return points.slice();
  const keep = new Array(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack = [[0, n - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop();
    let best = -1;
    let index = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segmentDistance(points[i], points[s], points[e]);
      if (d > best) {
        best = d;
        index = i;
      }
    }
    if (index !== -1 && best > tolerance) {
      keep[index] = true;
      stack.push([s, index], [index, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Ramer-Douglas-Peucker on a closed ring. The ring is cut at its point farthest from the first one.
 * The result has at least 3 points and no repeated closing point.
 */
export function simplify(ring, tolerance) {
  if (ring.length <= 3) return ring.map((p) => [p[0], p[1]]);
  let far = 1;
  let farDistance = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > farDistance) {
      farDistance = d;
      far = i;
    }
  }
  const first = douglasPeucker(ring.slice(0, far + 1), tolerance);
  const second = douglasPeucker([...ring.slice(far), ring[0]], tolerance);
  const out = [...first.slice(0, -1), ...second.slice(0, -1)];
  if (out.length >= 3) return out;
  const n = ring.length;
  return [ring[0], ring[Math.floor(n / 3)], ring[Math.floor((2 * n) / 3)]];
}

/** Chaikin corner cutting on a closed ring, repeated `iterations` times. */
export function smooth(ring, iterations = 2) {
  let current = ring;
  for (let round = 0; round < iterations; round++) {
    const next = [];
    for (let i = 0; i < current.length; i++) {
      const [px, py] = current[i];
      const [qx, qy] = current[(i + 1) % current.length];
      next.push([0.75 * px + 0.25 * qx, 0.75 * py + 0.25 * qy], [0.25 * px + 0.75 * qx, 0.25 * py + 0.75 * qy]);
    }
    current = next;
  }
  return current;
}
