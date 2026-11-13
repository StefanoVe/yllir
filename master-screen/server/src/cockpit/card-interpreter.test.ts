import { test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import { CardInterpreter } from "./card-interpreter.js";
import { TurnTokens } from "./mcp.js";
import type { Provider, ProviderEvent, TurnInput } from "./providers/provider.js";
import { CARD_TOOL_NAMES } from "./tools.js";

interface Recorded {
  input: TurnInput;
  signal: AbortSignal;
}

/** Provider that records every run. `behaviour` decides how each run ends. */
function fakeProvider(behaviour: (signal: AbortSignal, input: TurnInput) => AsyncIterable<ProviderEvent> | Promise<void>) {
  const runs: Recorded[] = [];
  const provider = {
    id: "claude",
    defaultModel: "fake",
    status: async () => ({ id: "claude", available: true, model: "fake" }),
    close: async () => {},
    async *run(input: TurnInput, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      runs.push({ input, signal });
      const result = behaviour(signal, input);
      if (result && Symbol.asyncIterator in result) {
        yield* result as AsyncIterable<ProviderEvent>;
      } else {
        await result;
      }
    },
  } as unknown as Provider;
  return { provider, runs };
}

/** Provider that yields nothing and ends at once. */
const endsAtOnce = () => fakeProvider(() => Promise.resolve());

function battleWith(options: { card?: boolean; text?: string | null } = {}) {
  return {
    card: async () => (options.card ? { sheet: "x", sheetHash: "h", actions: [], at: "" } : null),
    cardSource: async (sheet: string) =>
      options.text === null ? null : { text: options.text ?? `Testo di ${sheet}`, hash: "h" },
  };
}

function interpreter(
  provider: Provider | undefined,
  options: {
    battle?: ReturnType<typeof battleWith>;
    tokens?: TurnTokens;
    timeoutMs?: number;
    onChange?: () => void;
    log?: (message: string) => void;
  } = {},
) {
  const tokens = options.tokens ?? new TurnTokens();
  const cards = new CardInterpreter({
    provider,
    tokens,
    mcpUrl: "http://127.0.0.1:1/mcp/cockpit",
    battle: options.battle ?? battleWith(),
    model: "claude-haiku-5-5",
    language: "it",
    systemName: "Sistema di prova",
    onChange: options.onChange ?? (() => {}),
    log: options.log,
    timeoutMs: options.timeoutMs,
  });
  return { cards, tokens };
}

test("two requests for the same sheet, with duplicates in one list, start one provider run", async () => {
  const { provider, runs } = endsAtOnce();
  const { cards } = interpreter(provider);
  cards.request("s1", ["Creature/Guardia.md"]);
  cards.request("s1", ["Creature/Guardia.md", "Creature/Guardia.md"]);
  await cards.idle();
  expect(runs).toHaveLength(1);
});

test("a sheet with a valid card starts no run", async () => {
  const { provider, runs } = endsAtOnce();
  const { cards } = interpreter(provider, { battle: battleWith({ card: true }) });
  cards.request("s1", ["Creature/Guardia.md"]);
  await cards.idle();
  expect(runs).toHaveLength(0);
  expect(cards.pending().size).toBe(0);
});

test("a sheet without a readable source starts no run", async () => {
  const { provider, runs } = endsAtOnce();
  const { cards } = interpreter(provider, { battle: battleWith({ text: null }) });
  cards.request("s1", ["Creature/Nota.md"]);
  await cards.idle();
  expect(runs).toHaveLength(0);
});

test("the run gets the card tool only, the haiku model and the sheet text", async () => {
  const { provider, runs } = endsAtOnce();
  const { cards } = interpreter(provider, { battle: battleWith({ text: "Morso: 1d6+2 danni perforanti." }) });
  cards.request("sessione-7", ["Creature/Guardia.md"]);
  await cards.idle();
  expect(runs).toHaveLength(1);
  const input = runs[0]!.input;
  expect(input.tools).toEqual(["combat_card_set"]);
  expect(input.tools).toEqual([...CARD_TOOL_NAMES]);
  expect(input.model).toBe("claude-haiku-5-5");
  expect(input.sessionId).toBe("sessione-7");
  expect(input.mcp.url).toBe("http://127.0.0.1:1/mcp/cockpit");
  expect(input.userPrompt).toContain("Morso: 1d6+2 danni perforanti.");
  expect(input.userPrompt).toContain("SHEET: Creature/Guardia.md");
  expect(input.systemPrompt).toContain("combat_card_set");
});

test("pending holds the sheet while its run is open and is empty after idle", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { provider } = fakeProvider(() => gate);
  const { cards } = interpreter(provider);
  cards.request("s1", ["Creature/Guardia.md"]);
  expect(cards.pending().has("Creature/Guardia.md")).toBe(true);
  // Let the job reach the provider before checking again.
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(cards.pending().has("Creature/Guardia.md")).toBe(true);
  release();
  await cards.idle();
  expect(cards.pending().size).toBe(0);
});

test("onChange is called when the job starts and when it ends", async () => {
  let changes = 0;
  const { provider } = endsAtOnce();
  const { cards } = interpreter(provider, { onChange: () => changes++ });
  cards.request("s1", ["Creature/Guardia.md"]);
  expect(changes).toBe(1);
  await cards.idle();
  expect(changes).toBe(2);
});

test("the token of a run is revoked when the run ends", async () => {
  const { provider, runs } = endsAtOnce();
  const tokens = new TurnTokens();
  const { cards } = interpreter(provider, { tokens });
  cards.request("s1", ["Creature/Guardia.md"]);
  await cards.idle();
  const token = runs[0]!.input.mcp.token;
  expect(token.length > 0).toBe(true);
  expect(tokens.get(token)).toBe(undefined);
});

test("a provider that throws is logged and the sheet leaves pending", async () => {
  const logged: string[] = [];
  const { provider } = fakeProvider(async () => {
    throw new Error("boom");
  });
  const { cards } = interpreter(provider, { log: (message) => logged.push(message) });
  cards.request("s1", ["Creature/Guardia.md"]);
  await cards.idle();
  expect(logged).toEqual(["card Creature/Guardia.md: boom"]);
  expect(cards.pending().size).toBe(0);
});

test("a provider that never ends is aborted by the timeout and the sheet leaves pending", async () => {
  let seenSignal: AbortSignal | undefined;
  // Ignores the signal on purpose: the job must still end at the timeout.
  const { provider, runs } = fakeProvider((signal) => {
    seenSignal = signal;
    return new Promise<void>(() => {});
  });
  const logged: string[] = [];
  const { cards } = interpreter(provider, { timeoutMs: 20, log: (message) => logged.push(message) });
  cards.request("s1", ["Creature/Guardia.md"]);
  await cards.idle();
  expect(runs).toHaveLength(1);
  expect(seenSignal!.aborted).toBe(true);
  expect(logged).toHaveLength(1);
  expect(cards.pending().size).toBe(0);
});

test("close aborts the running jobs", async () => {
  const { provider, runs } = fakeProvider((signal) =>
    new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
  );
  const { cards } = interpreter(provider);
  cards.request("s1", ["Creature/Guardia.md"]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  cards.close();
  await cards.idle();
  expect(runs[0]!.signal.aborted).toBe(true);
  expect(cards.pending().size).toBe(0);
});

test("without a provider or without the battle card ports nothing starts", async () => {
  const { cards } = interpreter(undefined);
  cards.request("s1", ["Creature/Guardia.md"]);
  expect(cards.pending().size).toBe(0);
  const { provider, runs } = endsAtOnce();
  const bare = new CardInterpreter({
    provider,
    tokens: new TurnTokens(),
    mcpUrl: "http://127.0.0.1:1/mcp/cockpit",
    battle: {},
    model: "m",
    language: "it",
    systemName: null,
    onChange: () => {},
  });
  bare.request("s1", ["Creature/Guardia.md"]);
  await bare.idle();
  expect(runs).toHaveLength(0);
});
