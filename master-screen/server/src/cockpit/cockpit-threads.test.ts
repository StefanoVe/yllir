import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CockpitStore } from "./store.js";
import { COCKPIT_TOOL_NAMES, COMBAT_TOOL_NAMES, TABLE_TOOL_NAMES } from "./tools.js";

let roots: string[] = [];
async function makeStore() {
  const root = await mkdtemp(path.join(tmpdir(), "cockpit-threads-"));
  roots.push(root);
  return { root, store: new CockpitStore(root) };
}
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

test("combat thread is created with its parent and stays out of the session list", async () => {
  const { store } = await makeStore();
  const table = await store.create({ title: "Tavolo", provider: "claude", model: "m" });
  const thread = await store.create({
    title: "Combattimento",
    provider: "claude",
    model: "m",
    kind: "combat",
    parentId: table.id,
  });
  assert.equal(thread.kind, "combat");
  assert.equal(thread.parentId, table.id);
  const listed = await store.list();
  assert.deepEqual(listed.map((item) => item.id), [table.id]);
  const threads = await store.threads(table.id);
  assert.deepEqual(threads.map((item) => item.id), [thread.id]);
});

test("combat thread needs a parent and table sessions take none", async () => {
  const { store } = await makeStore();
  await assert.rejects(
    store.create({ title: "T", provider: "claude", model: "m", kind: "combat" }),
    { message: "Dati sessione non validi" },
  );
  const table = await store.create({ title: "Tavolo", provider: "claude", model: "m" });
  await assert.rejects(
    store.create({ title: "T", provider: "claude", model: "m", kind: "table", parentId: table.id }),
    { message: "Dati sessione non validi" },
  );
});

test("deleting the parent deletes its combat threads", async () => {
  const { store } = await makeStore();
  const table = await store.create({ title: "Tavolo", provider: "claude", model: "m" });
  const thread = await store.create({
    title: "Combattimento",
    provider: "claude",
    model: "m",
    kind: "combat",
    parentId: table.id,
  });
  await store.delete(table.id);
  await assert.rejects(store.get(thread.id));
  assert.deepEqual(await store.threads(table.id), []);
});

test("table tools exclude combat and battle screen, combat tools include the shared ones", () => {
  const table: readonly string[] = TABLE_TOOL_NAMES;
  const combat: readonly string[] = COMBAT_TOOL_NAMES;
  for (const name of table) {
    assert.ok(!name.startsWith("combat_") && !name.startsWith("battle_"), name);
  }
  assert.ok(!table.includes("find_battle_map"));
  assert.ok(table.includes("ledger_note"));
  assert.ok(table.includes("board_place"));
  assert.ok(combat.includes("combat_turn"));
  assert.ok(combat.includes("battle_move"));
  assert.ok(combat.includes("combat_condition"));
  assert.ok(!table.includes("combat_condition"));
  assert.ok(COCKPIT_TOOL_NAMES.includes("combat_condition"));
  assert.ok(combat.includes("ledger_note"));
  assert.ok(combat.includes("read_doc"));
  assert.ok(!combat.includes("board_place"));
  assert.ok(!table.includes("combat_card_set"));
  assert.ok(!combat.includes("combat_card_set"));
  assert.equal(table.length, COCKPIT_TOOL_NAMES.length - 12);
});
