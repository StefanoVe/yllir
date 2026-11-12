import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Provider } from "../providers/provider.js";
import type { ProviderId } from "../../../../shared/src/cockpit-types.js";
import { CockpitBus } from "../bus.js";
import { CockpitStore } from "../store.js";
import { createResolver } from "../resolvers.js";
import { TurnTokens, mcpHandler } from "../mcp.js";
import { createCockpitTools } from "../tools.js";
import { TurnManager } from "../turns.js";
import { stateView } from "../view.js";
import type { CockpitArchive, Detail, MusicTrack, PlotGraph } from "../ports.js";
import { webHandlerServer } from "../http-bridge.js";
import { listenLoopback, type Listening } from "./listen.js";
import { fakeKindOf } from "../fake-ports.js";
import { CockpitLive } from "../live.js";
import { createFakeFramework, type FakeFramework } from "./fake-framework.js";

export async function makeTurnHarness(
  provider: Provider,
  options: {
    idleTimeoutMs?: number;
    turnTimeoutMs?: number;
    onChange?: (kind: string) => void;
    getPlotGraph?: () => PlotGraph;
    framework?: FakeFramework;
  } = {},
) {
  const fake = options.framework ?? createFakeFramework();
  const root = await mkdtemp(path.join(tmpdir(), "cockpit-turns-"));
  const bus = new CockpitBus(100000);
  const tokens = new TurnTokens();
  const document: Detail = {
    path: "Plot/Scena.md",
    title: "Scena",
    category: "Plot",
    area: "",
    scope: "Campagna",
    master: false,
    raw: "# Scena\nLa scena corrente.",
    html: "",
    headings: [{ id: "scena", title: "Scena", line: 1 }],
  };
  const docs = new Map([[document.path, document]]);
  const tracks = new Map<string, MusicTrack>();
  const archive = {
    docs,
    search: () => ({ hits: [], total: 0 }),
  } as unknown as Pick<CockpitArchive, "docs" | "search">;
  const maps = () => [];
  const resolve = createResolver({ archive, maps, tracks });
  const store = new CockpitStore(root, {
    onChange: (session, change) => {
      options.onChange?.(change.kind);
      if (change.kind === "state")
        bus.publish(session.id, {
          type: "state",
          revision: session.revision,
          state: stateView(session.state, resolve, session.id),
          history: session.history,
          ...(change.group ? { group: change.group } : {}),
        });
      else if (change.kind === "message")
        bus.publish(session.id, { type: "message", message: change.message });
      else if (change.kind === "turn")
        bus.publish(session.id, { type: "turn", turn: change.turn });
      else bus.publish(session.id, { type: "deleted" });
    },
  });
  const music = {
    search: async () => [],
    request: async () => ({ ok: true }),
  } as never;
  const live = new CockpitLive(store, fake.framework);
  const categories = { kindOf: fakeKindOf, folderFor: () => null, playersFolder: () => "Players" };
  const tools = createCockpitTools({
    store,
    archive,
    maps,
    tracks,
    categories,
    live,
    getPlotGraph:
      options.getPlotGraph ||
      (() => ({
        source: "",
        nodes: [],
        groups: [],
        edges: [],
        unresolved: [],
      })),
    resolve,
    bus,
    music,
  });
  const handler = mcpHandler({ tokens, tools });
  const server: Listening = await listenLoopback(
    webHandlerServer(
      async (request) =>
        (await handler(request)) || new Response("Non trovato", { status: 404 }),
    ),
  );
  const providers: Partial<Record<ProviderId, Provider>> = {
    [provider.id]: provider,
  };
  const turns = new TurnManager({
    store,
    bus,
    providers,
    tokens,
    resolve,
    getPlotGraph:
      options.getPlotGraph ||
      (() => ({
        source: "",
        nodes: [],
        groups: [],
        edges: [],
        unresolved: [],
      })),
    mcpUrl: `${server.url}/mcp/cockpit`,
    hydrate: (session) => live.hydrate(session),
    idleTimeoutMs: options.idleTimeoutMs,
    turnTimeoutMs: options.turnTimeoutMs,
  });
  const session = await store.create({
    title: "Test",
    provider: provider.id,
    model: provider.defaultModel,
  });
  return {
    root,
    store,
    bus,
    tokens,
    turns,
    server,
    session,
    live,
    fake,
    async close() {
      await turns.close();
      await server.close();
      bus.close();
      tokens.close();
      await store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
