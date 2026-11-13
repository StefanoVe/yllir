import { afterEach, test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CockpitStore, StoreError } from "./store.js";
import { CockpitLive, combatOf } from "./live.js";
import type { FrameworkCombatState } from "./framework.js";
import { parseAction } from "./actions.js";
import { createFakeFramework } from "./test-helpers/fake-framework.js";
import type { CockpitAction } from "../../../shared/src/cockpit-types.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function setup(options: { openLive?: boolean } = {}) {
  root = await mkdtemp(path.join(tmpdir(), "cockpit-live-"));
  const store = new CockpitStore(root);
  const session = await store.create({ title: "Serata", provider: "claude", model: "fake" });
  await store.appendMessage(session.id, {
    id: "dm-1",
    role: "dm",
    text: "Il gruppo entra nel porto",
    at: new Date().toISOString(),
    turnId: "t1",
    status: "complete",
  });
  const fake = createFakeFramework();
  if (options.openLive) await fake.framework.log.open("Già aperta");
  const live = new CockpitLive(store, fake.framework);
  const run = (action: CockpitAction, groupId?: string) =>
    live.apply(session.id, action, { origin: "agent", ...(groupId ? { groupId } : {}) });
  const state = async () => (await live.hydrate(await store.get(session.id))).state;
  return { store, session, fake, live, run, state };
}

test("ensure opens a framework session titled after the cockpit session, or joins the one already open", async () => {
  const a = await setup();
  const id = await a.live.ensure(a.session.id);
  expect(a.fake.opened).toEqual(["Serata"]);
  expect((await a.store.get(a.session.id)).liveSessionId).toBe(id);
  expect(await a.live.ensure(a.session.id)).toBe(id);
  expect(a.fake.opened).toHaveLength(1);

  const b = await setup({ openLive: true });
  const joined = await b.live.ensure(b.session.id);
  expect(b.fake.opened).toEqual(["Già aperta"]);
  expect(joined).toBe(b.fake.session!.id);
});

test("a ledger entry is a framework entry: kinds, title and text, evidence and sources stay in the side file", async () => {
  const h = await setup();
  await h.run({
    type: "ledger.add",
    entry: {
      kind: "open",
      title: "Il capitano",
      text: "Ha promesso di tornare",
      evidence: ["dm-1"],
      sources: [{ path: "Plot/Atto.md" }],
    },
  });
  const [entry] = (await h.state()).ledger;
  expect(entry).toMatchObject({
    kind: "open",
    status: "active",
    title: "Il capitano",
    text: "Ha promesso di tornare",
    evidence: ["dm-1"],
    sources: [{ path: "Plot/Atto.md" }],
  });
  // The framework keeps the text as one line and the thread kind.
  expect(h.fake.framework.log).toBeDefined();
  const raw = (await h.fake.framework.log.list()) as { ok: true; entries: { kind: string; text: string }[] };
  expect(raw.entries[0]).toMatchObject({ kind: "thread", text: "Il capitano: Ha promesso di tornare" });

  await h.run({ type: "ledger.update", id: entry!.id, patch: { status: "resolved" } });
  expect((await h.state()).ledger[0]!.status).toBe("resolved");
  const after = (await h.fake.framework.log.list()) as { ok: true; entries: { resolved?: boolean }[] };
  expect(after.entries[0]!.resolved).toBe(true);

  await h.run({ type: "ledger.update", id: entry!.id, patch: { status: "dropped" } });
  expect((await h.state()).ledger).toEqual([]);
});

test("ledger evidence must name a DM message, on add and on update", async () => {
  const h = await setup();
  await expect(
    h.run({ type: "ledger.add", entry: { kind: "fact", title: "x", text: "y", evidence: ["nope"] } }),
  ).rejects.toThrow(StoreError);
  await h.run({ type: "ledger.add", entry: { kind: "fact", title: "x", text: "y", evidence: ["dm-1"] } });
  const id = (await h.state()).ledger[0]!.id;
  await expect(
    h.run({ type: "ledger.update", id, patch: { addEvidence: ["sconosciuto"] } }),
  ).rejects.toThrow("messaggio DM inesistente");
});

test("a ledger entry written in the terminal shows as it is, with its text as title", async () => {
  const h = await setup();
  await h.run({ type: "ledger.add", entry: { kind: "fact", title: "Titolo", text: "Testo", evidence: ["dm-1"] } });
  const id = (await h.state()).ledger[0]!.id;
  // The framework text changed outside the cockpit.
  await h.fake.framework.log.update(id, { text: "Scritto dal terminale" });
  expect((await h.state()).ledger[0]).toMatchObject({ title: "Scritto dal terminale", text: "" });
});

test("combat: players keep only name, initiative and position; hp changes become damage or heal", async () => {
  const h = await setup();
  await h.run({
    type: "combat.start",
    title: "Porto",
    participants: [
      { name: "Ada", kind: "pc", initiative: 10, conditions: [] },
      { name: "Guardia", kind: "enemy", initiative: 14, hp: 20, maxHp: 20, conditions: ["prone"] },
    ],
  });
  let combat = (await h.state()).combat!;
  expect(combat.title).toBe("Porto");
  expect(combat.participants.map((p) => p.name)).toEqual(["Guardia", "Ada"]);
  expect(combat.activeId).toBe(combat.participants[0]!.id);
  expect(combat.participants[0]!.conditions).toEqual(["prone"]);

  await expect(
    h.run({ type: "combat.update", id: combat.participants[1]!.id, patch: { hp: 3 } }),
  ).rejects.toThrow("solo nome, iniziativa e posizione");
  await expect(
    h.run({ type: "combat.add", participant: { name: "Bea", kind: "pc", initiative: 5, hp: 9, conditions: [] } }),
  ).rejects.toThrow("solo nome, iniziativa e posizione");

  const guard = combat.participants[0]!.id;
  await h.run({ type: "combat.update", id: guard, patch: { hp: 12, conditions: ["blinded"] } });
  combat = (await h.state()).combat!;
  expect(combat.participants[0]).toMatchObject({ hp: 12, conditions: ["blinded"] });

  await h.run({ type: "combat.turn", activeId: combat.participants[1]!.id });
  expect((await h.state()).combat!.activeId).toBe(combat.participants[1]!.id);
  await h.run({ type: "combat.notes", notes: "La porta è chiusa" });
  expect((await h.state()).combat!.notes).toBe("La porta è chiusa");
  await h.run({ type: "combat.end" });
  expect((await h.state()).combat).toBeNull();
});

test("undo restores the board, never the ledger or the combat", async () => {
  const h = await setup();
  await h.run({ type: "ledger.add", entry: { kind: "fact", title: "Fatto", text: "Accaduto", evidence: ["dm-1"] } });
  const shown = await h.live.apply(h.session.id, { type: "party.set", names: ["Ada"] }, { origin: "agent" });
  expect(shown.session.state.party).toEqual(["Ada"]);
  await h.store.undo(h.session.id, shown.group.id);
  const after = await h.store.get(h.session.id);
  expect(after.state.party).toEqual([]);
  expect((await h.state()).ledger).toHaveLength(1);
});

test("the board and the ledger of one agent turn share one undo group", async () => {
  const h = await setup();
  const first = await h.run({ type: "ledger.add", entry: { kind: "fact", title: "A", text: "a", evidence: ["dm-1"] } });
  const second = await h.run(
    { type: "position.set", patch: { location: "Porto" } },
    first.group.id,
  );
  expect(second.group.id).toBe(first.group.id);
  expect(second.group.actions.map((a) => a.type)).toEqual(["ledger.add", "position.set"]);
});

test("combat: notices come from the rule events (last 20, oldest first); condition details keep duration and rounds", () => {
  const events: FrameworkCombatState["events"] = [
    { at: "t0", text: "Inizio" },
    ...Array.from({ length: 22 }, (_, i) => ({
      at: `t${i + 1}`,
      text: "Turno",
      notice: { kind: "turn" as const, id: "c-1", name: "Ada", round: 1, newRound: i === 0 },
    })),
    { at: "t23", text: "Ogre a terra: fine", notice: { kind: "condition-ended", id: "c-2", name: "Ogre", condition: "prone" } },
    { at: "t24", text: "Ogre caduto", notice: { kind: "defeated", id: "c-2", name: "Ogre" } },
    { at: "t25", text: "Fine" },
  ];
  const state: FrameworkCombatState = {
    active: true,
    round: 1,
    turn: 1,
    order: ["c-1", "c-2"],
    combatants: [
      { id: "c-1", name: "Ada", side: "pc", initiative: 14, conditions: [], resources: {} },
      {
        id: "c-2",
        name: "Ogre",
        side: "enemy",
        initiative: 9,
        hp: 0,
        conditions: [{ id: "blinded" }, { id: "prone", duration: "until_removed" }, { id: "stunned", duration: "rounds", rounds: 2 }],
        resources: {},
      },
    ],
    events,
    revision: 30,
  };
  const combat = combatOf(state, null);
  expect(combat.notices).toHaveLength(20);
  expect(combat.notices[0]).toEqual({ at: "t5", kind: "turn", id: "c-1", name: "Ada", round: 1, newRound: false });
  expect(combat.notices[18]).toEqual({ at: "t23", kind: "condition-ended", id: "c-2", name: "Ogre", condition: "prone" });
  expect(combat.notices[19]).toEqual({ at: "t24", kind: "defeated", id: "c-2", name: "Ogre" });

  const ogre = combat.participants[1]!;
  expect(ogre.conditions).toEqual(["blinded", "prone", "stunned"]);
  expect(ogre.conditionDetails).toEqual([
    { id: "blinded" },
    { id: "prone", duration: "until_removed" },
    { id: "stunned", duration: "rounds", rounds: 2 },
  ]);
  expect(combatOf({ ...state, events: [{ at: "t0", text: "solo testo" }] }, null).notices).toEqual([]);
});

test("combat.condition adds and removes a condition through the framework; players and rounds without rounds are refused", async () => {
  const h = await setup();
  await h.run({
    type: "combat.start",
    title: "Porto",
    participants: [
      { name: "Ada", kind: "pc", initiative: 10, conditions: [] },
      { name: "Guardia", kind: "enemy", initiative: 14, hp: 20, maxHp: 20, conditions: [] },
    ],
  });
  const combat = (await h.state()).combat!;
  const guard = combat.participants.find((p) => p.name === "Guardia")!.id;
  const ada = combat.participants.find((p) => p.name === "Ada")!.id;

  const added = await h.run({ type: "combat.condition", id: guard, condition: "prone" });
  expect(added.group.actions.at(-1)).toMatchObject({ type: "combat.condition", label: "Condizione · Guardia", targetId: guard });
  expect((await h.state()).combat!.participants.find((p) => p.id === guard)!.conditions).toEqual(["prone"]);

  await h.run({ type: "combat.condition", id: guard, condition: "stunned", duration: "rounds", rounds: 2 });
  const stunned = (await h.state()).combat!.participants.find((p) => p.id === guard)!;
  expect(stunned.conditionDetails!.at(-1)).toEqual({ id: "stunned", duration: "rounds", rounds: 2 });

  await h.run({ type: "combat.condition", id: guard, condition: "prone", remove: true });
  expect((await h.state()).combat!.participants.find((p) => p.id === guard)!.conditions).toEqual(["stunned"]);

  await expect(
    h.run({ type: "combat.condition", id: ada, condition: "prone" }),
  ).rejects.toThrow("solo nome, iniziativa e posizione");
  await expect(
    h.run({ type: "combat.condition", id: guard, condition: "blinded", rounds: 2 }),
  ).rejects.toMatchObject({ status: 400, message: "I round valgono solo con la durata in round" });
  await expect(
    h.run({ type: "combat.condition", id: "c-999", condition: "prone" }),
  ).rejects.toMatchObject({ status: 404 });
});

test("combat.condition is a strict action: unknown fields and empty conditions are refused", () => {
  expect(() => parseAction({ type: "combat.condition", id: "c-1", condition: "prone", extra: true })).toThrow();
  expect(() => parseAction({ type: "combat.condition", id: "c-1", condition: "" })).toThrow();
  expect(parseAction({ type: "combat.condition", id: "c-1", condition: "prone", duration: "rounds", rounds: 3 })).toMatchObject({
    type: "combat.condition",
    rounds: 3,
  });
});
