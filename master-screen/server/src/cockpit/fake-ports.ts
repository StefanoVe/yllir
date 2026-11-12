// TEMPORARY ports for the cockpit: every read is empty and music is unavailable.
// The host adapters (cockpit-host) replace this file's factory with the real archive,
// maps, images, plot map, categories and music bridge.
import type { CockpitKind, CockpitPorts } from "./ports.js";

/** Prototype folder names, kept so the fake ports behave like the prototype. */
export const PROTOTYPE_FOLDERS = {
  plot: "Plot",
  npc: "NPCs",
  enemy: "Enemies",
  item: "Items",
  location: "World",
  lore: "Lore",
  players: "Players",
} as const;

export function fakeKindOf(relPath: string): CockpitKind {
  const [top = "", second = ""] = relPath.split("/");
  if (top === PROTOTYPE_FOLDERS.plot) return "plot";
  if (top === PROTOTYPE_FOLDERS.npc) return "npc";
  if (top === PROTOTYPE_FOLDERS.enemy) return "enemy";
  if (top === PROTOTYPE_FOLDERS.item) return "item";
  if (top === PROTOTYPE_FOLDERS.location) return "location";
  if (top === PROTOTYPE_FOLDERS.lore) return second === "Deep Past" ? "other" : "lore";
  if (top === PROTOTYPE_FOLDERS.players) {
    return /\/sessione[^/]*\.md$/i.test(relPath) ? "session" : "pc";
  }
  return "other";
}

export function createFakePorts(): CockpitPorts {
  return {
    archive: {
      docs: new Map(),
      search: () => ({ hits: [], total: 0 }),
      version: () => "",
      refresh: async () => {},
    },
    categories: {
      kindOf: fakeKindOf,
      folderFor: (kind) =>
        kind === "npc"
          ? PROTOTYPE_FOLDERS.npc
          : kind === "enemy"
            ? PROTOTYPE_FOLDERS.enemy
            : kind === "item"
              ? PROTOTYPE_FOLDERS.item
              : PROTOTYPE_FOLDERS.location,
      playersFolder: () => PROTOTYPE_FOLDERS.players,
    },
    music: {
      search: async () => [],
      request: async () => {
        throw new Error("Il servizio musicale non è disponibile.");
      },
      library: async () => [],
    },
    battle: {
      find: async () => [],
      setMap: async (map) => ({ map: { ref: map.ref, ...(map.cols ? { cols: map.cols } : {}), ...(map.rows ? { rows: map.rows } : {}) }, positions: {}, revision: 1 }),
      move: async (id, x, y) => ({ map: null, positions: { [id]: { x, y } }, revision: 1 }),
    },
    listMaps: async () => [],
    listImages: async () => [],
    buildPlotGraph: () => ({
      source: "",
      nodes: [],
      groups: [],
      edges: [],
      unresolved: [],
    }),
  };
}
