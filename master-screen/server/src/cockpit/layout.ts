/**
 * Pure geometry for the cockpit board: placement of cards and frames,
 * frame fitting and the automatic layout. The model never computes pixels.
 */
import dagre from "@dagrejs/dagre";
import type {
  Board,
  BoardModule,
  Frame,
  ModuleKind,
  Rect,
} from "../../../shared/src/cockpit-types.js";

export const GAP = 24;
export const FRAME_PAD = 24;
export const FRAME_HEADER = 48;
export const FRAME_COLUMNS = 3;
export const MIN_FRAME = { w: 320, h: 200 };

/**
 * Width a frame needs so its title fits on one line at TITLE_FONT canvas px
 * (the canvas enlarges titles when zoomed out; this size keeps them whole and
 * readable down to about 30% zoom). Average glyph ≈ 0.56 em.
 */
const TITLE_FONT = 30;
export function titleWidth(title: string): number {
  return Math.round(
    FRAME_PAD * 2 + [...(title ?? "")].length * TITLE_FONT * 0.56,
  );
}

/** Minimum width of a frame: MIN_FRAME or what its title needs. */
export function minFrameWidth(title: string): number {
  return Math.max(MIN_FRAME.w, titleWidth(title));
}

const ARRANGE_COLUMNS = 6;
const NEAR_STEPS = 200;
/** Isolated frames wrap at this width when the connected graph is narrower. */
const ROW_WIDTH = 2400;
const FRAME_FLOW = { nodesep: 24, ranksep: 64 };
const BOARD_FLOW = { nodesep: 48, ranksep: 120 };

type Size = { w: number; h: number };
type Pos = { x: number; y: number };
/** Positions keyed by item id. */
type Slots = Map<string, Pos>;
/** Anything with an id and a size that dagre or a grid can place. */
type Item = Size & { id: string };
/** Top-level node: a frame (`f:` key) or a loose card (`c:` key), with its previous position. */
type TopNode = Item & Pos;
type Edge = [string, string];
type FrameLayout = { frame: Frame; slots: Slots };

/** Default card size for a module kind. */
export function defaultSize(kind: ModuleKind): Size {
  switch (kind) {
    case "map":
    case "battlemap":
    case "image":
      return { w: 380, h: 260 };
    case "music":
      return { w: 260, h: 96 };
    case "note":
      return { w: 240, h: 150 };
    case "item":
      // Printed item cards are 585×720: keep their proportions.
      return { w: 240, h: 290 };
    default:
      return { w: 260, h: 180 };
  }
}

/** True when `a`, grown by `gap` on every side, intersects `b`. */
export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x - gap < b.x + b.w &&
    a.x + a.w + gap > b.x &&
    a.y - gap < b.y + b.h &&
    a.y + a.h + gap > b.y
  );
}

/** Bounding box of all cards and frames, or null for an empty board. */
export function boardBounds(board: Board): Rect | null {
  const rects: Rect[] = [...board.modules, ...board.frames];
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Position for a new card of `size`, inside a frame, near a target or to the right of the board. */
export function placeCard(
  board: Board,
  size: Size,
  opts: { frameId?: string; near?: string } = {},
): { x: number; y: number } {
  const frame = opts.frameId ? findFrame(board, opts.frameId) : undefined;
  if (frame) return placeInFrame(board, frame, size);
  const target = opts.near ? findRect(board, opts.near) : undefined;
  if (target) return placeNear(board, target, size);
  return placeRightOfBoard(board, size);
}

/** Position for a new frame of `size`, near a target or to the right of the board. */
export function placeFrame(
  board: Board,
  size: Size,
  opts: { near?: string } = {},
): { x: number; y: number } {
  const target = opts.near ? findRect(board, opts.near) : undefined;
  if (target) return placeNear(board, target, size);
  return placeRightOfBoard(board, size);
}

/** Grows a frame so it contains all its cards plus padding; never shrinks it. */
export function fitFrame(board: Board, frameId: string): Board {
  const frame = findFrame(board, frameId);
  if (!frame) return board;
  const cards = cardsIn(board, frameId);
  const fitted = growToContain(frame, cards);
  return {
    ...board,
    frames: board.frames.map((f) => (f.id === frameId ? fitted : f)),
  };
}

/** Moves a frame to (x, y) and translates its cards by the same delta. */
export function moveFrame(
  board: Board,
  frameId: string,
  x: number,
  y: number,
): Board {
  const frame = findFrame(board, frameId);
  if (!frame) return board;
  const newX = Math.round(x);
  const newY = Math.round(y);
  const dx = newX - frame.x;
  const dy = newY - frame.y;
  return {
    ...board,
    frames: board.frames.map((f) =>
      f.id === frameId ? { ...f, x: newX, y: newY } : f,
    ),
    modules: board.modules.map((m) =>
      m.frameId === frameId ? shiftCard(m, dx, dy) : m,
    ),
  };
}

/** Full automatic layout: each frame's linked cards flow inside it, then frames and loose cards flow by their links. */
export function arrange(board: Board): Board {
  const layouts = board.frames.map((frame) => layoutFrame(board, frame));
  const frameNodes = layouts.map(({ frame }) =>
    topNode(frameKey(frame.id), frame),
  );
  const looseNodes = board.modules
    .filter((m) => !frameExists(board, m.frameId))
    .map((card) => topNode(cardKey(card.id), card));
  const positions = placeTopLevel(
    [...frameNodes, ...looseNodes],
    topEdges(board),
  );
  return applyLayout(board, layouts, positions);
}

// ───────────────────────────── helpers ─────────────────────────────

function findFrame(board: Board, id: string): Frame | undefined {
  return board.frames.find((f) => f.id === id);
}

function frameExists(board: Board, frameId: string | undefined): boolean {
  return frameId !== undefined && findFrame(board, frameId) !== undefined;
}

/** Looks up a card or a frame by id. */
function findRect(board: Board, id: string): Rect | undefined {
  return board.modules.find((m) => m.id === id) ?? findFrame(board, id);
}

function cardsIn(board: Board, frameId: string): BoardModule[] {
  return board.modules.filter((m) => m.frameId === frameId);
}

function shiftCard(card: BoardModule, dx: number, dy: number): BoardModule {
  return { ...card, x: Math.round(card.x + dx), y: Math.round(card.y + dy) };
}

function growToContain(frame: Frame, cards: BoardModule[]): Frame {
  const left = Math.min(frame.x, ...cards.map((c) => c.x));
  const top = Math.min(frame.y, ...cards.map((c) => c.y - FRAME_HEADER));
  const right = Math.max(
    frame.x + frame.w,
    ...cards.map((c) => c.x + c.w + FRAME_PAD),
  );
  const bottom = Math.max(
    frame.y + frame.h,
    ...cards.map((c) => c.y + c.h + FRAME_PAD),
  );
  return {
    ...frame,
    x: Math.round(left),
    y: Math.round(top),
    w: Math.round(Math.max(right - left, minFrameWidth(frame.title))),
    h: Math.round(Math.max(bottom - top, MIN_FRAME.h)),
  };
}

/** First slot of the frame grid, row-major, that no existing card of the frame occupies. */
function placeInFrame(
  board: Board,
  frame: Frame,
  size: Size,
): { x: number; y: number } {
  const cards = cardsIn(board, frame.id);
  const cellW = Math.max(size.w, ...cards.map((c) => c.w));
  const cellH = Math.max(size.h, ...cards.map((c) => c.h));
  for (let index = 0; ; index++) {
    const col = index % FRAME_COLUMNS;
    const row = Math.floor(index / FRAME_COLUMNS);
    const slot = {
      x: frame.x + FRAME_PAD + col * (cellW + GAP),
      y: frame.y + FRAME_HEADER + row * (cellH + GAP),
      w: cellW,
      h: cellH,
    };
    if (!cards.some((c) => overlaps(slot, c))) {
      return { x: Math.round(slot.x), y: Math.round(slot.y) };
    }
  }
}

function placeNear(
  board: Board,
  target: Rect,
  size: Size,
): { x: number; y: number } {
  return (
    firstFree(nearCandidates(target, size), board, size) ??
    placeRightOfBoard(board, size)
  );
}

/** Right and below the target, then further in steps; alternates right and below. */
function nearCandidates(target: Rect, size: Size): { x: number; y: number }[] {
  const candidates: { x: number; y: number }[] = [];
  for (let step = 0; step < NEAR_STEPS; step++) {
    candidates.push({
      x: target.x + target.w + GAP,
      y: target.y + step * (size.h + GAP),
    });
    candidates.push({
      x: target.x + step * (size.w + GAP),
      y: target.y + target.h + GAP,
    });
  }
  return candidates;
}

function placeRightOfBoard(board: Board, size: Size): { x: number; y: number } {
  const bounds = boardBounds(board);
  if (!bounds) return { x: 0, y: 0 };
  const startX = bounds.x + bounds.w + GAP * 2;
  const candidates = Array.from({ length: NEAR_STEPS }, (_, step) => ({
    x: startX + step * (size.w + GAP),
    y: bounds.y,
  }));
  return firstFree(candidates, board, size) ?? candidates[0];
}

/** First candidate that overlaps no frame and no card (with GAP spacing), rounded. */
function firstFree(
  candidates: { x: number; y: number }[],
  board: Board,
  size: Size,
): { x: number; y: number } | undefined {
  const obstacles: Rect[] = [...board.frames, ...board.modules];
  for (const c of candidates) {
    const rect = { x: c.x, y: c.y, w: size.w, h: size.h };
    if (!obstacles.some((o) => overlaps(rect, o, GAP))) {
      return { x: Math.round(c.x), y: Math.round(c.y) };
    }
  }
  return undefined;
}

function sortByPosition<T extends Pos>(items: T[]): T[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

// ─────────────────────────── frame content ───────────────────────────

/** Lays out one frame's cards relative to the frame origin and sizes the frame to fit them. */
function layoutFrame(board: Board, frame: Frame): FrameLayout {
  const cards = sortByPosition(cardsIn(board, frame.id));
  if (cards.length === 0) {
    return {
      frame: { ...frame, ...MIN_FRAME, w: minFrameWidth(frame.title) },
      slots: new Map(),
    };
  }
  const content = layoutFrameContent(cards, innerLinks(board, cards));
  const size = extentOf(cards, content);
  const slots: Slots = new Map(
    [...content].map(([id, p]): [string, Pos] => [
      id,
      { x: p.x + FRAME_PAD, y: p.y + FRAME_HEADER },
    ]),
  );
  return {
    frame: {
      ...frame,
      w: Math.round(
        Math.max(size.w + FRAME_PAD * 2, minFrameWidth(frame.title)),
      ),
      h: Math.round(Math.max(size.h + FRAME_HEADER + FRAME_PAD, MIN_FRAME.h)),
    },
    slots,
  };
}

/** Links whose both endpoints are cards of the frame; self-loops are skipped. */
function innerLinks(board: Board, cards: BoardModule[]): Edge[] {
  const ids = new Set(cards.map((c) => c.id));
  return board.links
    .filter((l) => l.from !== l.to && ids.has(l.from) && ids.has(l.to))
    .map((l): Edge => [l.from, l.to]);
}

/** Grid when nothing is linked; otherwise linked cards by dagre, unlinked cards in a grid below. */
function layoutFrameContent(cards: BoardModule[], edges: Edge[]): Slots {
  if (edges.length === 0) return gridSlots(cards, 0, FRAME_COLUMNS);
  const linkedIds = new Set(edges.flat());
  const linked = cards.filter((c) => linkedIds.has(c.id));
  const loose = cards.filter((c) => !linkedIds.has(c.id));
  const slots = runDagre(linked, edges, FRAME_FLOW);
  const top = extentOf(linked, slots).h + GAP;
  for (const [id, p] of gridSlots(loose, top, FRAME_COLUMNS)) slots.set(id, p);
  return slots;
}

// ─────────────────────────── board level ───────────────────────────

function frameKey(id: string): string {
  return `f:${id}`;
}

function cardKey(id: string): string {
  return `c:${id}`;
}

function topNode(id: string, rect: Rect): TopNode {
  return { id, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

/** Node a link endpoint maps to at board level: its frame when the card sits in one. */
function topKey(board: Board, id: string): string | undefined {
  if (findFrame(board, id)) return frameKey(id);
  const card = board.modules.find((m) => m.id === id);
  if (!card) return undefined;
  const frameId = card.frameId;
  return frameId && frameExists(board, frameId)
    ? frameKey(frameId)
    : cardKey(id);
}

/** Deduplicated board-level edges between frames and loose cards, without self-loops. */
function topEdges(board: Board): Edge[] {
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const link of board.links) {
    const from = topKey(board, link.from);
    const to = topKey(board, link.to);
    if (!from || !to || from === to) continue;
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([from, to]);
  }
  return edges;
}

/** Linked nodes by dagre, then isolated frames in rows, then isolated cards in a grid. */
function placeTopLevel(nodes: TopNode[], edges: Edge[]): Slots {
  const linked = new Set(edges.flat());
  const connected = nodes.filter((n) => linked.has(n.id));
  const isolated = nodes.filter((n) => !linked.has(n.id));
  const positions = runDagre(connected, edges, BOARD_FLOW);
  const graph = extentOf(connected, positions);
  const frames = isolated.filter((n) => n.id.startsWith("f:"));
  const cards = isolated.filter((n) => n.id.startsWith("c:"));
  let bottom: number | null = connected.length > 0 ? graph.h : null;
  const rows = rowSlots(
    frames,
    startBelow(bottom),
    Math.max(graph.w, ROW_WIDTH),
  );
  if (frames.length > 0) bottom = extentOf(frames, rows).h;
  const grid = gridSlots(cards, startBelow(bottom), ARRANGE_COLUMNS);
  return new Map([...positions, ...rows, ...grid]);
}

/** Y where a new block starts: three gaps below the previous content, or 0 when there is none. */
function startBelow(bottom: number | null): number {
  return bottom === null ? 0 : bottom + GAP * 3;
}

/** Places items left to right, wrapping at `wrap`, keeping their previous order (y, then x). */
function rowSlots(items: TopNode[], top: number, wrap: number): Slots {
  const slots: Slots = new Map();
  let x = 0;
  let y = top;
  let rowH = 0;
  for (const item of sortByPosition(items)) {
    if (x > 0 && x + item.w > wrap) {
      x = 0;
      y += rowH + GAP;
      rowH = 0;
    }
    slots.set(item.id, { x: Math.round(x), y: Math.round(y) });
    x += item.w + GAP;
    rowH = Math.max(rowH, item.h);
  }
  return slots;
}

// ─────────────────────────── shared geometry ───────────────────────────

/** Grid of `columns` columns, cells sized to the largest item, starting at (0, top). */
function gridSlots<T extends Item>(
  items: T[],
  top: number,
  columns: number,
): Slots {
  const slots: Slots = new Map();
  if (items.length === 0) return slots;
  const cellW = Math.max(...items.map((i) => i.w));
  const cellH = Math.max(...items.map((i) => i.h));
  items.forEach((item, index) => {
    slots.set(item.id, {
      x: Math.round((index % columns) * (cellW + GAP)),
      y: Math.round(top + Math.floor(index / columns) * (cellH + GAP)),
    });
  });
  return slots;
}

/** Lays items out with dagre (LR) and shifts the result so its top-left is the origin. */
function runDagre<T extends Item>(
  items: T[],
  edges: Edge[],
  flow: { nodesep: number; ranksep: number },
): Slots {
  if (items.length === 0) return new Map();
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", ...flow });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const item of items) {
    graph.setNode(item.id, { width: item.w, height: item.h });
  }
  for (const [from, to] of edges) graph.setEdge(from, to);
  dagre.layout(graph);
  const tops = items.map((item) => {
    const node = graph.node(item.id) as { x: number; y: number };
    return { id: item.id, x: node.x - item.w / 2, y: node.y - item.h / 2 };
  });
  const minX = Math.min(...tops.map((t) => t.x));
  const minY = Math.min(...tops.map((t) => t.y));
  return new Map(
    tops.map((t): [string, Pos] => [
      t.id,
      { x: Math.round(t.x - minX), y: Math.round(t.y - minY) },
    ]),
  );
}

/** Width and height reached by the given items at their slots (origin 0). */
function extentOf(items: Item[], slots: Slots): Size {
  let w = 0;
  let h = 0;
  for (const item of items) {
    const p = slots.get(item.id);
    if (!p) continue;
    w = Math.max(w, p.x + item.w);
    h = Math.max(h, p.y + item.h);
  }
  return { w, h };
}

/** Writes each frame's and loose card's final position, moving frame cards with their frame. */
function applyLayout(
  board: Board,
  layouts: FrameLayout[],
  positions: Slots,
): Board {
  const layoutById = new Map(
    layouts.map((l): [string, FrameLayout] => [l.frame.id, l]),
  );
  const frames = layouts.map(({ frame }) => {
    const pos = positions.get(frameKey(frame.id)) ?? frame;
    return { ...frame, x: Math.round(pos.x), y: Math.round(pos.y) };
  });
  const modules = board.modules.map((card) => {
    const layout = card.frameId ? layoutById.get(card.frameId) : undefined;
    if (layout) {
      const origin = positions.get(frameKey(layout.frame.id)) ?? layout.frame;
      const slot = layout.slots.get(card.id) ?? { x: 0, y: 0 };
      return {
        ...card,
        x: Math.round(origin.x + slot.x),
        y: Math.round(origin.y + slot.y),
      };
    }
    const pos = positions.get(cardKey(card.id));
    return pos ? { ...card, x: Math.round(pos.x), y: Math.round(pos.y) } : card;
  });
  return { ...board, frames, modules };
}
