/**
 * Deterministic torn-paper shapes for the cockpit cards. Everything here is a pure function of the
 * card id: the same id gives the same edge and the same tilt on every start and every update.
 */

/** Largest inward jitter of an edge point, in percent of the card box. */
const DEFAULT_AMPLITUDE = 2.5;
/** Segments per edge; the corners are never moved. */
const DEFAULT_STEPS = 6;
/** Tilt range in degrees, symmetric around zero. */
const TILT_LIMIT = 1.5;

/** FNV-1a 32-bit hash of a string: the seed of every value derived from an id. */
export function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a small seeded generator returning values in [0, 1). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A CSS `clip-path: polygon(...)` value (percentages) for a torn edge. The four corners stay on the
 * box; every edge gets `steps - 1` points that move inward by 0 to `amplitude` percent.
 */
export function tornEdgePolygon(
  id: string,
  opts: { amplitude?: number; steps?: number } = {},
): string {
  const amplitude = opts.amplitude ?? DEFAULT_AMPLITUDE;
  const steps = Math.max(2, Math.floor(opts.steps ?? DEFAULT_STEPS));
  const random = seededRandom(hashId(id));
  const points: string[] = ["0% 0%"];
  // pinned: the axis that stays fixed on this edge ("y" for top and bottom). The other axis runs
  // from `from` to `to`; the fixed one is pushed by 0 to amplitude percent times `inward`.
  const edge = (pinnedAxis: "x" | "y", from: number, to: number, pinned: number, inward: number) => {
    for (let i = 1; i < steps; i++) {
      const along = from + ((to - from) * i) / steps;
      const at = pinned + random() * amplitude * inward;
      points.push(
        pinnedAxis === "y"
          ? `${round(along)}% ${round(at)}%`
          : `${round(at)}% ${round(along)}%`,
      );
    }
  };
  // Clockwise from the top-left corner. Inward: top edge goes down, right edge goes left, and so on.
  edge("y", 0, 100, 0, 1); // top: left to right, moves down
  points.push("100% 0%");
  edge("x", 0, 100, 100, -1); // right: top to bottom, moves left
  points.push("100% 100%");
  edge("y", 100, 0, 100, -1); // bottom: right to left, moves up
  points.push("0% 100%");
  edge("x", 100, 0, 0, 1); // left: bottom to top, moves right
  return `polygon(${points.join(", ")})`;
}

/** A fixed tilt in degrees, between -1.5 and +1.5, derived from the id. */
export function tiltDegrees(id: string): number {
  const random = seededRandom(hashId(id));
  return round((random() * 2 - 1) * TILT_LIMIT, 2);
}

/** The tilt as a CSS angle, for a custom property: `-0.42deg`. */
export function tiltCss(id: string): string {
  return `${tiltDegrees(id)}deg`;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
