// Cockpit server: the live table's session store, event bus, turns, tools and MCP endpoint,
// wired to the host through the ports (ports.ts) and to the framework through `framework`.
// Claude is the only provider.
import { CockpitBus } from "./bus.js";
import { CockpitStore } from "./store.js";
import { createResolver, type TrackCache } from "./resolvers.js";
import { createCockpitTools } from "./tools.js";
import { TurnTokens, mcpHandler } from "./mcp.js";
import { TurnManager } from "./turns.js";
import { cockpitApi } from "./api.js";
import { sessionView, stateView } from "./view.js";
import type { Resolver } from "./view.js";
import type { Provider } from "./providers/provider.js";
import type { CockpitPorts, ImageAsset, MapAsset, PlotGraph } from "./ports.js";
import type { CockpitSession, ProviderId } from "../../../shared/src/cockpit-types.js";
import { CockpitLive } from "./live.js";
import { unavailableFramework, type CockpitFramework } from "./framework.js";
import { readCampaignConfig, type CampaignConfig } from "./campaign-config.js";
import { buildCombatSystemPrompt, buildSystemPrompt } from "./prompt.js";
import type { SheetDeps } from "./authoring.js";

export interface CreateCockpitOptions {
  /** Campaign folder: the sheets are written under it, and the store's default container. */
  root: string;
  /** Where the sessions are stored, e.g. <campaign>/.campaign/state/live/cockpit. */
  sessionsRoot: string;
  /** Loopback port of this server: the MCP URL handed to the provider is built from it. */
  port: number;
  provider: Provider;
  ports: CockpitPorts;
  /** Ledger, combat and engine. Without it every ledger, combat and sheet call answers "not supported". */
  framework?: CockpitFramework;
  /** Language and game system for the prompt. Read from campaign.yaml under `root` when omitted. */
  campaign?: CampaignConfig;
}

export function createCockpit(options: CreateCockpitOptions) {
  const { ports } = options;
  const framework = options.framework ?? unavailableFramework();
  const campaign = options.campaign ?? readCampaignConfig(options.root);
  const bus = new CockpitBus();
  let resolve: Resolver = () => ({ title: "" });
  let live: CockpitLive;
  // State events are published in order: each one waits for the previous, because the
  // ledger and combat are filled from the framework before they are sent.
  let publishing: Promise<void> = Promise.resolve();
  const publishState = (session: CockpitSession, group?: CockpitSession["history"][number]) => {
    publishing = publishing
      .then(async () => {
        const full = await live.hydrate(session);
        bus.publish(session.id, {
          type: "state",
          revision: session.revision,
          state: stateView(full.state, resolve, session.id),
          history: session.history,
          ...(group ? { group } : {}),
        });
      })
      .catch((error: unknown) => console.error("[cockpit] stato:", error));
  };
  const store = new CockpitStore(options.root, {
    sessionsRoot: options.sessionsRoot,
    onChange(session, change) {
      if (change.kind === "state") publishState(session, change.group);
      else if (change.kind === "message")
        bus.publish(session.id, { type: "message", message: change.message });
      else if (change.kind === "turn")
        bus.publish(session.id, { type: "turn", turn: change.turn });
      else bus.publish(session.id, { type: "deleted" });
    },
  });
  live = new CockpitLive(store, framework);
  const tracks: TrackCache = new Map();
  // Fill the track cache from the whole library whenever it (re)loads, so music
  // cards keep their titles across server restarts.
  let libraryVersion = -1;
  ports.music.subscribe?.((state) => {
    if (state.phase !== "ready" || state.libraryVersion === libraryVersion)
      return;
    libraryVersion = state.libraryVersion ?? libraryVersion;
    ports.music
      .library()
      .then((all) => {
        for (const track of all) tracks.set(track.id, track);
      })
      .catch((error) => console.error("[cockpit] libreria musicale:", error));
  });
  let mapVersion = "";
  let mapValues: MapAsset[] = [];
  // The image index is built from the same maps, in the same refresh.
  let imageValues: ImageAsset[] = [];
  let mapRefresh: Promise<void> | undefined;
  const refreshMaps = () => {
    const version = ports.archive.version();
    if (mapVersion === version || mapRefresh) return;
    mapRefresh = ports
      .listMaps(ports.archive.docs.values())
      .then(async (maps) => {
        mapValues = maps;
        mapVersion = version;
        imageValues = await ports
          .listImages(ports.archive.docs.values(), maps)
          .catch(() => imageValues);
      })
      .catch(() => {})
      .finally(() => {
        mapRefresh = undefined;
      });
  };
  void refreshMaps();
  const maps = () => {
    refreshMaps();
    return mapValues;
  };
  const images = () => {
    refreshMaps();
    return imageValues;
  };
  let plotVersion = "";
  let plotGraph: PlotGraph = ports.buildPlotGraph(ports.archive.docs.values());
  const getPlotGraph = () => {
    if (plotVersion !== ports.archive.version()) {
      plotGraph = ports.buildPlotGraph(ports.archive.docs.values());
      plotVersion = ports.archive.version();
    }
    return plotGraph;
  };
  resolve = createResolver({
    archive: ports.archive,
    maps,
    images,
    tracks,
  });
  const sheetsFor = (sessionId: string): SheetDeps => ({
    root: options.root,
    categories: ports.categories,
    framework,
    docs: () => ports.archive.docs,
    language: campaign.language,
    refresh: () => ports.archive.refresh(),
    created: async () => (await store.sideGet(sessionId)).sheets,
    remember: async (sheet) => {
      await store.sideUpdate(sessionId, (side) => ({
        ...side,
        sheets: [...side.sheets.filter((item) => item.path !== sheet.path), sheet],
      }));
    },
  });
  const tools = createCockpitTools({
    store,
    archive: ports.archive,
    maps,
    images,
    tracks,
    getPlotGraph,
    resolve,
    bus,
    music: ports.music,
    categories: ports.categories,
    live,
    sheets: sheetsFor,
    battle: ports.battle,
  });
  const tokens = new TurnTokens();
  const mcp = mcpHandler({ tokens, tools });
  const providerId: ProviderId = "claude";
  const providers: Partial<Record<ProviderId, Provider>> = {
    [providerId]: options.provider,
  };
  const turns = new TurnManager({
    store,
    bus,
    providers,
    tokens,
    resolve,
    getPlotGraph,
    mcpUrl: `http://127.0.0.1:${options.port}/mcp/cockpit`,
    systemPrompt: buildSystemPrompt({
      language: campaign.language,
      systemName: campaign.systemName,
    }),
    combatSystemPrompt: buildCombatSystemPrompt({
      language: campaign.language,
      systemName: campaign.systemName,
    }),
    hydrate: (session) => live.hydrate(session),
    combatRules: async () => (await ports.battle?.rules?.()) ?? { conditions: [], durations: [] },
  });
  const api = cockpitApi({
    store,
    turns,
    bus,
    resolve,
    live,
    provider: providerId,
  });
  // A change made from the terminal (session log, combat) shows on the desk at once.
  const unwatch = framework.watch?.(() => {
    void store
      .list()
      .then((sessions) => Promise.all(sessions.map((item) => store.get(item.id))))
      .then((sessionsNow) => sessionsNow.forEach((session) => publishState(session)))
      .catch(() => {});
  });
  return {
    /** SSE of one session, for the per-tab live stream. */
    async events(sessionId: string, lastEventId: string | null) {
      await store.get(sessionId);
      return bus.subscribe(sessionId, lastEventId, async () => ({
        type: "snapshot" as const,
        session: sessionView(await live.hydrate(await store.get(sessionId)), resolve),
      }));
    },
    async handle(request: Request): Promise<Response | null> {
      const url = new URL(request.url);
      if (url.pathname === "/mcp/cockpit") return mcp(request);
      return api(request);
    },
    async close() {
      unwatch?.();
      await turns.close();
      tokens.close();
      bus.close();
      await store.close();
      await options.provider.close().catch(() => {});
    },
  };
}

export type Cockpit = ReturnType<typeof createCockpit>;
