// Path search for the atlas: a binary heap and A* on the layer grid. Deterministic: the same grid
// and the same endpoints always give the same path. No file access.

const SQRT2 = Math.SQRT2;

/** Binary min-heap ordered by `compare(a, b)`: negative when a comes first, as with Array.sort. */
export class MinHeap {
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    const a = this.items;
    a.push(item);
    let k = a.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (this.compare(a[k], a[parent]) >= 0) break;
      [a[k], a[parent]] = [a[parent], a[k]];
      k = parent;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const left = 2 * k + 1;
        const right = left + 1;
        let smallest = k;
        if (left < a.length && this.compare(a[left], a[smallest]) < 0) smallest = left;
        if (right < a.length && this.compare(a[right], a[smallest]) < 0) smallest = right;
        if (smallest === k) break;
        [a[k], a[smallest]] = [a[smallest], a[k]];
        k = smallest;
      }
    }
    return top;
  }
}

const compareNodes = (a, b) => a.f - b.f || a.h - b.h || a.j - b.j || a.i - b.i;

/**
 * A* over the grid cells (i, j), 8-neighbour. A diagonal step is allowed only when both
 * orthogonal cells next to it are passable, so a path never slips between two blocked corners.
 * The step cost is 1 (or the square root of 2 on a diagonal) times `cost(i, j)` of the cell entered,
 * in canvas units (times `cell`). `minCost` is the smallest value `cost` can return: it keeps the
 * octile heuristic admissible when some cells are cheaper than 1.
 * @returns {number[][] | null} cells from start to goal as [i, j], or null when there is no path
 */
export function aStar({ gw, gh, cell, passable, cost, start, goal, minCost = 1 }) {
  const [si, sj] = start;
  const [gi, gj] = goal;
  if (!passable(si, sj) || !passable(gi, gj)) return null;
  if (si === gi && sj === gj) return [[si, sj]];

  const size = gw * gh;
  const g = new Float64Array(size).fill(Infinity);
  const closed = new Uint8Array(size);
  const parent = new Int32Array(size).fill(-1);
  const heuristic = (i, j) => {
    const dx = Math.abs(i - gi);
    const dy = Math.abs(j - gj);
    return cell * minCost * (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy));
  };

  const open = new MinHeap(compareNodes);
  const startIndex = sj * gw + si;
  g[startIndex] = 0;
  open.push({ f: heuristic(si, sj), h: heuristic(si, sj), j: sj, i: si, g: 0, index: startIndex });

  while (open.size > 0) {
    const node = open.pop();
    if (closed[node.index] === 1 || node.g !== g[node.index]) continue;
    if (node.i === gi && node.j === gj) {
      const cells = [];
      for (let at = node.index; at !== -1; at = parent[at]) {
        cells.push([at % gw, Math.floor(at / gw)]);
      }
      return cells.reverse();
    }
    closed[node.index] = 1;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ni = node.i + di;
        const nj = node.j + dj;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        if (!passable(ni, nj)) continue;
        const diagonal = di !== 0 && dj !== 0;
        if (diagonal && (!passable(node.i + di, node.j) || !passable(node.i, node.j + dj))) continue;
        const index = nj * gw + ni;
        if (closed[index] === 1) continue;
        const stepCost = cell * (diagonal ? SQRT2 : 1) * cost(ni, nj);
        const nextG = node.g + stepCost;
        if (nextG < g[index]) {
          g[index] = nextG;
          parent[index] = node.index;
          const h = heuristic(ni, nj);
          open.push({ f: nextG + h, h, j: nj, i: ni, g: nextG, index });
        }
      }
    }
  }
  return null;
}
