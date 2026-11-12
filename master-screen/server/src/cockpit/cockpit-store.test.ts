import { afterEach, test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import {
  CockpitStore,
  StoreError,
  migrateState,
} from "./store.js";
import { overlaps } from "./layout.js";
import type {
  BoardModule,
  ChatMessage,
  CockpitState,
  Turn,
} from "../../../shared/src/cockpit-types.js";

let roots: string[] = [];
async function makeStore(
  options: ConstructorParameters<typeof CockpitStore>[1] = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "cockpit-"));
  roots.push(root);
  return { root, store: new CockpitStore(root, options) };
}
afterEach(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
  roots = [];
});
const dmMessage = (id: string): ChatMessage => ({
  id,
  role: "dm",
  text: "dm",
  at: new Date().toISOString(),
  turnId: "t",
  status: "complete",
});

test("create/get/list/delete, revision, atomic files, and no temp residue", async () => {
  const { root, store } = await makeStore();
  const s = await store.create({
    title: "Prova",
    provider: "claude",
    model: "m",
  });
  expect((await store.get(s.id)).revision).toBe(0);
  expect(await store.list()).toHaveLength(1);
  const applied = await store.apply(
    s.id,
    [{ type: "position.set", patch: { location: "A" } }],
    { origin: "dm", groupId: "g" },
  );
  expect(applied.session.revision).toBe(1);
  expect(
    await readFile(path.join(root, ".campaign", "state", "live", "cockpit", s.id, "session.json"), "utf8"),
  ).toContain('"location":"A"');
  expect(
    (await readdir(path.join(root, ".campaign", "state", "live", "cockpit", s.id))).some((name) =>
      name.endsWith(".tmp"),
    ),
  ).toBe(false);
  await store.delete(s.id);
  expect(await store.list()).toHaveLength(0);
  await expect(store.get(s.id)).rejects.toMatchObject({ status: 404 });
});

test("group merge only targets the latest active group; undone IDs are never reused", async () => {
  const { store } = await makeStore();
  const s = await store.create({ title: "T", provider: "claude", model: "m" });
  const first = await store.apply(s.id, [{ type: "party.set", names: ["A"] }], {
    origin: "agent",
    turnId: "turn",
    groupId: "agent-group",
  });
  const merged = await store.apply(
    s.id,
    [{ type: "party.set", names: ["B"] }],
    { origin: "agent", turnId: "turn", groupId: "agent-group" },
  );
  expect(merged.group.id).toBe(first.group.id);
  expect(merged.group.actions).toHaveLength(2);
  const dm = await store.apply(
    s.id,
    [{ type: "position.set", patch: { location: "DM" } }],
    { origin: "dm", groupId: "dm-click" },
  );
  const split = await store.apply(s.id, [{ type: "party.set", names: ["C"] }], {
    origin: "agent",
    turnId: "turn",
    groupId: "agent-group",
  });
  expect(split.group.id).not.toBe(first.group.id);
  expect(split.group.id).not.toBe(dm.group.id);
  expect(split.group.turnId).toBe("turn");
  const continued = await store.apply(
    s.id,
    [{ type: "party.set", names: ["continued"] }],
    { origin: "agent", turnId: "turn", groupId: split.group.id },
  );
  expect(continued.group.id).toBe(split.group.id);
  expect(continued.group.actions).toHaveLength(2);
  await store.undo(s.id, split.group.id);
  const reused = await store.apply(
    s.id,
    [{ type: "party.set", names: ["D"] }],
    { origin: "agent", turnId: "turn", groupId: split.group.id },
  );
  expect(reused.group.id).not.toBe(split.group.id);
  expect(reused.group.turnId).toBe("turn");
  const session = await store.get(s.id);
  expect(new Set(session.history.map((group) => group.id)).size).toBe(
    session.history.length,
  );
});

test("undo is restricted to the latest non-undone group", async () => {
  const { store } = await makeStore();
  const s = await store.create({ title: "T", provider: "claude", model: "m" });
  const a = await store.apply(s.id, [{ type: "party.set", names: ["A"] }], {
    origin: "dm",
    groupId: "a",
  });
  const b = await store.apply(s.id, [{ type: "party.set", names: ["B"] }], {
    origin: "dm",
    groupId: "b",
  });
  await expect(store.undo(s.id, a.group.id)).rejects.toMatchObject({
    status: 409,
  });
  await store.undo(s.id, b.group.id);
  expect((await store.get(s.id)).state.party).toEqual(["A"]);
});

test("message mutations do not change revision and duplicate append is idempotent", async () => {
  const changes: { kind: string }[] = [];
  const { store } = await makeStore({
    onChange: (_session, change) => changes.push({ kind: change.kind }),
  });
  const s = await store.create({ title: "T", provider: "claude", model: "m" });
  const message = dmMessage("m");
  await store.appendMessage(s.id, message);
  const afterFirst = await store.get(s.id);
  await store.appendMessage(s.id, { ...message, text: "different" });
  expect((await store.get(s.id)).messages[0]!.text).toBe("dm");
  expect((await store.get(s.id)).revision).toBe(afterFirst.revision);
  await store.updateMessage(s.id, "m", { text: "updated" });
  expect((await store.get(s.id)).revision).toBe(0);
  expect(changes.map((change) => change.kind)).toEqual(["message", "message"]);
});

test("upsert turn keeps 20 completed and all active turns; notifications use the correct kinds", async () => {
  const changes: { kind: string }[] = [];
  const { store } = await makeStore({
    onChange: (_session, change) => changes.push({ kind: change.kind }),
  });
  const s = await store.create({ title: "T", provider: "claude", model: "m" });
  const turn = (id: string, status: Turn["status"]): Turn => ({
    id,
    messageId: `msg-${id}`,
    status,
  });
  for (let i = 0; i < 23; i++)
    await store.upsertTurn(s.id, turn(`done-${i}`, "done"));
  await store.upsertTurn(s.id, turn("running", "running"));
  await store.upsertTurn(s.id, turn("queued", "queued"));
  const saved = await store.get(s.id);
  expect(saved.turns.filter((item) => item.status === "done")).toHaveLength(20);
  expect(saved.turns.some((item) => item.id === "done-0")).toBe(false);
  expect(saved.turns.some((item) => item.id === "running")).toBe(true);
  expect(saved.turns.some((item) => item.id === "queued")).toBe(true);
  expect(changes.every((change) => change.kind === "turn")).toBe(true);
  await store.apply(s.id, [{ type: "party.set", names: [] }], { origin: "dm" });
  expect(changes.at(-1)?.kind).toBe("state");
  await store.delete(s.id);
  expect(changes.at(-1)?.kind).toBe("deleted");
});

test("rejects non-UUID IDs and create validates its input", async () => {
  const { store } = await makeStore();
  await expect(store.get("../x")).rejects.toBeInstanceOf(StoreError);
  await expect(
    store.create({ title: "", provider: "claude", model: "m" }),
  ).rejects.toBeInstanceOf(StoreError);
});

const STAMP = "2026-01-01T00:00:00.000Z";

test("migrateState turns an old focus/support board into canvas cards", () => {
  const legacy = {
    position: { location: "", moment: "", summary: "" },
    party: [],
    ledger: [],
    combat: null,
    board: {
      modules: [
        {
          id: "m-focus",
          kind: "npc",
          ref: { type: "doc", path: "NPCs/Ada.md" },
          zone: "focus",
          priority: 2,
          pinned: false,
          reason: "a",
          addedBy: "agent",
          addedAt: STAMP,
          updatedAt: STAMP,
        },
        {
          id: "m-support",
          kind: "location",
          ref: { type: "doc", path: "World/Lianshui.md" },
          zone: "support",
          priority: 1,
          pinned: false,
          reason: "b",
          addedBy: "agent",
          addedAt: STAMP,
          updatedAt: STAMP,
        },
      ],
    },
  };
  const state = migrateState(legacy);
  expect(state.board.highlightId).toBe("m-focus");
  expect(state.board.frames).toEqual([]);
  expect(state.board.links).toEqual([]);
  const [first, second] = state.board.modules as BoardModule[];
  for (const card of [first!, second!]) {
    expect(card).not.toHaveProperty("zone");
    expect(card).not.toHaveProperty("priority");
    expect(Number.isInteger(card.x)).toBe(true);
    expect(Number.isInteger(card.y)).toBe(true);
    expect(card.w).toBe(260);
    expect(card.h).toBe(180);
  }
  expect(overlaps(first!, second!)).toBe(false);
});

test("migrateState leaves canvas states unchanged and highlights nothing without focus", () => {
  const canvas = migrateState({
    position: { location: "", moment: "", summary: "" },
    party: [],
    ledger: [],
    combat: null,
    board: { modules: [], frames: [], links: [], highlightId: null },
  }) as CockpitState;
  expect(canvas.board.frames).toEqual([]);
  const support = migrateState({
    position: { location: "", moment: "", summary: "" },
    party: [],
    ledger: [],
    combat: null,
    board: {
      modules: [
        {
          id: "solo",
          kind: "note",
          ref: { type: "note", text: "x" },
          zone: "support",
          pinned: false,
          reason: "",
          addedBy: "dm",
          addedAt: STAMP,
          updatedAt: STAMP,
        },
      ],
    },
  }) as CockpitState;
  expect(support.board.highlightId).toBeNull();
});

test("a session file in the old format is migrated when read", async () => {
  const { root, store } = await makeStore();
  const s = await store.create({
    title: "Vecchia",
    provider: "claude",
    model: "m",
  });
  const legacyState = {
    position: { location: "", moment: "", summary: "" },
    party: [],
    ledger: [],
    combat: null,
    board: {
      modules: [
        {
          id: "old",
          kind: "npc",
          ref: { type: "doc", path: "NPCs/Ada.md" },
          zone: "focus",
          priority: 1,
          pinned: false,
          reason: "",
          addedBy: "agent",
          addedAt: STAMP,
          updatedAt: STAMP,
        },
      ],
    },
  };
  const file = path.join(root, ".campaign", "state", "live", "cockpit", s.id, "session.json");
  const raw = JSON.parse(await readFile(file, "utf8"));
  raw.state = legacyState;
  await writeFile(file, JSON.stringify(raw));
  const read = await store.get(s.id);
  expect(read.state.board.highlightId).toBe("old");
  expect(read.state.board.frames).toEqual([]);
  expect(read.state.board.modules[0]).not.toHaveProperty("zone");
});

test("layout moves a frame and its cards without adding a history group", async () => {
  const { store } = await makeStore();
  const s = await store.create({ title: "T", provider: "claude", model: "m" });
  const framed = await store.apply(
    s.id,
    [
      {
        type: "frame.add",
        frame: { title: "Scena", x: 0, y: 0, w: 320, h: 200 },
      },
    ],
    { origin: "dm" },
  );
  const frameId = framed.session.state.board.frames[0]!.id;
  const shown = await store.apply(
    s.id,
    [
      {
        type: "module.show",
        module: {
          kind: "npc",
          ref: { type: "doc", path: "NPCs/Ada.md" },
          reason: "test",
          frameId,
        },
      },
    ],
    { origin: "dm" },
  );
  const before = shown.session;
  const frameBefore = before.state.board.frames[0]!;
  const cardBefore = before.state.board.modules[0]!;
  const moved = await store.layout(s.id, [{ id: frameId, x: 500, y: 300 }]);
  expect(moved.history).toHaveLength(before.history.length);
  expect(moved.revision).toBe(before.revision + 1);
  const frame = moved.state.board.frames[0]!;
  const card = moved.state.board.modules[0]!;
  expect(frame).toMatchObject({ x: 500, y: 300 });
  const dx = 500 - frameBefore.x;
  const dy = 300 - frameBefore.y;
  expect(card).toMatchObject({
    x: cardBefore.x + dx,
    y: cardBefore.y + dy,
    frameId,
  });
  expect((await store.get(s.id)).history).toHaveLength(before.history.length);
});

test("layout updates a card, detaches it from its frame and rejects unknown ids", async () => {
  const { store } = await makeStore();
  const s = await store.create({ title: "T", provider: "claude", model: "m" });
  const shown = await store.apply(
    s.id,
    [
      {
        type: "module.show",
        module: {
          kind: "note",
          ref: { type: "note", text: "nota" },
          reason: "",
        },
      },
    ],
    { origin: "dm" },
  );
  const cardId = shown.session.state.board.modules[0]!.id;
  const moved = await store.layout(s.id, [
    { id: cardId, x: 12.6, y: 7.2, w: 300, h: 220, frameId: null },
  ]);
  expect(moved.state.board.modules[0]).toMatchObject({
    x: 13,
    y: 7,
    w: 300,
    h: 220,
  });
  expect(moved.state.board.modules[0]).not.toHaveProperty("frameId");
  await expect(
    store.layout(s.id, [{ id: "missing", x: 0, y: 0 }]),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    store.layout(s.id, [{ id: cardId, x: 0, y: 0, frameId: "missing" }]),
  ).rejects.toMatchObject({ status: 404 });
  await expect(store.layout(s.id, [])).rejects.toBeInstanceOf(StoreError);
});

test("undo keeps the DM's layout for cards that existed before the undone group", async () => {
  const { store } = await makeStore();
  const s = await store.create({ title: "T", provider: "claude", model: "m" });
  const first = await store.apply(
    s.id,
    [
      {
        type: "module.show",
        module: {
          kind: "npc",
          ref: { type: "doc", path: "NPCs/Ada.md" },
          reason: "a",
        },
      },
    ],
    { origin: "dm", groupId: "group-a" },
  );
  const adaId = first.session.state.board.modules[0]!.id;
  await store.layout(s.id, [{ id: adaId, x: 1000, y: 1000 }]);
  const second = await store.apply(
    s.id,
    [
      {
        type: "module.show",
        module: {
          kind: "npc",
          ref: { type: "doc", path: "NPCs/Bea.md" },
          reason: "b",
        },
      },
    ],
    { origin: "dm", groupId: "group-b" },
  );
  expect(second.session.state.board.modules).toHaveLength(2);
  const undone = await store.undo(s.id, second.group.id);
  expect(undone.state.board.modules.map((module) => module.id)).toEqual([
    adaId,
  ]);
  expect(undone.state.board.modules[0]).toMatchObject({ x: 1000, y: 1000 });
});
