// The only way the cockpit reaches the rest of the server. The host implements these
// ports (fake-ports.ts for now). Shapes are copied from the prototype's archive, maps,
// images, music and plot modules: only the members the cockpit actually uses.
import type { BattleView, CombatRules } from "../../../shared/src/types.js";

export interface Heading {
  id: string;
  title: string;
  line: number;
}

/** A document of the campaign archive, as the cockpit reads it. */
export interface Doc {
  path: string;
  title: string;
  category: string;
  area: string;
  scope: string;
  master: boolean;
  card?: string;
  printed?: string;
}

export interface Detail extends Doc {
  raw: string;
  html: string;
  headings: Heading[];
  /** The sheet contains a master-only block at the end. */
  hasMaster?: boolean;
}

export interface Hit extends Doc {
  kind?: "music";
  trackId?: string;
  excerpt: string;
  anchor: string;
}

/** A battle map or map of the campaign. */
export interface MapAsset {
  path: string;
  src: string;
  title: string;
  area: string;
  category: "Mappa" | "Battlemap";
  format: string;
}

/** An image of the campaign, indexed for the cockpit. */
export interface ImageAsset {
  /** Archive-relative path. */
  path: string;
  title: string;
  /** Folders between the top folder and img/, joined " / ". */
  area: string;
  /** card = item thumbnail; map and battlemap follow the MapAsset category. */
  kind: "map" | "battlemap" | "image" | "card";
  /** players: a card for the players, master for everything else. */
  audience: "master" | "players";
  /** "senza etichette" or "senza griglia" when the file stem says so. */
  variant?: string;
  /** Documents that embed, link or publicly show this image (max 6). */
  docs: { path: string; title: string }[];
  /** Alt texts used when embedding the image (max 4). */
  alt: string[];
}

export interface MusicTrack {
  id: string;
  title: string;
  scene: string;
  path: string;
  line: number;
  area: string;
  provider: string;
  context: string;
  snippet?: string;
}

export type MusicCommand =
  | { command: "play"; trackId: string }
  | { command: "stop" };

/** The part of the music state the cockpit reads: the library version is refreshed on change. */
export interface MusicStateLike {
  phase: string;
  libraryVersion?: number;
}

export interface PlotTarget {
  path: string;
  anchor: string;
  title: string;
}

export interface PlotMapNode {
  id: string;
  title: string;
  group?: string;
  target?: PlotTarget;
  kind: "event" | "choice" | "open" | "waypoint" | "group" | "region";
}

export interface PlotMapGroup {
  id: string;
  title: string;
}

export interface PlotMapEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  optional: boolean;
  relation: "narrative" | "membership";
}

export interface PlotGraph {
  source: string;
  nodes: PlotMapNode[];
  groups: PlotMapGroup[];
  edges: PlotMapEdge[];
  unresolved: string[];
}

/** Documents of the campaign archive: read access, search, and a refresh after writes. */
export interface CockpitArchive {
  /** Current documents by archive-relative path. */
  readonly docs: Map<string, Detail>;
  /** Full-text search over the documents. */
  search(
    query: string,
    category?: string,
    scope?: string,
    offset?: number,
  ): { hits: Hit[]; total: number };
  /** Changes whenever the documents change: the cockpit rebuilds its caches when it does. */
  version(): string;
  /** Re-reads the documents, so a sheet the cockpit just wrote is readable at once. */
  refresh(): Promise<void>;
}

/** The music bridge: search, library and play/stop. Playback happens on the host, never here. */
export interface CockpitMusic {
  /** Searches the library. Rejects when the music service is not ready. */
  search(query: string): Promise<MusicTrack[]>;
  /** Sends play or stop to the player. The result goes back to the agent as it is. */
  request(command: MusicCommand): Promise<unknown>;
  /** The whole library, used to name music cards again after a restart. */
  library(): Promise<MusicTrack[]>;
  /** Calls the listener at once and on every change. Returns the unsubscribe function. */
  subscribe?(listener: (state: MusicStateLike) => void): () => void;
}

/** What a campaign folder holds, as the cockpit needs it. Implemented by the host from campaign.yaml. */
export type CockpitKind =
  | "plot"
  | "session"
  | "npc"
  | "enemy"
  | "item"
  | "location"
  | "lore"
  | "pc"
  | "other";

export interface CockpitCategories {
  /** Kind of a campaign-relative document path. `other` for anything the cockpit does not link. */
  kindOf(relPath: string): CockpitKind;
  /** Folder where a new sheet of this kind goes (campaign-relative, no trailing slash), or null. */
  folderFor(kind: "npc" | "enemy" | "item" | "location"): string | null;
  /** Folder of the player characters (sheets and their sessions), or null. */
  playersFolder(): string | null;
}

/** A battle map the master can show on the battle screen, with the sheet that embeds it. */
export interface BattleMapOption {
  /** Campaign-relative image path. */
  ref: string;
  /** The file route the client reads the image from. */
  url: string;
  /** Campaign-relative path of the sheet that embeds the map. */
  sheet: string;
  title: string;
  cols?: number;
  rows?: number;
}

/** The battle screen of the live session: its map and the chips' cells. Implemented by the host. */
export interface CockpitBattle {
  /** Battle maps of the campaign, filtered by place (sheet title or path, case and accents ignored). */
  find(place?: string): Promise<BattleMapOption[]>;
  /** Shows a battle map on the battle screen of the active session. */
  setMap(map: { ref: string; cols?: number; rows?: number }): Promise<BattleView>;
  /** Moves one chip (combatant id) to a cell. */
  move(id: string, x: number, y: number): Promise<BattleView>;
  /** Condition and duration labels of the game system, in the campaign language. */
  rules?(): Promise<CombatRules>;
  /** HP and AC from the public stats of a campaign sheet; null without a sheet or an adapter. */
  vitals?(sheet: string): Promise<{ hp?: number; ac?: number } | null>;
}

export interface CockpitPorts {
  archive: CockpitArchive;
  categories: CockpitCategories;
  music: CockpitMusic;
  /** Battle screen of the live session. Without it the battle tools answer "not supported". */
  battle?: CockpitBattle;
  /** Maps and battlemaps of the campaign (reads the files under the campaign root). */
  listMaps(documents: Iterable<Detail>): Promise<MapAsset[]>;
  /** Images of the campaign, built from the same documents and maps. */
  listImages(
    documents: Iterable<Detail>,
    maps: MapAsset[],
  ): Promise<ImageAsset[]>;
  /** Plot map of the campaign, built from the documents of Plot. */
  buildPlotGraph(documents: Iterable<Detail>): PlotGraph;
}
