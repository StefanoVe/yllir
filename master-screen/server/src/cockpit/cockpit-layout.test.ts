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
  boardBounds,
  defaultSize,
  fitFrame,
  moveFrame,
  overlaps,
  placeCard,
  placeFrame,
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
