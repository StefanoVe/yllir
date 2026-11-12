import { afterEach, test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import { FakeProvider } from "./test-helpers/fake-provider.js";
import { makeTurnHarness } from "./test-helpers/cockpit-harness.js";
import { cockpitApi } from "./api.js";
import { createResolver } from "./resolvers.js";

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
  const api = cockpitApi({
    store: harness.store,
    turns: harness.turns,
    bus: harness.bus,
    live: harness.live,
    resolve,
    provider: "claude",
  });
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

test("create without a model chooses Haiku, the chosen short model maps to its id", async () => {
  const { call, store } = await setup();
  const plain = await call("POST", "/api/cockpit/sessions", { title: "Serata" });
  expect(plain.status).toBe(201);
  expect((await plain.json()).model).toBe("claude-haiku-5-5");
  const opus = await call("POST", "/api/cockpit/sessions", { title: "Serata", model: "opus" });
  expect(opus.status).toBe(201);
  const body = await opus.json();
  expect(body.model).toBe("claude-opus-5-5");
  expect((await store.get(body.id)).model).toBe("claude-opus-5-5");
});

test("create with a model that is not a short choice is refused", async () => {
  const { call } = await setup();
  const response = await call("POST", "/api/cockpit/sessions", { title: "Serata", model: "gpt" });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("Modello non valido");
});

test("PATCH changes the stored model and returns the session view", async () => {
  const { call, session, store } = await setup();
  const response = await call("PATCH", `/api/cockpit/sessions/${session.id}`, { model: "sonnet" });
  expect(response.status).toBe(200);
  expect((await response.json()).model).toBe("claude-sonnet-5-5");
  expect((await store.get(session.id)).model).toBe("claude-sonnet-5-5");
});

test("PATCH with an invalid model is refused and leaves the model as it was", async () => {
  const { call, session, store } = await setup();
  const before = (await store.get(session.id)).model;
  const response = await call("PATCH", `/api/cockpit/sessions/${session.id}`, { model: "claude-opus-5-5" });
  expect(response.status).toBe(400);
  expect((await store.get(session.id)).model).toBe(before);
});

test("the next turn after a PATCH uses the new model", async () => {
  const { call, session, store, provider } = await setup();
  const patched = await call("PATCH", `/api/cockpit/sessions/${session.id}`, { model: "opus" });
  expect(patched.status).toBe(200);
  const posted = await call("POST", `/api/cockpit/sessions/${session.id}/messages`, { text: "Ciao" });
  expect(posted.status).toBe(202);
  const { turnId } = await posted.json();
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const turn = (await store.get(session.id)).turns.find((item) => item.id === turnId);
    if (turn && ["done", "error", "cancelled"].includes(turn.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(provider.received.length).toBe(1);
  expect(provider.received[0]!.model).toBe("claude-opus-5-5");
});
