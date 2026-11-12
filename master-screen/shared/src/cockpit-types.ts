/**
 * Session cockpit — shared contract between server and Angular UI.
 *
 * The cockpit state is changed ONLY through `CockpitAction`s applied by the
 * pure reducer in `server/cockpit/actions.ts`. Agent tools and UI buttons both
 * produce actions; nothing else writes state. Campaign documents stay read-only.
 */

export type ProviderId = "claude";

/** A real archive document, optionally a heading anchor inside it. */
export interface SourceRef {
  path: string;
  anchor?: string;
}

// ───────────────────────────── Board ─────────────────────────────
//
// The board is a free canvas ("scrivania"): cards, frames and links laid out
// in canvas coordinates (px at zoom 1, origin top-left, y grows downward).

export type ModuleKind =
  | "npc"
  /** A player character sheet or session material in Players/. */
  | "pc"
  | "enemy"
  | "item"
  | "location"
  | "map"
  | "battlemap"
  | "music"
  | "plot"
  /** History, cosmology and shared concepts in Lore/. */
  | "lore"
  /** An image uploaded by the DM into the session folder. */
  | "image"
  | "note";

/** What a card points at. Only `note` may carry free text. */
export type ModuleRef =
  | { type: "doc"; path: string; anchor?: string }
  | { type: "asset"; path: string }
  /** `title` is saved when the card is placed: the track cache is lost on restart. */
  | { type: "track"; trackId: string; title?: string }
  /** `path` is a file name inside `Sessions/<id>/files/`. */
  | { type: "image"; path: string }
  | { type: "note"; text: string };

export type CardColor = "red" | "amber" | "green" | "blue" | "violet";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A card on the canvas. */
export interface BoardModule extends Rect {
  id: string;
  kind: ModuleKind;
  ref: ModuleRef;
  /** Frame that contains the card, if any. Moving the frame moves the card. */
  frameId?: string;
  color?: CardColor;
  /** Protects the card from removal by the agent and by `board.clear`. */
  pinned: boolean;
  /** One short line: why this is on the board. */
  reason: string;
  addedBy: "agent" | "dm";
  addedAt: string;
  updatedAt: string;
}

/** A titled area grouping cards, e.g. one scene of a session. */
export interface Frame extends Rect {
  id: string;
  title: string;
  color?: CardColor;
  addedBy: "agent" | "dm";
  addedAt: string;
  updatedAt: string;
}

/** An arrow between two cards and/or frames (ids of either). */
export interface Link {
  id: string;
  from: string;
  to: string;
  label?: string;
  addedBy: "agent" | "dm";
}

/** Display payload computed by server resolvers from the archive. Never written by the model. */
export interface ResolvedContent {
  title: string;
  subtitle?: string;
  summary?: string;
  /** `/api/asset?path=…` or session file URL. */
  image?: string;
  stats?: { label: string; value: string }[];
  source?: SourceRef;
  /** True when the referenced document/asset/track no longer exists. */
  missing?: boolean;
}

export interface BoardModuleView extends BoardModule {
  content: ResolvedContent;
}

export interface Board {
  modules: BoardModule[];
  frames: Frame[];
  links: Link[];
  /** The one card or frame the canvas should spotlight now, if any. */
  highlightId: string | null;
}

// ──────────────────────────── Position ───────────────────────────

export interface Position {
  /** Current Plot section, if known. */
  source?: SourceRef;
  location: string;
  moment: string;
  /** One or two lines: where the party is and what is going on. */
  summary: string;
}

// ───────────────────────────── Ledger ────────────────────────────

/**
 * fact      — something that happened at the table (declared by the DM)
 * decision  — something the players decided
 * intention — something the players plan / want to do
 * open      — unresolved question or thread
 */
export type LedgerKind = "fact" | "decision" | "intention" | "open";
export type LedgerStatus = "active" | "resolved" | "dropped";

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  status: LedgerStatus;
  title: string;
  text: string;
  /** IDs of DM chat messages this entry is based on (≥ 1). Fragments merge here. */
  evidence: string[];
  sources: SourceRef[];
  createdAt: string;
  updatedAt: string;
}

// ───────────────────────────── Combat ────────────────────────────

export interface Combatant {
  id: string;
  name: string;
  kind: "pc" | "enemy" | "ally";
  initiative: number | null;
  source?: SourceRef;
  hp?: number;
  maxHp?: number;
  tempHp?: number;
  phase?: string;
  conditions: string[];
  resources?: Record<string, number>;
}

export interface Combat {
  title: string;
  round: number;
  activeId: string | null;
  participants: Combatant[];
  notes: string;
}

// ───────────────────────────── State ─────────────────────────────

export interface CockpitState {
  position: Position;
  party: string[];
  board: Board;
  ledger: LedgerEntry[];
  combat: Combat | null;
}

export interface CockpitStateView extends Omit<CockpitState, "board"> {
  board: Omit<Board, "modules"> & { modules: BoardModuleView[] };
}

// ──────────────────────────── Actions ────────────────────────────

export type ModuleInput = {
  /** Omit to create; reuse to update. A `show` with the same kind+ref updates the existing card. */
  id?: string;
  kind: ModuleKind;
  ref: ModuleRef;
  pinned?: boolean;
  reason: string;
  /** Put the card inside this frame (server places it in the frame's grid). */
  frameId?: string;
  /** Place the card next to this card or frame id. Ignored when x/y are given. */
  near?: string;
  /** Explicit geometry (DM drops). Missing values come from the layout engine. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  color?: CardColor;
};

export type FrameInput = {
  title: string;
  color?: CardColor;
  /** Place the frame next to this card or frame id. Ignored when x/y are given. */
  near?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

/**
 * Geometry-only change from the canvas (drag, resize, drop into a frame).
 * Applied through `CockpitStore.layout`: persisted and broadcast, but it creates
 * NO undo group. `id` is a card or a frame; moving a frame moves its cards.
 * `frameId: null` takes a card out of its frame.
 */
export interface LayoutItem {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  frameId?: string | null;
}

export type LedgerInput = {
  kind: LedgerKind;
  title: string;
  text: string;
  evidence: string[];
  sources?: SourceRef[];
};

export type CockpitAction =
  | { type: "module.show"; module: ModuleInput }
  | { type: "module.remove"; id: string }
  | {
      type: "module.update";
      id: string;
      patch: {
        /** Only for note cards. */
        text?: string;
        reason?: string;
        color?: CardColor | null;
        frameId?: string | null;
      };
    }
  /** Spotlight one card or frame (null clears). */
  | { type: "module.highlight"; id: string | null }
  | { type: "module.pin"; id: string; pinned: boolean }
  | { type: "frame.add"; frame: FrameInput }
  | {
      type: "frame.update";
      id: string;
      patch: { title?: string; color?: CardColor | null };
    }
  /** `withCards`: also remove the frame's unpinned cards; otherwise they stay, unframed. */
  | { type: "frame.remove"; id: string; withCards: boolean }
  | { type: "link.add"; from: string; to: string; label?: string }
  | { type: "link.remove"; id: string }
  /** Re-run the automatic layout of the whole board (frames in link order, cards in grids). */
  | { type: "board.arrange" }
  /** Remove every unpinned card, every frame without pinned cards and dangling links. */
  | { type: "board.clear" }
  | { type: "position.set"; patch: Partial<Position> }
  | { type: "party.set"; names: string[] }
  | { type: "ledger.add"; entry: LedgerInput }
  | {
      type: "ledger.update";
      id: string;
      patch: Partial<
        Pick<LedgerEntry, "kind" | "status" | "title" | "text">
      > & {
        /** Appended (deduplicated) to existing evidence / sources. */
        addEvidence?: string[];
        addSources?: SourceRef[];
      };
    }
  | { type: "ledger.remove"; id: string }
  | {
      type: "combat.start";
      title: string;
      participants: Omit<Combatant, "id">[];
    }
  | { type: "combat.add"; participant: Omit<Combatant, "id"> }
  | {
      type: "combat.update";
      id: string;
      patch: Partial<Omit<Combatant, "id">>;
    }
  | { type: "combat.remove"; id: string }
  | { type: "combat.turn"; activeId: string | null; round?: number }
  | { type: "combat.notes"; notes: string }
  | { type: "combat.end" };

/** Compact, human-readable record of an applied action (chat chips, history). */
export interface ActionSummary {
  type: CockpitAction["type"];
  /** Short label, e.g. "Mostra · Kaelen". */
  label: string;
  /** Affected module / ledger entry / combatant id, when any. */
  targetId?: string;
}

/** A batch of actions applied together: one agent turn or one UI click. Undo works per group. */
export interface ActionGroup {
  id: string;
  at: string;
  origin: "agent" | "dm";
  turnId?: string;
  actions: ActionSummary[];
  undone: boolean;
}

// ───────────────────────────── Chat ──────────────────────────────

export interface ChatMessage {
  id: string;
  role: "dm" | "agent";
  text: string;
  at: string;
  turnId: string;
  status: "complete" | "streaming" | "error" | "cancelled";
  /** Agent messages: actions applied during the turn. */
  actions?: ActionSummary[];
}

export type TurnStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface TurnActivity {
  kind: "thinking" | "tool" | "writing";
  /** Tool name for kind=tool. */
  tool?: string;
  /** Short label, e.g. "Legge · Kaelen.md". */
  label?: string;
}

export interface Turn {
  id: string;
  /** The DM message that started the turn. */
  messageId: string;
  status: TurnStatus;
  activity?: TurnActivity;
  error?: string;
  startedAt?: string;
  endedAt?: string;
}

// ──────────────────────────── Session ────────────────────────────

export interface CockpitSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Incremented on every applied action group / undo. */
  revision: number;
  provider: ProviderId;
  model: string;
  /** Provider-side conversation id to resume (e.g. Claude Agent SDK session). */
  providerSessionId?: string;
  /** Id of the framework live session (session log and combat) this cockpit session is attached to. */
  liveSessionId?: string;
  state: CockpitState;
  messages: ChatMessage[];
  /** Recent turns only (last ~20); the active/queued ones are always present. */
  turns: Turn[];
  history: ActionGroup[];
}

export interface CockpitSessionView extends Omit<CockpitSession, "state"> {
  state: CockpitStateView;
}

export interface CockpitSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  location: string;
}

// ────────────────────────── Runtime ──────────────────────────────

export interface ProviderStatus {
  id: ProviderId;
  available: boolean;
  model: string;
  error?: string;
}

export interface RuntimeStatus {
  provider: ProviderId;
  model: string;
  providers: ProviderStatus[];
}

// ─────────────────────────── SSE events ──────────────────────────

/**
 * Sent on `GET /api/cockpit/sessions/:id/events`. Every event carries an SSE `id:`
 * (monotonic per session); reconnecting with `Last-Event-ID` replays missed events,
 * or a fresh `snapshot` when the buffer no longer covers the gap.
 */
export type CockpitEvent =
  | { type: "snapshot"; session: CockpitSessionView }
  | {
      type: "state";
      revision: number;
      state: CockpitStateView;
      history: ActionGroup[];
      /** Group that caused this state, when any (UI highlights affected ids). */
      group?: ActionGroup;
    }
  | { type: "message"; message: ChatMessage }
  | { type: "delta"; messageId: string; text: string }
  | { type: "turn"; turn: Turn }
  /** Explicit UI request from the agent: open a document/asset in the reader. */
  | { type: "open"; source: SourceRef }
  | { type: "deleted" };
