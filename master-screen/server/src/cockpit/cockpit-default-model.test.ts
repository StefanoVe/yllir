import { afterEach, test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import { FakeProvider } from "./test-helpers/fake-provider.js";
import { makeTurnHarness } from "./test-helpers/cockpit-harness.js";
import { cockpitApi, type CockpitApiDeps } from "./api.js";
import { createResolver } from "./resolvers.js";
import { LIVE_MODELS, type LiveModelChoice } from "./providers/claude.js";

const harnesses: Awaited<ReturnType<typeof makeTurnHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

async function setup(defaultModels?: CockpitApiDeps["defaultModels"]) {
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
    defaultModels,
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

const defaults = (live: LiveModelChoice, combat: LiveModelChoice = "haiku") => async () => ({ live, combat });

test("without defaultModels a new session uses Haiku", async () => {
  const { call, store } = await setup();
  const response = await call("POST", "/api/cockpit/sessions", { title: "Serata" });
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.model).toBe(LIVE_MODELS.haiku);
  expect((await store.get(body.id)).model).toBe(LIVE_MODELS.haiku);
});

test("the live default from the settings applies when the request has no model", async () => {
  const { call, store } = await setup(defaults("sonnet"));
  const response = await call("POST", "/api/cockpit/sessions", { title: "Serata" });
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.model).toBe(LIVE_MODELS.sonnet);
  expect((await store.get(body.id)).model).toBe(LIVE_MODELS.sonnet);
});

test("an explicit model in the request wins over the settings default", async () => {
  const { call } = await setup(defaults("sonnet"));
  const response = await call("POST", "/api/cockpit/sessions", { title: "Serata", model: "opus" });
  expect(response.status).toBe(201);
  expect((await response.json()).model).toBe(LIVE_MODELS.opus);
});

test("a settings default that cannot be read falls back to Haiku", async () => {
  const { call } = await setup(() => Promise.reject(new Error("settings unreadable")));
  const response = await call("POST", "/api/cockpit/sessions", { title: "Serata" });
  expect(response.status).toBe(201);
  expect((await response.json()).model).toBe(LIVE_MODELS.haiku);
});

test("the combat thread uses the combat default from the settings", async () => {
  const { call, session, store, fake } = await setup(defaults("haiku", "opus"));
  fake.combat = { active: true, round: 0, turn: 0, order: [], combatants: [], events: [], revision: 0 };
  const response = await call("POST", `/api/cockpit/sessions/${session.id}/combat/thread`);
  expect(response.status).toBe(200);
  const { threadId } = await response.json();
  expect((await store.get(threadId)).model).toBe(LIVE_MODELS.opus);
});
