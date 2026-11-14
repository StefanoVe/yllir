import { describe, test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import {
  ActionError,
  MAX_CARDS,
  MAX_FRAMES,
  MAX_LINKS,
  applyAction,
  applyActions,
  emptyState,
  parseAction,
} from "./actions.js";
import {
  FRAME_PAD,
  GAP,
  MIN_FRAME,
  minFrameWidth,
  overlaps,
} from "./layout.js";
import type {
  BoardModule,
  CockpitAction,
  CockpitState,
  Frame,
  Link,
} from "../../../shared/src/cockpit-types.js";

let sequence = 0;
const ctx = {
  now: "2026-01-01T00:00:00.000Z",
  newId: (prefix: string) => `${prefix}-${++sequence}`,
  knownMessageIds: new Set(["dm1"]),
};
const apply = (state: CockpitState, action: CockpitAction) =>
  applyAction(state, action, ctx);
const UUID = "11111111-2222-3333-4444-555555555555";
const moduleAction = (
  kind: "npc" | "note",
  name: string,
  extra: Partial<
    Extract<CockpitAction, { type: "module.show" }>["module"]
  > = {},
): CockpitAction => ({
  type: "module.show",
  module: {
    kind,
    ref:
      kind === "note"
        ? { type: "note", text: name }
        : { type: "doc", path: `NPCs/${name}.md` },
    reason: "test",
    ...extra,
  } as Extract<CockpitAction, { type: "module.show" }>["module"],
});
/** HTTP-like status of the error thrown by `fn`, or undefined when it does not throw. */
function statusOf(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ActionError ? error.status : -1;
  }
  return undefined;
}
const cardIds = (state: CockpitState) =>
  state.board.modules.map((module) => module.id);
const cardOf = (state: CockpitState, id: string): BoardModule => {
  const card = state.board.modules.find((module) => module.id === id);
  if (!card) throw new Error(`card ${id} missing`);
  return card;
};
const frameOf = (state: CockpitState, id: string): Frame => {
  const frame = state.board.frames.find((item) => item.id === id);
  if (!frame) throw new Error(`frame ${id} missing`);
  return frame;
};
/** Builds a state with `count` cards and `frames` frames without going through the reducer. */
function bulkState(count: number, frames = 0): CockpitState {
  const state = emptyState();
  state.board.modules = Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    kind: "note" as const,
    ref: { type: "note" as const, text: `${index}` },
    x: index * 300,
    y: 0,
    w: 240,
    h: 150,
    pinned: false,
    reason: "",
    addedBy: "agent" as const,
    addedAt: ctx.now,
    updatedAt: ctx.now,
  }));
  state.board.frames = Array.from({ length: frames }, (_, index) => ({
    id: `f${index}`,
    title: `F${index}`,
    x: 0,
    y: 0,
    w: MIN_FRAME.w,
    h: MIN_FRAME.h,
    addedBy: "agent" as const,
    addedAt: ctx.now,
    updatedAt: ctx.now,
  }));
  return state;
}

describe("cockpit action schema and reducer", () => {
  test("rejects extra fields and wrong types with ActionError and a path", () => {
    expect(() => parseAction({ type: "combat.end", extra: true })).toThrow(
      ActionError,
    );
    try {
      parseAction({ type: "party.set", names: [4] });
    } catch (error) {
      expect(error).toBeInstanceOf(ActionError);
      expect((error as ActionError).message).toContain("names");
    }
    expect(() =>
      parseAction({
        type: "module.show",
        module: {
          kind: "npc",
          ref: { type: "doc", path: "x", extra: 1 },
          reason: "",
        },
      }),
    ).toThrow(ActionError);
  });

  test("module show creates a card with the default size at the origin of an empty board", () => {
    const result = apply(emptyState(), moduleAction("npc", "Ada"));
    expect(result.summary.label).toBe("Mostra · Ada");
    expect(result.state.board.modules).toHaveLength(1);
    expect(cardOf(result.state, result.summary.targetId!)).toMatchObject({
      x: 0,
      y: 0,
      w: 260,
      h: 180,
    });
  });

  test("a second card does not overlap the first", () => {
    let state = apply(emptyState(), moduleAction("npc", "Ada")).state;
    state = apply(state, moduleAction("npc", "Bea")).state;
    const [first, second] = state.board.modules;
    expect(overlaps(first!, second!)).toBe(false);
  });

  test("show deduplicates by kind and ref, updating the existing card", () => {
    let state = apply(emptyState(), moduleAction("npc", "Ada")).state;
    const id = cardIds(state)[0];
    state = apply(
      state,
      moduleAction("npc", "Ada", { reason: "updated" }),
    ).state;
    expect(cardIds(state)).toEqual([id]);
    expect(cardOf(state, id!).reason).toBe("updated");
  });

  test("show with an unknown id is 404 and a missing frame is 404 'Riquadro'", () => {
    expect(
      statusOf(() =>
        apply(emptyState(), moduleAction("npc", "Ada", { id: "nope" })),
      ),
    ).toBe(404);
    expect(
      statusOf(() =>
        apply(emptyState(), moduleAction("npc", "Ada", { frameId: "nope" })),
      ),
    ).toBe(404);
  });

  test("show with frameId puts the card inside the frame and the frame grows to contain it", () => {
    let state = apply(emptyState(), {
      type: "frame.add",
      frame: { title: "Scena", w: 320, h: 200 },
    }).state;
    const frameId = state.board.frames[0]!.id;
    state = apply(state, moduleAction("npc", "Ada", { frameId })).state;
    const card = state.board.modules[0]!;
    const frame = frameOf(state, frameId);
    expect(card.frameId).toBe(frameId);
    expect(card.x).toBeGreaterThanOrEqual(frame.x);
    expect(card.y).toBeGreaterThanOrEqual(frame.y);
    expect(card.x + card.w).toBeLessThanOrEqual(frame.x + frame.w);
    expect(card.y + card.h).toBeLessThanOrEqual(frame.y + frame.h);
    expect(frame.h).toBeGreaterThan(200);
  });

  test("near places a card beside its target without overlap", () => {
    let state = apply(emptyState(), moduleAction("npc", "Ada")).state;
    const adaId = cardIds(state)[0]!;
    state = apply(state, moduleAction("npc", "Bea", { near: adaId })).state;
    const [ada, bea] = state.board.modules;
    expect(overlaps(ada!, bea!)).toBe(false);
  });

  test("explicit x and y win over the layout engine and are rounded", () => {
    const state = apply(
      emptyState(),
      moduleAction("npc", "Ada", { x: 10.4, y: 20.6 }),
    ).state;
    expect(state.board.modules[0]).toMatchObject({ x: 10, y: 21 });
  });

  test("kind and ref must agree", () => {
    expect(() =>
      apply(emptyState(), {
        type: "module.show",
        module: {
          kind: "npc",
          ref: { type: "note", text: "x" },
          reason: "",
        },
      } as CockpitAction),
    ).toThrow(ActionError);
    expect(() =>
      apply(emptyState(), {
        type: "module.show",
        module: {
          kind: "image",
          ref: { type: "doc", path: "NPCs/Ada.md" },
          reason: "",
        },
      } as CockpitAction),
    ).toThrow(ActionError);
  });

  test("image refs are accepted with a valid upload name and rejected otherwise", () => {
    const valid = parseAction({
      type: "module.show",
      module: {
        kind: "image",
        ref: { type: "image", path: `img-${UUID}.png` },
        reason: "mappa",
      },
    });
    expect(valid.type).toBe("module.show");
    expect(apply(emptyState(), valid).state.board.modules[0]!.ref).toEqual({
      type: "image",
      path: `img-${UUID}.png`,
    });
    expect(() =>
      parseAction({
        type: "module.show",
        module: {
          kind: "image",
          ref: { type: "image", path: "../x.png" },
          reason: "",
        },
      }),
    ).toThrow(ActionError);
  });

  test("remove deletes the card, its links and the highlight pointing at it", () => {
    let state = apply(emptyState(), moduleAction("npc", "Ada")).state;
    state = apply(state, moduleAction("npc", "Bea")).state;
    const [ada, bea] = cardIds(state);
    state = apply(state, { type: "link.add", from: ada!, to: bea! }).state;
    state = apply(state, { type: "module.highlight", id: ada! }).state;
    const removed = apply(state, { type: "module.remove", id: ada! });
    expect(removed.summary.label).toBe("Rimuove carta");
    expect(cardIds(removed.state)).toEqual([bea]);
    expect(removed.state.board.links).toEqual([]);
    expect(removed.state.board.highlightId).toBeNull();
    expect(() =>
      apply(removed.state, { type: "module.remove", id: ada! }),
    ).toThrow(ActionError);
  });

  test("update changes text only for notes and color null deletes the color", () => {
    let state = apply(emptyState(), moduleAction("note", "Testo")).state;
    const noteId = cardIds(state)[0]!;
    state = apply(state, {
      type: "module.update",
      id: noteId,
      patch: { text: "nuovo", color: "red" },
    }).state;
    expect(cardOf(state, noteId).ref).toEqual({ type: "note", text: "nuovo" });
    expect(cardOf(state, noteId).color).toBe("red");
    state = apply(state, {
      type: "module.update",
      id: noteId,
      patch: { color: null },
    }).state;
    expect(cardOf(state, noteId)).not.toHaveProperty("color");

    state = apply(state, moduleAction("npc", "Ada")).state;
    const npcId = cardIds(state)[1]!;
    expect(() =>
      apply(state, {
        type: "module.update",
        id: npcId,
        patch: { text: "x" },
      }),
    ).toThrow(ActionError);
  });

  test("update moves a card into and out of a frame", () => {
    let state = apply(emptyState(), {
      type: "frame.add",
      frame: { title: "A", w: 320, h: 200 },
    }).state;
    const frameId = state.board.frames[0]!.id;
    state = apply(state, moduleAction("npc", "Ada")).state;
    const cardId = cardIds(state)[0]!;
    state = apply(state, {
      type: "module.update",
      id: cardId,
      patch: { frameId },
    }).state;
    expect(cardOf(state, cardId).frameId).toBe(frameId);
    expect(frameOf(state, frameId).h).toBeGreaterThanOrEqual(
      cardOf(state, cardId).y + cardOf(state, cardId).h,
    );
    state = apply(state, {
      type: "module.update",
      id: cardId,
      patch: { frameId: null },
    }).state;
    expect(cardOf(state, cardId)).not.toHaveProperty("frameId");
    expect(() =>
      apply(state, {
        type: "module.update",
        id: cardId,
        patch: { frameId: "missing" },
      }),
    ).toThrow(ActionError);
  });

  test("highlight accepts card and frame ids, rejects unknown ids and null clears", () => {
    let state = apply(emptyState(), {
      type: "frame.add",
      frame: { title: "Scena" },
    }).state;
    const frameId = state.board.frames[0]!.id;
    const highlighted = apply(state, { type: "module.highlight", id: frameId });
    expect(highlighted.summary.label).toBe("Evidenzia");
    expect(highlighted.state.board.highlightId).toBe(frameId);
    state = apply(highlighted.state, {
      type: "module.highlight",
      id: null,
    }).state;
    expect(state.board.highlightId).toBeNull();
    expect(() =>
      apply(state, { type: "module.highlight", id: "missing" }),
    ).toThrow(ActionError);
  });

  test("pin toggles the pinned flag and rejects unknown cards", () => {
    let state = apply(emptyState(), moduleAction("npc", "Ada")).state;
    const id = cardIds(state)[0]!;
    state = apply(state, { type: "module.pin", id, pinned: true }).state;
    expect(cardOf(state, id).pinned).toBe(true);
    expect(() =>
      apply(state, { type: "module.pin", id: "missing", pinned: true }),
    ).toThrow(ActionError);
  });

  test("frame add places a frame at the origin, honours x/y and labels with the title", () => {
    const added = apply(emptyState(), {
      type: "frame.add",
      frame: { title: "Taverna", x: 100.7, y: 50 },
    });
    expect(added.summary.label).toBe("Riquadro · Taverna");
    const frame = added.state.board.frames[0]!;
    expect(added.summary.targetId).toBe(frame.id);
    expect(frame).toMatchObject({ x: 101, y: 50, ...MIN_FRAME });
  });

  test("frame update changes the title and color, null deletes the color", () => {
    let state = apply(emptyState(), {
      type: "frame.add",
      frame: { title: "Scena", color: "blue" },
    }).state;
    const frameId = state.board.frames[0]!.id;
    state = apply(state, {
      type: "frame.update",
      id: frameId,
      patch: { title: "Atto II" },
    }).state;
    expect(frameOf(state, frameId)).toMatchObject({
      title: "Atto II",
      color: "blue",
    });
    state = apply(state, {
      type: "frame.update",
      id: frameId,
      patch: { color: null },
    }).state;
    expect(frameOf(state, frameId)).not.toHaveProperty("color");
  });

  test("frame remove with cards keeps pinned cards unframed and drops unpinned ones", () => {
    let state = apply(emptyState(), {
      type: "frame.add",
      frame: { title: "F" },
    }).state;
    const frameId = state.board.frames[0]!.id;
    state = apply(state, moduleAction("npc", "Ada", { frameId })).state;
    state = apply(
      state,
      moduleAction("npc", "Bea", { frameId, pinned: true }),
    ).state;
    state = apply(state, moduleAction("npc", "Cora")).state;
    const [ada, bea, cora] = cardIds(state);
    state = apply(state, { type: "link.add", from: cora!, to: ada! }).state;
    const removed = apply(state, {
      type: "frame.remove",
      id: frameId,
      withCards: true,
    });
    expect(removed.summary.label).toBe("Rimuove riquadro");
    expect(removed.state.board.frames).toEqual([]);
    expect(cardIds(removed.state)).toEqual([bea, cora]);
    expect(cardOf(removed.state, bea!)).not.toHaveProperty("frameId");
    expect(removed.state.board.links).toEqual([]);
  });

  test("frame remove without cards keeps every card, unframed", () => {
    let state = apply(emptyState(), {
      type: "frame.add",
      frame: { title: "F" },
    }).state;
    const frameId = state.board.frames[0]!.id;
    state = apply(state, moduleAction("npc", "Ada", { frameId })).state;
    state = apply(state, {
      type: "module.highlight",
      id: frameId,
    }).state;
    const removed = apply(state, {
      type: "frame.remove",
      id: frameId,
      withCards: false,
    }).state;
    expect(removed.board.frames).toEqual([]);
    expect(removed.board.modules).toHaveLength(1);
    expect(removed.board.modules[0]).not.toHaveProperty("frameId");
    expect(removed.board.highlightId).toBeNull();
  });

  test("link add validates endpoints, deduplicates the pair and link remove checks the id", () => {
    let state = apply(emptyState(), moduleAction("npc", "Ada")).state;
    state = apply(state, moduleAction("npc", "Bea")).state;
    const [ada, bea] = cardIds(state);
    expect(() =>
      apply(state, { type: "link.add", from: ada!, to: ada! }),
    ).toThrow(ActionError);
    expect(
      statusOf(() =>
        apply(state, { type: "link.add", from: ada!, to: "missing" }),
      ),
    ).toBe(404);
    state = apply(state, {
      type: "link.add",
      from: ada!,
      to: bea!,
      label: "prima",
    }).state;
    const again = apply(state, {
      type: "link.add",
      from: ada!,
      to: bea!,
      label: "dopo",
    });
    expect(again.state.board.links).toHaveLength(1);
    expect(again.state.board.links[0]!.label).toBe("dopo");
    const linkId = again.state.board.links[0]!.id;
    state = apply(again.state, { type: "link.remove", id: linkId }).state;
    expect(state.board.links).toEqual([]);
    expect(() => apply(state, { type: "link.remove", id: linkId })).toThrow(
      ActionError,
    );
  });

  test("board clear keeps pinned cards and the frame holding them, drops the rest", () => {
    let state = apply(emptyState(), {
      type: "frame.add",
      frame: { title: "Con pinned" },
    }).state;
    const keepFrame = state.board.frames[0]!.id;
    state = apply(state, {
      type: "frame.add",
      frame: { title: "Secondo" },
    }).state;
    const emptyFrame = state.board.frames[1]!.id;
    state = apply(
      state,
      moduleAction("npc", "Ada", {
        frameId: keepFrame,
        pinned: true,
      }),
    ).state;
    state = apply(state, moduleAction("npc", "Bea")).state;
    state = apply(
      state,
      moduleAction("npc", "Cora", { frameId: emptyFrame }),
    ).state;
    const [ada, bea, cora] = cardIds(state);
    state = apply(state, { type: "link.add", from: ada!, to: keepFrame }).state;
    state = apply(state, { type: "link.add", from: ada!, to: bea! }).state;
    state = apply(state, { type: "link.add", from: bea!, to: cora! }).state;
    state = apply(state, { type: "module.highlight", id: bea! }).state;
    const cleared = apply(state, { type: "board.clear" }).state;
    expect(cardIds(cleared)).toEqual([ada]);
    expect(cardOf(cleared, ada!).frameId).toBe(keepFrame);
    expect(cleared.board.frames.map((frame) => frame.id)).toEqual([keepFrame]);
    expect(cleared.board.links.map((link) => link.to)).toEqual([keepFrame]);
    expect(cleared.board.highlightId).toBeNull();
  });

  test("board arrange returns integer coordinates and non-overlapping frames", () => {
    let state = emptyState();
    for (const title of ["uno", "due", "tre"])
      state = apply(state, { type: "frame.add", frame: { title } }).state;
    const [f1, f2, f3] = state.board.frames.map((frame) => frame.id);
    state = apply(state, moduleAction("npc", "A1", { frameId: f1 })).state;
    state = apply(state, moduleAction("npc", "A2", { frameId: f1 })).state;
    state = apply(state, moduleAction("npc", "B1", { frameId: f2 })).state;
    state = apply(state, moduleAction("note", "loose")).state;
    state = apply(state, { type: "link.add", from: f1!, to: f2! }).state;
    state = apply(state, { type: "link.add", from: f2!, to: f3! }).state;
    const arranged = apply(state, { type: "board.arrange" });
    expect(arranged.summary.label).toBe("Riordina scrivania");
    const { frames, modules } = arranged.state.board;
    for (const item of [...frames, ...modules]) {
      expect(Number.isInteger(item.x)).toBe(true);
      expect(Number.isInteger(item.y)).toBe(true);
      expect(Number.isInteger(item.w)).toBe(true);
      expect(Number.isInteger(item.h)).toBe(true);
    }
    for (let i = 0; i < frames.length; i++)
      for (let j = i + 1; j < frames.length; j++)
        expect(overlaps(frames[i]!, frames[j]!)).toBe(false);
  });

  test("board arrange with a frame id re-flows only that frame", () => {
    let state = emptyState();
    state = apply(state, {
      type: "frame.add",
      frame: { title: "uno", x: 0, y: 0 },
    }).state;
    state = apply(state, {
      type: "frame.add",
      frame: { title: "due", x: 1500, y: 0 },
    }).state;
    const [f1, f2] = state.board.frames.map((frame) => frame.id);
    state = apply(state, moduleAction("npc", "A1", { frameId: f1, x: 40, y: 80 })).state;
    state = apply(state, moduleAction("npc", "A2", { frameId: f1, x: 900, y: 600 })).state;
    state = apply(state, moduleAction("npc", "B1", { frameId: f2, x: 1540, y: 80 })).state;
    state = apply(state, moduleAction("note", "loose", { x: 3000, y: 3000 })).state;
    const before = state.board;
    const arranged = apply(state, { type: "board.arrange", frameId: f1! });
    expect(arranged.summary.label).toBe("Riordina riquadro");
    expect(arranged.summary.targetId).toBe(f1);
    const after = arranged.state.board;
    expect(after.frames.find((f) => f.id === f2)).toEqual(
      before.frames.find((f) => f.id === f2),
    );
    const outside = (b: typeof before) =>
      b.modules.filter((m) => m.frameId !== f1);
    expect(outside(after)).toEqual(outside(before));
    const f = after.frames.find((item) => item.id === f1)!;
    expect(f.x).toBe(before.frames.find((item) => item.id === f1)!.x);
    expect(f.y).toBe(before.frames.find((item) => item.id === f1)!.y);
    for (const c of after.modules.filter((m) => m.frameId === f1)) {
      expect(c.x).toBeGreaterThanOrEqual(f.x + FRAME_PAD);
      expect(c.x + c.w).toBeLessThanOrEqual(f.x + f.w);
      expect(c.y + c.h).toBeLessThanOrEqual(f.y + f.h);
    }
  });

  test("board arrange with an unknown frame id is refused with 404", () => {
    expect(
      statusOf(() =>
        apply(emptyState(), { type: "board.arrange", frameId: "nope" }),
      ),
    ).toBe(404);
  });

  /** A frame at (0, 0) of 400×300 holding one note at (40, 80). */
  function frameWithCard(title = "Scena") {
    let state = apply(emptyState(), {
      type: "frame.add",
      frame: { title, x: 0, y: 0, w: 400, h: 300 },
    }).state;
    const frame = state.board.frames[0]!.id;
    state = apply(state, moduleAction("note", "A", { frameId: frame, x: 40, y: 80 })).state;
    const card = state.board.modules[0]!.id;
    return { state, frame, card };
  }

  test("board position moves a frame and translates its cards by the same delta", () => {
    const { state, frame, card } = frameWithCard();
    const before = frameOf(state, frame);
    const cardBefore = cardOf(state, card);
    const moved = apply(state, { type: "board.position", id: frame, x: 1000, y: 500 });
    expect(moved.summary.label).toBe("Posiziona");
    expect(moved.summary.targetId).toBe(frame);
    const f = frameOf(moved.state, frame);
    expect(f.x).toBe(1000);
    expect(f.y).toBe(500);
    expect(f.w).toBe(before.w);
    expect(f.h).toBe(before.h);
    const c = cardOf(moved.state, card);
    expect(c.x - cardBefore.x).toBe(1000 - before.x);
    expect(c.y - cardBefore.y).toBe(500 - before.y);
  });

  test("board position resizes a frame but not below its title or its cards", () => {
    let state = apply(emptyState(), {
      type: "frame.add",
      frame: { title: "Scena", x: 0, y: 0, w: 400, h: 300 },
    }).state;
    const frame = state.board.frames[0]!.id;
    state = apply(state, moduleAction("note", "A", { frameId: frame, x: 200, y: 80 })).state;
    const card = state.board.modules[0]!.id;
    const shrunk = apply(state, { type: "board.position", id: frame, w: 10, h: 10 }).state;
    const f = frameOf(shrunk, frame);
    const c = cardOf(shrunk, card);
    expect(f.w).toBeGreaterThanOrEqual(minFrameWidth("Scena"));
    expect(f.h).toBeGreaterThanOrEqual(MIN_FRAME.h);
    expect(c.x + c.w + FRAME_PAD).toBeLessThanOrEqual(f.x + f.w);
    expect(c.y + c.h + FRAME_PAD).toBeLessThanOrEqual(f.y + f.h);
    const wide = apply(state, { type: "board.position", id: frame, w: 900 }).state;
    expect(frameOf(wide, frame).w).toBe(900);
  });

  test("board position never sizes a frame below its title width", () => {
    const title = "Un titolo molto lungo per il riquadro di una scena";
    const state = apply(emptyState(), {
      type: "frame.add",
      frame: { title, x: 0, y: 0 },
    }).state;
    const frame = state.board.frames[0]!.id;
    const narrow = apply(state, { type: "board.position", id: frame, w: 50 }).state;
    expect(frameOf(narrow, frame).w).toBe(minFrameWidth(title));
  });

  test("board position on a card rounds its coordinates and grows its frame", () => {
    const { state, frame, card } = frameWithCard();
    const moved = apply(state, {
      type: "board.position",
      id: card,
      x: 900.4,
      y: 600.6,
      w: 300,
    }).state;
    const c = cardOf(moved, card);
    expect(c.x).toBe(900);
    expect(c.y).toBe(601);
    expect(c.w).toBe(300);
    expect(c.frameId).toBe(frame);
    const f = frameOf(moved, frame);
    expect(f.x + f.w).toBeGreaterThanOrEqual(c.x + c.w + FRAME_PAD);
    expect(f.y + f.h).toBeGreaterThanOrEqual(c.y + c.h + FRAME_PAD);
  });

  test("board position without x, y, w or h is refused", () => {
    const { state, card, frame } = frameWithCard();
    expect(() => apply(state, { type: "board.position", id: card })).toThrow(
      ActionError,
    );
    expect(() => apply(state, { type: "board.position", id: frame })).toThrow(
      ActionError,
    );
  });

  test("board position with an unknown id is refused with 404", () => {
    expect(
      statusOf(() =>
        apply(emptyState(), { type: "board.position", id: "nope", x: 1 }),
      ),
    ).toBe(404);
  });

  test("board position and board arrange with frameId parse; extra keys are refused", () => {
    expect(
      parseAction({ type: "board.position", id: "m1", x: 10, h: 200 }),
    ).toEqual({ type: "board.position", id: "m1", x: 10, h: 200 });
    expect(
      parseAction({ type: "board.arrange", frameId: "f1" }),
    ).toEqual({ type: "board.arrange", frameId: "f1" });
    expect(() =>
      parseAction({ type: "board.position", id: "m1", z: 3 }),
    ).toThrow(ActionError);
  });

  test("caps refuse new cards, frames and links with 409", () => {
    const fullCards = bulkState(MAX_CARDS);
    expect(
      statusOf(() => apply(fullCards, moduleAction("note", "nuova"))),
    ).toBe(409);

    const fullFrames = bulkState(0, MAX_FRAMES);
    expect(() =>
      apply(fullFrames, { type: "frame.add", frame: { title: "x" } }),
    ).toThrow(ActionError);

    const fullLinks = bulkState(MAX_CARDS);
    fullLinks.board.links = Array.from({ length: MAX_LINKS }, (_, index) => ({
      id: `k${index}`,
      from: `m${index}`,
      to: `m${(index + 1) % MAX_CARDS}`,
      addedBy: "agent" as const,
    })) as Link[];
    expect(() =>
      apply(fullLinks, { type: "link.add", from: "m0", to: "m2" }),
    ).toThrow(ActionError);
  });

  test("position and party set merge, deduplicate, trim; labels are useful", () => {
    let state = apply(emptyState(), {
      type: "position.set",
      patch: { location: "A" },
    }).state;
    state = apply(state, {
      type: "position.set",
      patch: { moment: "notte" },
    }).state;
    state = apply(state, {
      type: "party.set",
      names: [" Ada ", "Ada", "", "Bea"],
    }).state;
    expect(state.position).toMatchObject({ location: "A", moment: "notte" });
    expect(state.party).toEqual(["Ada", "Bea"]);
  });

  test("ledger and combat actions belong to the framework: the reducer refuses them, the schemas still parse", () => {
    const state = emptyState();
    const actions: CockpitAction[] = [
      { type: "ledger.remove", id: "e-0001" },
      { type: "ledger.update", id: "e-0001", patch: { status: "resolved" } },
      { type: "combat.start", title: "x", participants: [] },
      { type: "combat.add", participant: { name: "A", kind: "pc", initiative: 1, conditions: [] } },
      { type: "combat.turn", activeId: null },
      { type: "combat.end" },
    ];
    for (const action of actions)
      expect(() => apply(state, action)).toThrow(ActionError);
    expect(parseAction({ type: "combat.end" })).toEqual({ type: "combat.end" });
    expect(() => parseAction({ type: "combat.end", extra: true })).toThrow();
  });

  test("action batches are atomic and never mutate the input", () => {
    const state = emptyState();
    expect(() =>
      applyActions(
        state,
        [
          { type: "position.set", patch: { location: "X" } },
          { type: "module.remove", id: "missing" },
        ],
        ctx,
      ),
    ).toThrow();
    expect(state.position.location).toBe("");
    const result = applyActions(
      state,
      [{ type: "party.set", names: ["A"] }],
      ctx,
    );
    expect(result.state).not.toBe(state);
    expect(state.party).toEqual([]);
  });
});

describe("cockpit slots, sides and frame reorder", () => {
  /** Texts of the frame's cards in reading order (y, then x). */
  const textsInFrame = (state: CockpitState, frameId: string) =>
    state.board.modules
      .filter((m) => m.frameId === frameId)
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((m) => (m.ref.type === "note" ? m.ref.text : m.id));

  function frameWithNotes(...texts: string[]) {
    let state = apply(emptyState(), {
      type: "frame.add",
      frame: { title: "Scena", x: 0, y: 0, w: 800, h: 400 },
    }).state;
    const frameId = state.board.frames[0]!.id;
    for (const text of texts)
      state = apply(state, moduleAction("note", text, { frameId })).state;
    return { state, frameId };
  }

  test("module show with index takes that slot and shifts the later cards", () => {
    const { state, frameId } = frameWithNotes("a", "b");
    const shown = apply(
      state,
      moduleAction("note", "c", { frameId, index: 0 }),
    );
    expect(textsInFrame(shown.state, frameId)).toEqual(["c", "a", "b"]);
    const frame = frameOf(shown.state, frameId);
    for (const card of shown.state.board.modules) {
      expect(card.x).toBeGreaterThanOrEqual(frame.x + FRAME_PAD);
      expect(card.x + card.w).toBeLessThanOrEqual(frame.x + frame.w);
    }
    expect(overlaps(shown.state.board)).toEqual([]);
  });

  test("module show with index on a card already in the frame moves it to that slot", () => {
    const { state, frameId } = frameWithNotes("a", "b", "c");
    const cardC = state.board.modules.find(
      (m) => m.ref.type === "note" && m.ref.text === "c",
    )!;
    const moved = apply(
      state,
      moduleAction("note", "c", { id: cardC.id, frameId, index: 0 }),
    ).state;
    expect(textsInFrame(moved, frameId)).toEqual(["c", "a", "b"]);
    expect(moved.board.modules).toHaveLength(3);
  });

  test("module show with side places the card on that side of its target", () => {
    let state = apply(emptyState(), moduleAction("note", "t", { x: 500, y: 400 })).state;
    const targetId = state.board.modules[0]!.id;
    state = apply(
      state,
      moduleAction("note", "above", { near: targetId, side: "above" }),
    ).state;
    const above = state.board.modules.find(
      (m) => m.ref.type === "note" && m.ref.text === "above",
    )!;
    expect(above.x).toBe(500);
    expect(above.y).toBe(400 - above.h - GAP);
    expect(overlaps(above, cardOf(state, targetId), GAP)).toBe(false);
  });

  test("side is refused when it is not one of the four sides", () => {
    expect(() =>
      parseAction({
        type: "module.show",
        module: { kind: "note", ref: { type: "note", text: "x" }, reason: "", side: "diagonal" },
      }),
    ).toThrow(ActionError);
    expect(
      parseAction({
        type: "module.show",
        module: { kind: "note", ref: { type: "note", text: "x" }, reason: "", side: "left", index: 2 },
      }),
    ).toMatchObject({ type: "module.show", module: { side: "left", index: 2 } });
  });

  test("module update with frameId and index moves the card into the frame at that slot", () => {
    const { state, frameId } = frameWithNotes("a", "b");
    let s = apply(state, moduleAction("note", "loose")).state;
    const loose = s.board.modules.find(
      (m) => m.ref.type === "note" && m.ref.text === "loose",
    )!;
    s = apply(s, {
      type: "module.update",
      id: loose.id,
      patch: { frameId, index: 1 },
    }).state;
    expect(textsInFrame(s, frameId)).toEqual(["a", "loose", "b"]);
    expect(cardOf(s, loose.id).updatedAt).toBe(ctx.now);
  });

  test("frame add with near and side places the frame beside its target", () => {
    let state = apply(emptyState(), moduleAction("note", "t", { x: 0, y: 0 })).state;
    const targetId = state.board.modules[0]!.id;
    state = apply(state, {
      type: "frame.add",
      frame: { title: "Accanto", near: targetId, side: "right" },
    }).state;
    const frame = state.board.frames[0]!;
    // A note card is 240 px wide by default.
    expect(frame.x).toBe(240 + GAP);
    expect(frame.y).toBe(0);
  });

  test("frame update color null clears the colour and keeps the title", () => {
    let state = apply(emptyState(), {
      type: "frame.add",
      frame: { title: "Scena", color: "green" },
    }).state;
    const frameId = state.board.frames[0]!.id;
    state = apply(state, {
      type: "frame.update",
      id: frameId,
      patch: { color: null },
    }).state;
    expect(frameOf(state, frameId).title).toBe("Scena");
    expect(frameOf(state, frameId)).not.toHaveProperty("color");
  });

  test("frame reorder re-flows the cards in the given order", () => {
    const { state, frameId } = frameWithNotes("a", "b", "c");
    const ids = (text: string) =>
      state.board.modules.find((m) => m.ref.type === "note" && m.ref.text === text)!.id;
    const reordered = apply(state, {
      type: "frame.reorder",
      frameId,
      ids: [ids("c"), ids("a")],
    });
    expect(reordered.summary.label).toBe("Ordina carte del riquadro");
    expect(reordered.summary.targetId).toBe(frameId);
    expect(textsInFrame(reordered.state, frameId)).toEqual(["c", "a", "b"]);
  });

  test("frame reorder with an unknown frame is refused with 404", () => {
    expect(
      statusOf(() =>
        apply(emptyState(), { type: "frame.reorder", frameId: "nope", ids: [] }),
      ),
    ).toBe(404);
  });

  test("frame reorder refuses a card that is not in the frame", () => {
    let { state, frameId } = frameWithNotes("a");
    state = apply(state, moduleAction("note", "loose")).state;
    const loose = state.board.modules.find(
      (m) => m.ref.type === "note" && m.ref.text === "loose",
    )!;
    expect(() =>
      apply(state, { type: "frame.reorder", frameId, ids: [loose.id] }),
    ).toThrow(ActionError);
  });

  test("frame reorder is parsed with its frame id and list of ids", () => {
    expect(
      parseAction({ type: "frame.reorder", frameId: "f1", ids: ["m1", "m2"] }),
    ).toEqual({ type: "frame.reorder", frameId: "f1", ids: ["m1", "m2"] });
    expect(() =>
      parseAction({ type: "frame.reorder", frameId: "f1", ids: ["m1"], extra: 1 }),
    ).toThrow(ActionError);
  });
});
