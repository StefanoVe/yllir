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
import { MIN_FRAME, overlaps } from "./layout.js";
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
