import { afterEach, test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import { FakeProvider, type FakeStep } from "./test-helpers/fake-provider.js";
import { makeTurnHarness } from "./test-helpers/cockpit-harness.js";

const harnesses: Awaited<ReturnType<typeof makeTurnHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});
async function setup(
  steps: FakeStep[],
  options: Parameters<typeof makeTurnHarness>[1] = {},
  retrySteps?: FakeStep[],
) {
  const provider = new FakeProvider(steps, retrySteps);
  const harness = await makeTurnHarness(provider, options);
  harnesses.push(harness);
  return { ...harness, provider };
}
async function waitForTurn(
  store: Awaited<ReturnType<typeof makeTurnHarness>>["store"],
  sessionId: string,
  turnId: string,
  expected: string[],
) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const session = await store.get(sessionId);
    const turn = session.turns.find((item) => item.id === turnId);
    if (turn && expected.includes(turn.status)) return { session, turn };
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Turno ${turnId} non ha raggiunto ${expected.join("/")}`);
}
async function read(reader: ReadableStreamDefaultReader<Uint8Array>) {
  return Promise.race([
    reader.read(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout SSE")), 1000),
    ),
  ]);
}

test("delta in ordine e azione MCP visibile sul bus prima della fine turno", async () => {
  const h = await setup([
    { type: "event", event: { type: "text", text: "prima" } },
    {
      type: "callTool",
      name: "board_place",
      arguments: {
        cards: [
          {
            kind: "plot",
            path: "Plot/Scena.md",
            anchor: "scena",
            reason: "ora",
          },
        ],
      },
    },
    { type: "delay", ms: 90 },
    { type: "event", event: { type: "text", text: "dopo" } },
  ]);
  const response = await h.bus.subscribe(h.session.id, null, async () => ({
    type: "deleted",
  }));
  const reader = response.body!.getReader();
  await read(reader);
  const [submitted, duplicate] = await Promise.all([
    h.turns.submit(h.session.id, "La scena cambia", "client-1"),
    h.turns.submit(h.session.id, "ignora duplicato", "client-1"),
  ]);
  expect(duplicate).toEqual(submitted);
  const observed: string[] = [];
  let reached = false;
  while (!reached) {
    const chunk = await read(reader);
    const frame = new TextDecoder().decode(chunk.value);
    observed.push(frame);
    if (frame.includes('"type":"state"') && frame.includes('"revision":1'))
      reached = true;
  }
  expect(
    observed.some(
      (frame) => frame.includes('"type":"delta"') && frame.includes("prima"),
    ),
  ).toBe(true);
  expect(
    (await h.store.get(h.session.id)).turns.find(
      (turn) => turn.id === submitted.turnId,
    )?.status,
  ).toBe("running");
  while (!observed.some((frame) => frame.includes('"text":"dopo"'))) {
    const frame = new TextDecoder().decode((await read(reader)).value);
    observed.push(frame);
  }
  expect(
    observed.findIndex((frame) => frame.includes('"text":"prima"')),
  ).toBeLessThan(
    observed.findIndex((frame) => frame.includes('"text":"dopo"')),
  );
  const finished = await waitForTurn(h.store, h.session.id, submitted.turnId, [
    "done",
  ]);
  expect(finished.session.state.board.modules).toHaveLength(1);
  expect(
    finished.session.messages.find(
      (message) =>
        message.turnId === submitted.turnId && message.role === "agent",
    )?.text,
  ).toBe("primadopo");
  await reader.cancel();
});

test("coda FIFO serializza i turni senza esecuzione parallela", async () => {
  const h = await setup([
    { type: "delay", ms: 30 },
    { type: "event", event: { type: "text", text: "ok" } },
  ]);
  const a = await h.turns.submit(h.session.id, "uno");
  const b = await h.turns.submit(h.session.id, "due");
  await waitForTurn(h.store, h.session.id, b.turnId, ["done"]);
  expect(h.provider.maxParallelRuns).toBe(1);
  expect(h.provider.received.map((input) => input.turnId)).toEqual([
    a.turnId,
    b.turnId,
  ]);
});

test("watchdog idle interrompe il provider che non produce eventi", async () => {
  const h = await setup([{ type: "block" }], {
    idleTimeoutMs: 30,
    turnTimeoutMs: 500,
  });
  const submitted = await h.turns.submit(h.session.id, "attendo");
  const result = await waitForTurn(h.store, h.session.id, submitted.turnId, [
    "error",
  ]);
  expect(result.turn.error).toContain("Il modello non risponde");
  expect(result.session.messages.at(-1)?.status).toBe("error");
});

// Total time exceeds the idle limit; each gap stays under it, so the tool calls must renew liveness.
test("le chiamate tool rinnovano liveness e impediscono il watchdog idle", async () => {
  const call: FakeStep = {
    type: "callTool",
    name: "board_place",
    arguments: {
      cards: [{ kind: "plot", path: "Plot/Scena.md", reason: "adesso" }],
    },
  };
  const h = await setup(
    [
      { type: "delay", ms: 400 },
      call,
      { type: "delay", ms: 400 },
      { ...call },
      { type: "event", event: { type: "text", text: "fatto" } },
    ],
    { idleTimeoutMs: 600, turnTimeoutMs: 4000 },
  );
  const submitted = await h.turns.submit(h.session.id, "osserva");
  const result = await waitForTurn(h.store, h.session.id, submitted.turnId, [
    "done",
    "error",
  ]);
  expect(result.turn.status).toBe("done");
});

test("cancel annulla sia un turno queued sia quello running", async () => {
  const h = await setup([{ type: "block" }], {
    idleTimeoutMs: 1000,
    turnTimeoutMs: 3000,
  });
  const first = await h.turns.submit(h.session.id, "uno");
  const second = await h.turns.submit(h.session.id, "due");
  await h.turns.cancel(h.session.id, second.turnId);
  await h.turns.cancel(h.session.id, first.turnId);
  const a = await waitForTurn(h.store, h.session.id, first.turnId, [
    "cancelled",
  ]);
  const b = await waitForTurn(h.store, h.session.id, second.turnId, [
    "cancelled",
  ]);
  expect(a.turn.status).toBe("cancelled");
  expect(b.turn.status).toBe("cancelled");
});

test("cancelAll annulla i turni di tutte le sessioni e il gestore resta utilizzabile", async () => {
  const { provider, session, store, turns } = await setup([{ type: "block" }], {
    idleTimeoutMs: 1000,
    turnTimeoutMs: 3000,
  });
  const other = await store.create({
    title: "Altra",
    provider: provider.id,
    model: provider.defaultModel,
  });
  const first = await turns.submit(session.id, "uno");
  const second = await turns.submit(other.id, "due");
  await waitForTurn(store, session.id, first.turnId, ["running"]);
  await waitForTurn(store, other.id, second.turnId, ["running"]);
  await turns.cancelAll();
  const a = await waitForTurn(store, session.id, first.turnId, ["cancelled"]);
  const b = await waitForTurn(store, other.id, second.turnId, ["cancelled"]);
  expect(a.turn.status).toBe("cancelled");
  expect(b.turn.status).toBe("cancelled");
  expect(turns.hasRunningSession(session.id)).toBe(false);
  provider.steps = [{ type: "event", event: { type: "text", text: "di nuovo" } }];
  const next = await turns.submit(session.id, "ancora");
  const done = await waitForTurn(store, session.id, next.turnId, ["done", "error"]);
  expect(done.turn.status).toBe("done");
});

test("non ripete con resume se il primo tentativo ha già applicato azioni", async () => {
  const kinds: string[] = [];
  const tool: FakeStep = {
    type: "callTool",
    name: "board_place",
    arguments: {
      cards: [{ kind: "plot", path: "Plot/Scena.md", reason: "evidenza" }],
    },
  };
  const h = await setup(
    [tool, { type: "error", message: "Errore di ripresa" }],
    { onChange: (kind) => kinds.push(kind) },
    [{ type: "event", event: { type: "text", text: "non deve comparire" } }],
  );
  await h.store.setProviderSession(h.session.id, {
    providerSessionId: "old-provider-id",
  });
  const submitted = await h.turns.submit(h.session.id, "continua");
  const result = await waitForTurn(h.store, h.session.id, submitted.turnId, [
    "error",
  ]);
  expect(h.provider.runs).toBe(1);
  expect(h.provider.received[0]?.resume).toBe("old-provider-id");
  expect(h.provider.received).toHaveLength(1);
  expect(result.session.state.board.modules).toHaveLength(1);
  expect(kinds).toContain("state");
});

test("non ripete con resume se il primo tentativo ha già emesso testo", async () => {
  const h = await setup(
    [
      { type: "event", event: { type: "text", text: "già scritto" } },
      { type: "error", message: "Errore di ripresa" },
    ],
    {},
    [{ type: "event", event: { type: "text", text: "duplicato" } }],
  );
  await h.store.setProviderSession(h.session.id, { providerSessionId: "old" });
  const submitted = await h.turns.submit(h.session.id, "continua");
  const result = await waitForTurn(h.store, h.session.id, submitted.turnId, [
    "error",
  ]);
  const agent = result.session.messages.find((item) => item.role === "agent");
  expect(h.provider.runs).toBe(1);
  expect(agent?.text).toContain("già scritto");
  expect(agent?.text).not.toContain("duplicato");
});

test("il digest include predecessori e successori della fonte Plot corrente", async () => {
  const graph = {
    source: "",
    nodes: [
      {
        id: "before",
        title: "Prima scena",
        kind: "event" as const,
        target: { path: "Plot/Atto.md", anchor: "prima", title: "Prima scena" },
      },
      {
        id: "current",
        title: "Scena attuale",
        kind: "event" as const,
        target: {
          path: "Plot/Scena.md",
          anchor: "scena",
          title: "Scena attuale",
        },
      },
      {
        id: "after",
        title: "Scelta seguente",
        kind: "choice" as const,
        target: {
          path: "Plot/Dopo.md",
          anchor: "scelta",
          title: "Scelta seguente",
        },
      },
    ],
    groups: [],
    edges: [
      {
        id: "e1",
        from: "before",
        to: "current",
        optional: false,
        relation: "narrative" as const,
      },
      {
        id: "e2",
        from: "current",
        to: "after",
        optional: true,
        relation: "narrative" as const,
      },
    ],
    unresolved: [],
  };
  const h = await setup(
    [{ type: "event", event: { type: "text", text: "ok" } }],
    {
      getPlotGraph: () => graph,
    },
  );
  await h.store.apply(
    h.session.id,
    [
      {
        type: "position.set",
        patch: { source: { path: "Plot/Scena.md", anchor: "scena" } },
      },
    ],
    { origin: "dm" },
  );
  const submitted = await h.turns.submit(h.session.id, "continua");
  await waitForTurn(h.store, h.session.id, submitted.turnId, ["done"]);
  expect(h.provider.received[0]?.userPrompt).toContain(
    "Prima scena (Plot/Atto.md#prima)",
  );
  expect(h.provider.received[0]?.userPrompt).toContain(
    "Scelta seguente (Plot/Dopo.md#scelta)",
  );
});

test("un errore senza resume chiude il turno senza perdere azioni già applicate", async () => {
  const h = await setup([
    {
      type: "callTool",
      name: "board_place",
      arguments: {
        cards: [{ kind: "plot", path: "Plot/Scena.md", reason: "prima" }],
      },
    },
    { type: "error", message: "Errore del modello" },
  ]);
  const submitted = await h.turns.submit(h.session.id, "errore");
  const result = await waitForTurn(h.store, h.session.id, submitted.turnId, [
    "error",
  ]);
  expect(result.session.state.board.modules).toHaveLength(1);
  expect(result.session.messages.at(-1)?.text).toContain("Errore del modello");
});

test("recover marca i turni rimasti queued o running come interrotti", async () => {
  const h = await setup([]);
  await h.store.upsertTurn(h.session.id, {
    id: "stale",
    messageId: "missing",
    status: "running",
  });
  await h.turns.recover();
  const session = await h.store.get(h.session.id);
  expect(session.turns.find((turn) => turn.id === "stale")?.status).toBe(
    "error",
  );
  expect(session.messages.at(-1)?.text).toBe(
    "Turno interrotto dal riavvio del server",
  );
});

test("il testo streammato viene persistito con throttling e al termine", async () => {
  const writes: string[] = [];
  const events: FakeStep[] = Array.from({ length: 120 }, (_, index) => ({
    type: "event",
    event: { type: "text", text: `${index},` },
  }));
  const h = await setup(events, { onChange: (kind) => writes.push(kind) });
  const submitted = await h.turns.submit(h.session.id, "molti token");
  const result = await waitForTurn(h.store, h.session.id, submitted.turnId, [
    "done",
  ]);
  expect(
    result.session.messages.find(
      (message) =>
        message.turnId === submitted.turnId && message.role === "agent",
    )?.text,
  ).toContain("119,");
  expect(writes.filter((kind) => kind === "message").length).toBeLessThan(10);
  expect(writes.filter((kind) => kind === "turn").length).toBeLessThan(10);
});

async function seedNotes(
  h: Awaited<ReturnType<typeof setup>>,
  texts: string[],
) {
  const seeded = await h.store.apply(
    h.session.id,
    texts.map((text) => ({
      type: "module.show" as const,
      module: {
        kind: "note" as const,
        ref: { type: "note" as const, text },
        reason: text,
      },
    })),
    { origin: "dm" },
  );
  return seeded.session.state.board.modules.map((module) => module.id);
}

test("un turno che collega carte chiude con il riordino automatico nello stesso gruppo", async () => {
  const h = await setup([]);
  const [first, second] = await seedNotes(h, ["A", "B"]);
  h.provider.steps = [
    {
      type: "callTool",
      name: "board_link",
      arguments: { from: first, to: second },
    },
    { type: "event", event: { type: "text", text: "collegate" } },
  ];
  const submitted = await h.turns.submit(h.session.id, "collega");
  const result = await waitForTurn(h.store, h.session.id, submitted.turnId, [
    "done",
  ]);
  const groups = result.session.history.filter(
    (group) => group.turnId === submitted.turnId,
  );
  expect(groups).toHaveLength(1);
  expect(groups[0]!.actions.map((action) => action.type)).toEqual([
    "link.add",
    "board.arrange",
  ]);
});

test("un turno che solo mette carte in scena non riordina la scrivania", async () => {
  const h = await setup([
    {
      type: "callTool",
      name: "board_place",
      arguments: {
        cards: [{ kind: "note", text: "Appunto", reason: "ora" }],
      },
    },
    { type: "event", event: { type: "text", text: "messa" } },
  ]);
  const submitted = await h.turns.submit(h.session.id, "metti");
  const result = await waitForTurn(h.store, h.session.id, submitted.turnId, [
    "done",
  ]);
  const types = result.session.history
    .filter((group) => group.turnId === submitted.turnId)
    .flatMap((group) => group.actions.map((action) => action.type));
  expect(types).toEqual(["module.show"]);
});

test("se il riordino automatico fallisce il turno resta completato", async () => {
  const h = await setup([]);
  const [first, second] = await seedNotes(h, ["A", "B"]);
  const original = h.store.apply.bind(h.store);
  h.store.apply = ((id, actions, meta) => {
    if (actions.some((action) => action.type === "board.arrange"))
      return Promise.reject(new Error("riordino guasto"));
    return original(id, actions, meta);
  }) as typeof h.store.apply;
  h.provider.steps = [
    {
      type: "callTool",
      name: "board_link",
      arguments: { from: first, to: second },
    },
    { type: "event", event: { type: "text", text: "collegate" } },
  ];
  const submitted = await h.turns.submit(h.session.id, "collega");
  const result = await waitForTurn(h.store, h.session.id, submitted.turnId, [
    "done",
    "error",
  ]);
  expect(result.turn.status).toBe("done");
  const types = result.session.history
    .filter((group) => group.turnId === submitted.turnId)
    .flatMap((group) => group.actions.map((action) => action.type));
  expect(types).toEqual(["link.add"]);
});

test("un turno sulla chat di scontro usa gli strumenti di combattimento, il modello del thread e il digest del tavolo", async () => {
  const h = await setup([{ type: "event", event: { type: "text", text: "annotato" } }]);
  const thread = await h.store.create({
    title: "Scontro",
    provider: "claude",
    model: "fake-haiku",
    kind: "combat",
    parentId: h.session.id,
  });
  const submitted = await h.turns.submit(thread.id, "Ada colpisce il bandito");
  await waitForTurn(h.store, thread.id, submitted.turnId, ["done"]);
  const input = h.provider.received[0]!;
  expect(input.tools).toContain("combat_turn");
  expect(input.tools).not.toContain("board_place");
  expect(input.model).toBe("fake-haiku");
  expect(input.userPrompt).toContain("NEW MASTER MESSAGE");
  expect(input.userPrompt).toContain("PLACE:");
});

test("un turno sulla sessione del tavolo non riceve gli strumenti di combattimento", async () => {
  const h = await setup([{ type: "event", event: { type: "text", text: "ok" } }]);
  const submitted = await h.turns.submit(h.session.id, "Il gruppo entra in taverna");
  await waitForTurn(h.store, h.session.id, submitted.turnId, ["done"]);
  const input = h.provider.received[0]!;
  expect(input.tools).not.toContain("combat_turn");
  expect(input.tools).toContain("board_place");
});
