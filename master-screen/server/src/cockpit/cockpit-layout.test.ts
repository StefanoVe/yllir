import { describe, test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import type {
  Board,
  BoardModule,
  Frame,
  Link,
  Rect,
} from "../../../shared/src/cockpit-types.js";
import {
  FRAME_COLUMNS,
  FRAME_HEADER,
  FRAME_PAD,
  GAP,
  MIN_FRAME,
  arrange,
  arrangeFrame,
  boardBounds,
  defaultSize,
  fitFrame,
  freeSlot,
  insertInFrame,
  moveFrame,
  overlaps,
  placeCard,
  placeFrame,
  reorderFrame,
} from "./layout.js";

const STAMP = "2026-01-01T00:00:00.000Z";

function card(
  id: string,
  x: number,
  y: number,
  w = 260,
  h = 180,
  frameId?: string,
): BoardModule {
  return {
    id,
    kind: "npc",
    ref: { type: "note", text: id },
    x,
    y,
    w,
    h,
    frameId,
    pinned: false,
    reason: "test",
    addedBy: "agent",
    addedAt: STAMP,
    updatedAt: STAMP,
  };
}

function frame(id: string, x: number, y: number, w: number, h: number): Frame {
  return {
    id,
    title: id,
    x,
    y,
    w,
    h,
    addedBy: "agent",
    addedAt: STAMP,
    updatedAt: STAMP,
  };
}

function board(
  modules: BoardModule[] = [],
  frames: Frame[] = [],
  links: Link[] = [],
): Board {
  return { modules, frames, links, highlightId: null };
}

function link(id: string, from: string, to: string): Link {
  return { id, from, to, addedBy: "agent" };
}

function rectOf(item: Rect): Rect {
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

function expectNoOverlaps(items: Rect[]): void {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      expect(overlaps(items[i], items[j])).toBe(false);
    }
  }
}

describe("defaultSize", () => {
  test("documents, maps, music and notes have their default sizes", () => {
    expect(defaultSize("npc")).toEqual({ w: 260, h: 180 });
    expect(defaultSize("lore")).toEqual({ w: 260, h: 180 });
    expect(defaultSize("map")).toEqual({ w: 380, h: 260 });
    expect(defaultSize("image")).toEqual({ w: 380, h: 260 });
    expect(defaultSize("music")).toEqual({ w: 260, h: 96 });
    expect(defaultSize("note")).toEqual({ w: 240, h: 150 });
  });
});

describe("overlaps", () => {
  const a: Rect = { x: 0, y: 0, w: 100, h: 100 };

  test("touching edges do not overlap without gap", () => {
    expect(overlaps(a, { x: 100, y: 0, w: 50, h: 50 })).toBe(false);
  });

  test("intersecting rects overlap", () => {
    expect(overlaps(a, { x: 50, y: 50, w: 100, h: 100 })).toBe(true);
  });

  test("gap expands the first rect on every side", () => {
    const right: Rect = { x: 110, y: 0, w: 50, h: 50 };
    expect(overlaps(a, right)).toBe(false);
    expect(overlaps(a, right, GAP)).toBe(true);
    expect(overlaps(a, { x: 124, y: 0, w: 50, h: 50 }, GAP)).toBe(false);
  });
});

describe("boardBounds", () => {
  test("empty board has no bounds", () => {
    expect(boardBounds(board())).toBeNull();
  });

  test("covers cards and frames", () => {
    const b = board([card("a", 10, 20, 100, 50)], [frame("f", 0, 0, 200, 300)]);
    expect(boardBounds(b)).toEqual({ x: 0, y: 0, w: 200, h: 300 });
  });
});

describe("placeCard", () => {
  test("empty board places at the origin", () => {
    expect(placeCard(board(), { w: 260, h: 180 })).toEqual({ x: 0, y: 0 });
  });

  test("right of the board when nothing is requested", () => {
    const b = board([card("a", 0, 0, 260, 180)]);
    expect(placeCard(b, { w: 260, h: 180 })).toEqual({
      x: 260 + GAP * 2,
      y: 0,
    });
  });

  test("inside a frame fills slots row-major and wraps after FRAME_COLUMNS", () => {
    const f = frame("f", 100, 100, 1000, 1000);
    const size = { w: 200, h: 120 };
    let b = board([], [f]);
    const slots: { x: number; y: number }[] = [];
    for (let i = 0; i < FRAME_COLUMNS + 1; i++) {
      const pos = placeCard(b, size, { frameId: "f" });
      slots.push(pos);
      b = board(
        [...b.modules, card(`c${i}`, pos.x, pos.y, size.w, size.h, "f")],
        [f],
      );
    }
    const first = { x: 100 + FRAME_PAD, y: 100 + FRAME_HEADER };
    expect(slots[0]).toEqual(first);
    expect(slots[1]).toEqual({ x: first.x + 200 + GAP, y: first.y });
    expect(slots[2]).toEqual({ x: first.x + 2 * (200 + GAP), y: first.y });
    expect(slots[3]).toEqual({ x: first.x, y: first.y + 120 + GAP });
  });

  test("skips an occupied slot", () => {
    const f = frame("f", 0, 0, 1000, 1000);
    const b = board(
      [card("taken", FRAME_PAD, FRAME_HEADER, 260, 180, "f")],
      [f],
    );
    const pos = placeCard(b, { w: 260, h: 180 }, { frameId: "f" });
    expect(pos).toEqual({ x: FRAME_PAD + 260 + GAP, y: FRAME_HEADER });
  });

  test("ignores an unknown frameId", () => {
    const pos = placeCard(board(), { w: 260, h: 180 }, { frameId: "missing" });
    expect(pos).toEqual({ x: 0, y: 0 });
  });

  test("near a card overlaps nothing", () => {
    const target = card("t", 0, 0, 260, 180);
    const b = board([target]);
    const size = { w: 260, h: 180 };
    const pos = placeCard(b, size, { near: "t" });
    expect(pos).toEqual({ x: 260 + GAP, y: 0 });
    expect(overlaps({ ...pos, ...size }, rectOf(target), GAP)).toBe(false);
  });

  test("near a card skips the spot already taken on the right", () => {
    const target = card("t", 0, 0, 260, 180);
    const taken = card("r", 260 + GAP, 0, 260, 180);
    const b = board([target, taken]);
    const size = { w: 260, h: 180 };
    const pos = placeCard(b, size, { near: "t" });
    const placed = { ...pos, ...size };
    expect(overlaps(placed, rectOf(target), GAP)).toBe(false);
    expect(overlaps(placed, rectOf(taken), GAP)).toBe(false);
  });

  test("near a frame never lands on top of a frame or card", () => {
    const f = frame("f", 0, 0, 400, 400);
    const other = frame("g", 400 + GAP, 0, 400, 400);
    const b = board([card("c", 0, 0, 260, 180)], [f, other]);
    const size = { w: 260, h: 180 };
    const pos = placeCard(b, size, { near: "f" });
    const placed = { ...pos, ...size };
    expect(overlaps(placed, rectOf(other), GAP)).toBe(false);
    expect(overlaps(placed, rectOf(f), GAP)).toBe(false);
  });
});

describe("placeFrame", () => {
  test("empty board places at the origin", () => {
    expect(placeFrame(board(), { w: 400, h: 300 })).toEqual({ x: 0, y: 0 });
  });

  test("right of existing content when no target is given", () => {
    const b = board([], [frame("f", 0, 0, 400, 300)]);
    expect(placeFrame(b, { w: 400, h: 300 })).toEqual({
      x: 400 + GAP * 2,
      y: 0,
    });
  });
});

describe("fitFrame", () => {
  test("grows to contain a card that sticks out on the right and bottom", () => {
    const b = board(
      [card("c", 300, 150, 260, 180, "f")],
      [frame("f", 0, 0, 320, 200)],
    );
    const out = fitFrame(b, "f").frames[0];
    expect(out.x + out.w).toBeGreaterThanOrEqual(300 + 260 + FRAME_PAD);
    expect(out.y + out.h).toBeGreaterThanOrEqual(150 + 180 + FRAME_PAD);
  });

  test("moves the origin to contain a card left of or above the frame", () => {
    const b = board(
      [card("c", -100, -100, 260, 180, "f")],
      [frame("f", 0, 0, 320, 200)],
    );
    const out = fitFrame(b, "f").frames[0];
    expect(out.x).toBeLessThanOrEqual(-100);
    expect(out.y).toBeLessThanOrEqual(-100 - FRAME_HEADER);
    expect(out.x + out.w).toBeGreaterThanOrEqual(-100 + 260);
  });

  test("never shrinks below the current size or MIN_FRAME", () => {
    const small = board(
      [card("c", 10, 60, 100, 80, "f")],
      [frame("f", 0, 0, 900, 700)],
    );
    const big = fitFrame(small, "f").frames[0];
    expect(big.w).toBe(900);
    expect(big.h).toBe(700);

    const empty = board([], [frame("f", 0, 0, 50, 50)]);
    const min = fitFrame(empty, "f").frames[0];
    expect(min.w).toBeGreaterThanOrEqual(MIN_FRAME.w);
    expect(min.h).toBeGreaterThanOrEqual(MIN_FRAME.h);
  });

  test("unknown id returns the board unchanged", () => {
    const b = board([], [frame("f", 0, 0, 320, 200)]);
    expect(fitFrame(b, "nope")).toBe(b);
  });
});

describe("moveFrame", () => {
  test("moves the frame and its cards by the same delta, not other cards", () => {
    const b = board(
      [card("in", 40, 60, 260, 180, "f"), card("out", 900, 900)],
      [frame("f", 0, 0, 800, 600)],
    );
    const moved = moveFrame(b, "f", 100, 50);
    expect(moved.frames[0]).toMatchObject({ x: 100, y: 50, w: 800, h: 600 });
    expect(moved.modules.find((m) => m.id === "in")).toMatchObject({
      x: 140,
      y: 110,
    });
    expect(moved.modules.find((m) => m.id === "out")).toMatchObject({
      x: 900,
      y: 900,
    });
  });

  test("unknown id returns the board unchanged", () => {
    const b = board([card("c", 0, 0)]);
    expect(moveFrame(b, "nope", 10, 10)).toBe(b);
  });
});

describe("arrange", () => {
  test("frames linked A to B end with A left of B and do not overlap", () => {
    const b = board(
      [],
      [frame("B", 0, 0, 400, 300), frame("A", 500, 500, 400, 300)],
      [link("l", "A", "B")],
    );
    const out = arrange(b);
    const a = out.frames.find((f) => f.id === "A")!;
    const bb = out.frames.find((f) => f.id === "B")!;
    expect(a.x).toBeLessThan(bb.x);
    expectNoOverlaps(out.frames.map(rectOf));
  });

  test("cards inside a frame do not overlap and lie inside the frame", () => {
    const b = board(
      [
        card("c1", 0, 0, 260, 180, "f"),
        card("c2", 0, 0, 260, 180, "f"),
        card("c3", 0, 0, 260, 180, "f"),
        card("c4", 0, 0, 260, 180, "f"),
        card("c5", 0, 0, 260, 180, "f"),
      ],
      [frame("f", 700, 40, 320, 200)],
    );
    const out = arrange(b);
    const f = out.frames[0];
    const cards = out.modules.filter((m) => m.frameId === "f");
    expectNoOverlaps(cards.map(rectOf));
    for (const c of cards) {
      expect(c.x).toBeGreaterThanOrEqual(f.x);
      expect(c.y).toBeGreaterThanOrEqual(f.y + FRAME_HEADER);
      expect(c.x + c.w).toBeLessThanOrEqual(f.x + f.w);
      expect(c.y + c.h).toBeLessThanOrEqual(f.y + f.h);
    }
  });

  test("unframed cards end up below all frames", () => {
    const b = board(
      [
        card("loose1", 0, 0),
        card("loose2", 2000, 2000),
        card("in", 0, 0, 260, 180, "f"),
      ],
      [frame("f", 300, 300, 400, 300)],
    );
    const out = arrange(b);
    const f = out.frames[0];
    const loose = out.modules.filter((m) => !m.frameId);
    expect(loose).toHaveLength(2);
    for (const c of loose) {
      expect(c.y).toBeGreaterThanOrEqual(f.y + f.h);
    }
    expectNoOverlaps(out.modules.map(rectOf));
  });

  test("does not mutate the input board", () => {
    const b = board(
      [card("in", 10, 10, 260, 180, "A"), card("loose", 50, 50)],
      [frame("A", 0, 0, 320, 200), frame("B", 600, 0, 320, 200)],
      [link("l", "A", "B")],
    );
    const snapshot = structuredClone(b);
    arrange(b);
    expect(b).toEqual(snapshot);
  });

  test("unframed cards linked A to B and A to C sit right of A, not overlapping", () => {
    const b = board(
      [card("A", 0, 0), card("B", 0, 0), card("C", 0, 0)],
      [],
      [link("l1", "A", "B"), link("l2", "A", "C")],
    );
    const out = arrange(b);
    const find = (id: string) => out.modules.find((m) => m.id === id)!;
    const a = find("A");
    expect(find("B").x).toBeGreaterThanOrEqual(a.x + a.w);
    expect(find("C").x).toBeGreaterThanOrEqual(a.x + a.w);
    expectNoOverlaps(out.modules.map(rectOf));
  });

  test("linked cards inside a frame flow left to right and the unlinked card sits below them", () => {
    const b = board(
      [
        card("c1", 0, 0, 260, 180, "f"),
        card("c2", 0, 0, 260, 180, "f"),
        card("c3", 0, 0, 260, 180, "f"),
        card("c4", 0, 0, 260, 180, "f"),
      ],
      [frame("f", 700, 40, 320, 200)],
      [link("l1", "c1", "c2"), link("l2", "c2", "c3")],
    );
    const out = arrange(b);
    const f = out.frames[0];
    const find = (id: string) => out.modules.find((m) => m.id === id)!;
    const [c1, c2, c3, c4] = ["c1", "c2", "c3", "c4"].map(find);
    expect(c1.x).toBeLessThan(c2.x);
    expect(c2.x).toBeLessThan(c3.x);
    const linkedBottom = Math.max(c1.y + c1.h, c2.y + c2.h, c3.y + c3.h);
    expect(c4.y).toBeGreaterThanOrEqual(linkedBottom);
    const cards = [c1, c2, c3, c4];
    for (const c of cards) {
      expect(c.x).toBeGreaterThanOrEqual(f.x + FRAME_PAD);
      expect(c.y).toBeGreaterThanOrEqual(f.y + FRAME_HEADER);
      expect(c.x + c.w).toBeLessThanOrEqual(f.x + f.w);
      expect(c.y + c.h).toBeLessThanOrEqual(f.y + f.h);
    }
    expectNoOverlaps(cards.map(rectOf));
  });

  test("an unframed card linked between two frames sits horizontally between them", () => {
    const b = board(
      [card("X", 0, 0)],
      [frame("F1", 900, 0, 320, 200), frame("F2", 0, 900, 320, 200)],
      [link("l1", "F1", "X"), link("l2", "X", "F2")],
    );
    const out = arrange(b);
    const f1 = out.frames.find((f) => f.id === "F1")!;
    const f2 = out.frames.find((f) => f.id === "F2")!;
    const x = out.modules.find((m) => m.id === "X")!;
    expect(x.x).toBeGreaterThanOrEqual(f1.x + f1.w);
    expect(x.x + x.w).toBeLessThanOrEqual(f2.x);
    expectNoOverlaps([...out.frames, ...out.modules].map(rectOf));
  });

  test("isolated frames end below the connected graph and isolated cards below them", () => {
    const b = board(
      [
        card("A", 0, 0),
        card("B", 0, 0),
        card("in", 0, 0, 260, 180, "G"),
        card("solo", 3000, 3000),
      ],
      [frame("G", 2000, 2000, 320, 200), frame("H", 0, 0, 320, 200)],
      [link("l", "A", "B")],
    );
    const out = arrange(b);
    const find = (id: string) => out.modules.find((m) => m.id === id)!;
    const findF = (id: string) => out.frames.find((f) => f.id === id)!;
    const a = find("A");
    const bb = find("B");
    const graphBottom = Math.max(a.y + a.h, bb.y + bb.h);
    const g = findF("G");
    const h = findF("H");
    expect(g.y).toBeGreaterThanOrEqual(graphBottom);
    expect(h.y).toBeGreaterThanOrEqual(graphBottom);
    const framesBottom = Math.max(g.y + g.h, h.y + h.h);
    expect(find("solo").y).toBeGreaterThanOrEqual(framesBottom);
    const topLevel = [...out.frames, ...out.modules.filter((m) => !m.frameId)];
    expectNoOverlaps(topLevel.map(rectOf));
  });
});

describe("arrangeFrame", () => {
  test("re-flows only the frame's cards and leaves other frames and loose cards untouched", () => {
    const b = board(
      [
        card("a", 0, 0, 260, 180, "F"),
        card("b", 5000, 5000, 260, 180, "F"),
        card("g", 2100, 2100, 260, 180, "G"),
        card("L", 3000, 0),
      ],
      [frame("F", 100, 100, 320, 200), frame("G", 2000, 2000, 320, 200)],
      [link("l1", "a", "b")],
    );
    const out = arrangeFrame(b, "F");
    const find = (id: string) => out.modules.find((m) => m.id === id)!;
    expect(find("g")).toEqual(b.modules[2]!);
    expect(find("L")).toEqual(b.modules[3]!);
    expect(out.frames.find((f) => f.id === "G")).toEqual(b.frames[1]!);
    const f = out.frames.find((item) => item.id === "F")!;
    expect(f.x).toBe(100);
    expect(f.y).toBe(100);
    for (const id of ["a", "b"]) {
      const c = find(id);
      expect(c.x).toBeGreaterThanOrEqual(f.x + FRAME_PAD);
      expect(c.y).toBeGreaterThanOrEqual(f.y + FRAME_HEADER);
      expect(c.x + c.w).toBeLessThanOrEqual(f.x + f.w);
      expect(c.y + c.h).toBeLessThanOrEqual(f.y + f.h);
    }
    expect(find("a").x).toBeLessThan(find("b").x);
  });

  test("resizes the frame to fit its re-flowed cards", () => {
    const b = board(
      [card("a", 0, 0, 260, 180, "F"), card("b", 0, 0, 260, 180, "F")],
      [frame("F", 100, 100, 320, 200)],
      [link("l1", "a", "b")],
    );
    const out = arrangeFrame(b, "F");
    const f = out.frames[0]!;
    // Two linked cards side by side: 260 + 64 (dagre ranksep inside a frame) + 260, plus padding on both sides.
    expect(f.w).toBe(260 * 2 + 64 + FRAME_PAD * 2);
    expect(f.h).toBe(Math.max(180 + FRAME_HEADER + FRAME_PAD, MIN_FRAME.h));
    expect(Number.isInteger(f.w)).toBe(true);
    expect(Number.isInteger(f.h)).toBe(true);
  });

  test("a frame whose new size would overlap another frame moves, with its cards", () => {
    const b = board(
      [
        card("a", 0, 0, 260, 180, "F"),
        card("b", 0, 0, 260, 180, "F"),
        card("g", 420, 60, 260, 180, "G"),
      ],
      // F is narrow now; once its linked cards are laid out side by side it reaches G.
      [frame("F", 0, 0, 320, 200), frame("G", 400, 0, 320, 200)],
      [link("l1", "a", "b")],
    );
    const out = arrangeFrame(b, "F");
    const f = out.frames.find((item) => item.id === "F")!;
    const g = out.frames.find((item) => item.id === "G")!;
    expect(g).toEqual(b.frames[1]!);
    expect(out.modules.find((m) => m.id === "g")).toEqual(b.modules[2]!);
    expect(f.x !== 0 || f.y !== 0).toBe(true);
    expect(overlaps(rectOf(f), rectOf(g), GAP)).toBe(false);
    for (const id of ["a", "b"]) {
      const c = out.modules.find((m) => m.id === id)!;
      expect(c.x + c.w).toBeLessThanOrEqual(f.x + f.w);
      expect(c.y + c.h).toBeLessThanOrEqual(f.y + f.h);
    }
  });

  test("unknown frame id returns the board unchanged", () => {
    const b = board([card("a", 0, 0)], [frame("F", 0, 0, 320, 200)]);
    expect(arrangeFrame(b, "nope")).toEqual(b);
  });
});

describe("placeCard and placeFrame with side", () => {
  const size = { w: 260, h: 180 };
  const target = card("t", 500, 400, 260, 180);

  test("left of the target lands at GAP to its left, on the target's top", () => {
    const pos = placeCard(board([target]), size, { near: "t", side: "left" });
    expect(pos).toEqual({ x: 500 - 260 - GAP, y: 400 });
  });

  test("above the target lands at GAP above it, on the target's left", () => {
    const pos = placeCard(board([target]), size, { near: "t", side: "above" });
    expect(pos).toEqual({ x: 500, y: 400 - 180 - GAP });
  });

  test("below the target lands at GAP below it, on the target's left", () => {
    const pos = placeCard(board([target]), size, { near: "t", side: "below" });
    expect(pos).toEqual({ x: 500, y: 400 + 180 + GAP });
  });

  test("right side equals the default placement next to a target", () => {
    const b = board([target]);
    expect(placeCard(b, size, { near: "t", side: "right" })).toEqual(
      placeCard(b, size, { near: "t" }),
    );
  });

  test("a taken side moves further along that side before falling back", () => {
    const blocker = card("r", 500 + 260 + GAP, 400, 260, 180);
    const b = board([target, blocker]);
    const pos = placeCard(b, size, { near: "t", side: "right" });
    expect(pos).toEqual({ x: 500 + 260 + GAP, y: 400 + 180 + GAP });
    expect(overlaps({ ...pos, ...size }, rectOf(blocker), GAP)).toBe(false);
  });

  test("a fully taken side falls back to the default candidate order", () => {
    // 200 cards fill the whole left strip (one per step), so the side is unusable.
    const strip = Array.from({ length: 200 }, (_, step) =>
      card(`s${step}`, 500 - 260 - GAP, 400 + step * (180 + GAP), 260, 180),
    );
    const b = board([target, ...strip]);
    const pos = placeCard(b, size, { near: "t", side: "left" });
    expect(pos).toEqual({ x: 500 + 260 + GAP, y: 400 });
  });

  test("side is ignored without a target", () => {
    expect(placeCard(board(), size, { side: "left" })).toEqual({ x: 0, y: 0 });
  });

  test("placeFrame honours side too", () => {
    const f = frame("f", 500, 400, 400, 300);
    const pos = placeFrame(board([], [f]), { w: 320, h: 200 }, {
      near: "f",
      side: "below",
    });
    expect(pos).toEqual({ x: 500, y: 400 + 300 + GAP });
  });
});

describe("placeCard with index and insertInFrame", () => {
  /** Frame at (0,0) with cards a and b in slots 0 and 1. */
  function twoCards(): Board {
    return board(
      [
        card("a", FRAME_PAD, FRAME_HEADER, 260, 180, "F"),
        card("b", FRAME_PAD + 260 + GAP, FRAME_HEADER, 260, 180, "F"),
      ],
      [frame("F", 0, 0, 800, 400)],
    );
  }
  const slotX = (n: number) => FRAME_PAD + n * (260 + GAP);

  test("placeCard with index returns that slot, clamped to the end of the frame", () => {
    const b = twoCards();
    expect(placeCard(b, { w: 260, h: 180 }, { frameId: "F", index: 1 })).toEqual({
      x: slotX(1),
      y: FRAME_HEADER,
    });
    expect(placeCard(b, { w: 260, h: 180 }, { frameId: "F", index: 9 })).toEqual({
      x: slotX(2),
      y: FRAME_HEADER,
    });
  });

  test("insertInFrame puts the card in the slot and shifts the later cards one slot", () => {
    const b = twoCards();
    const withNew: Board = {
      ...b,
      modules: [...b.modules, card("n", 700, 300, 260, 180, "F")],
    };
    const out = insertInFrame(withNew, "F", "n", 0);
    const at = (id: string) => out.modules.find((m) => m.id === id)!;
    expect(at("n")).toMatchObject({ x: slotX(0), y: FRAME_HEADER });
    expect(at("a")).toMatchObject({ x: slotX(1), y: FRAME_HEADER });
    expect(at("b")).toMatchObject({ x: slotX(2), y: FRAME_HEADER });
    const f = out.frames[0]!;
    expect(f.x + f.w).toBeGreaterThanOrEqual(slotX(2) + 260 + FRAME_PAD);
    expectNoOverlaps(out.modules.map(rectOf));
  });

  test("insertInFrame with an index past the end appends the card", () => {
    const b = twoCards();
    const withNew: Board = {
      ...b,
      modules: [...b.modules, card("n", 700, 300, 260, 180, "F")],
    };
    const out = insertInFrame(withNew, "F", "n", 50);
    expect(out.modules.find((m) => m.id === "n")).toMatchObject({
      x: slotX(2),
      y: FRAME_HEADER,
    });
  });
});

describe("overlaps on a board", () => {
  test("a card that overlaps a loose card is reported as a pair", () => {
    const b = board([card("a", 0, 0), card("b", 100, 50)]);
    expect(overlaps(b)).toEqual([["a", "b"]]);
  });

  test("a card inside its own frame is not reported", () => {
    const b = board(
      [card("c", 40, 80, 260, 180, "F")],
      [frame("F", 0, 0, 400, 300)],
    );
    expect(overlaps(b)).toEqual([]);
  });

  test("a card overlapping a frame it does not belong to is reported", () => {
    const b = board(
      [card("c", 100, 100)],
      [frame("G", 0, 0, 400, 300)],
    );
    expect(overlaps(b)).toEqual([["c", "G"]]);
  });

  test("two frames that touch are not reported, two that cross are", () => {
    expect(
      overlaps(board([], [frame("A", 0, 0, 100, 100), frame("B", 100, 0, 100, 100)])),
    ).toEqual([]);
    expect(
      overlaps(board([], [frame("A", 0, 0, 100, 100), frame("B", 50, 50, 100, 100)])),
    ).toEqual([["A", "B"]]);
  });

  test("two cards of the same frame that overlap are reported", () => {
    const b = board(
      [card("c1", 40, 80, 260, 180, "F"), card("c2", 100, 100, 260, 180, "F")],
      [frame("F", 0, 0, 800, 400)],
    );
    expect(overlaps(b)).toEqual([["c1", "c2"]]);
  });
});

describe("freeSlot", () => {
  test("an empty frame's next card lands in its first slot", () => {
    const b = board([], [frame("F", 0, 0, 400, 300)]);
    expect(freeSlot(b, "F")).toEqual({ x: FRAME_PAD, y: FRAME_HEADER });
  });

  test("after one card the next slot is the second column", () => {
    const b = board(
      [card("a", FRAME_PAD, FRAME_HEADER, 260, 180, "F")],
      [frame("F", 0, 0, 800, 400)],
    );
    expect(freeSlot(b, "F")).toEqual({
      x: FRAME_PAD + 260 + GAP,
      y: FRAME_HEADER,
    });
  });
});

describe("reorderFrame", () => {
  /** Frame F with a, b, c in slots 0, 1, 2 (in that order). */
  function threeCards(): Board {
    const slot = (n: number) => FRAME_PAD + n * (260 + GAP);
    return board(
      [
        card("a", slot(0), FRAME_HEADER, 260, 180, "F"),
        card("b", slot(1), FRAME_HEADER, 260, 180, "F"),
        card("c", slot(2), FRAME_HEADER, 260, 180, "F"),
      ],
      [frame("F", 0, 0, 800, 400)],
    );
  }
  const xOf = (b: Board, id: string) => b.modules.find((m) => m.id === id)!.x;

  test("listed ids take the first slots in the given order", () => {
    const out = reorderFrame(threeCards(), "F", ["c", "a", "b"]);
    expect(xOf(out, "c")).toBe(FRAME_PAD);
    expect(xOf(out, "a")).toBe(FRAME_PAD + 260 + GAP);
    expect(xOf(out, "b")).toBe(FRAME_PAD + 2 * (260 + GAP));
    expectNoOverlaps(out.modules.map(rectOf));
  });

  test("unlisted cards keep their relative order after the listed ones", () => {
    const out = reorderFrame(threeCards(), "F", ["c"]);
    expect(xOf(out, "c")).toBe(FRAME_PAD);
    expect(xOf(out, "a")).toBe(FRAME_PAD + 260 + GAP);
    expect(xOf(out, "b")).toBe(FRAME_PAD + 2 * (260 + GAP));
  });

  test("ids that are not cards of the frame are ignored", () => {
    const out = reorderFrame(threeCards(), "F", ["ghost", "b"]);
    expect(xOf(out, "b")).toBe(FRAME_PAD);
    expect(xOf(out, "a")).toBe(FRAME_PAD + 260 + GAP);
  });

  test("the frame is fitted to the cards and an unknown frame is unchanged", () => {
    const b = threeCards();
    const out = reorderFrame(b, "F", ["c", "a", "b"]);
    const f = out.frames[0]!;
    expect(f.x + f.w).toBeGreaterThanOrEqual(
      xOf(out, "b") + 260 + FRAME_PAD,
    );
    expect(reorderFrame(b, "nope", ["a"])).toBe(b);
  });
});
