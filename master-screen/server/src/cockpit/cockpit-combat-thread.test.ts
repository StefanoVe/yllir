import { afterEach, test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import { FakeProvider } from "./test-helpers/fake-provider.js";
import { makeTurnHarness } from "./test-helpers/cockpit-harness.js";
import { cockpitApi } from "./api.js";
import { createResolver } from "./resolvers.js";
import { LIVE_MODELS } from "./providers/claude.js";

const harnesses: Awaited<ReturnType<typeof makeTurnHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

async function setup() {
  const provider = new FakeProvider([]);
  const harness = await makeTurnHarness(provider);
  harnesses.push(harness);
  const resolve = createResolver({
    archive: { docs: new Map() } as never,
    maps: () => [],
    tracks: new Map(),
  });
  // A variable, not a literal: the deps type gains or loses `model` with the model selector.
  const deps = {
    store: harness.store,
    turns: harness.turns,
    bus: harness.bus,
    live: harness.live,
    resolve,
    provider: "claude" as const,
    model: "fake-model",
  };
  const api = cockpitApi(deps);
  const call = (method: string, path: string, body?: unknown) =>
    api(
      new Request(`http://localhost${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    ) as Promise<Response>;
  return { ...harness, provider, call };
}

const startFight = (call: Awaited<ReturnType<typeof setup>>["call"], table: string, title = "Scontro") =>
  call("POST", `/api/cockpit/sessions/${table}/actions`, {
    actions: [{ type: "combat.start", title, participants: [] }],
  });

const threadRoute = (table: string) => `/api/cockpit/sessions/${table}/combat/thread`;

test("the combat thread is refused with 409 when no fight is active", async () => {
  const { call, session } = await setup();
  const response = await call("POST", threadRoute(session.id));
  expect(response.status).toBe(409);
});

test("the combat thread is created once per fight and shared by concurrent calls", async () => {
  const { call, session, store } = await setup();
  expect((await startFight(call, session.id)).status).toBe(200);

  const first = await call("POST", threadRoute(session.id));
  expect(first.status).toBe(200);
  const { threadId } = await first.json();
  expect(typeof threadId).toBe("string");

  const second = await call("POST", threadRoute(session.id));
  expect((await second.json()).threadId).toBe(threadId);

  const [a, b] = await Promise.all([
    call("POST", threadRoute(session.id)),
    call("POST", threadRoute(session.id)),
  ]);
  expect((await a.json()).threadId).toBe(threadId);
  expect((await b.json()).threadId).toBe(threadId);
  expect((await store.threads(session.id)).length).toBe(1);

  const thread = await store.get(threadId);
  expect(thread.kind).toBe("combat");
  expect(thread.parentId).toBe(session.id);
  expect(thread.model).toBe(LIVE_MODELS.haiku);

  const table = await (await call("GET", `/api/cockpit/sessions/${session.id}`)).json();
  expect(table.state.combat.threadId).toBe(threadId);
});

test("concurrent first calls create exactly one thread", async () => {
  const { call, session, store } = await setup();
  await startFight(call, session.id);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => call("POST", threadRoute(session.id))),
  );
  const ids = await Promise.all(results.map(async (r) => (await r.json()).threadId));
  expect(new Set(ids).size).toBe(1);
  expect((await store.threads(session.id)).length).toBe(1);
});

test("a combat thread refuses the table-only routes", async () => {
  const { call, session } = await setup();
  await startFight(call, session.id);
  const { threadId } = await (await call("POST", threadRoute(session.id))).json();
  const thread = `/api/cockpit/sessions/${threadId}`;

  const actions = await call("POST", `${thread}/actions`, {
    actions: [{ type: "combat.notes", notes: "x" }],
  });
  expect(actions.status).toBe(409);
  const undo = await call("POST", `${thread}/undo`, { groupId: "g" });
  expect(undo.status).toBe(409);
  const layout = await call("POST", `${thread}/layout`, { items: [{ id: "x", x: 1, y: 1 }] });
  expect(layout.status).toBe(409);
});

test("after the fight ends its thread refuses messages, and a new fight gets a new thread", async () => {
  const { call, session, provider } = await setup();
  await startFight(call, session.id, "Primo");
  const { threadId: first } = await (await call("POST", threadRoute(session.id))).json();

  const ended = await call("POST", `/api/cockpit/sessions/${session.id}/actions`, {
    actions: [{ type: "combat.end" }],
  });
  expect(ended.status).toBe(200);

  const closed = await call("POST", `/api/cockpit/sessions/${first}/messages`, { text: "ciao" });
  expect(closed.status).toBe(409);
  expect(provider.received.length).toBe(0);

  const refused = await call("POST", threadRoute(session.id));
  expect(refused.status).toBe(409);

  expect((await startFight(call, session.id, "Secondo")).status).toBe(200);
  const { threadId: second } = await (await call("POST", threadRoute(session.id))).json();
  expect(second).not.toBe(first);
});

test("the sessions list does not show combat threads", async () => {
  const { call, session } = await setup();
  await startFight(call, session.id);
  const { threadId } = await (await call("POST", threadRoute(session.id))).json();
  const list = (await (await call("GET", "/api/cockpit/sessions")).json()) as { id: string }[];
  expect(list.some((item) => item.id === threadId)).toBe(false);
  expect(list.some((item) => item.id === session.id)).toBe(true);
});
