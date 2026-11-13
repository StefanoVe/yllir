export type ModuleId = 'music' | 'print' | 'encyclopedia';

export interface StatusResponse {
  ok: boolean;
  campaign: { name: string; slug: string; language: string };
  frameworkVersion: string;           // from <framework>/.claude-plugin/plugin.json
  modules: Record<ModuleId, boolean>;  // from campaign.yaml `modules:` (missing key = false)
  agent: { available: boolean; reason?: string }; // reason is plain language, in the campaign language
  git: { ok: boolean };
}

export interface DocSummary {
  path: string;          // campaign-relative, "/" separators
  title: string;         // first H1, else file name without extension
  category: string;      // structure folder it belongs to, "" when none
  masterOnly: boolean;   // whole document is master-only (seed, master-only categories, .campaign never listed)
  hasMasterBlock: boolean; // contains the reserved block
}
export interface DocsResponse { docs: DocSummary[] }

export interface Heading { level: number; text: string; id: string }
export interface DocBlock { kind: 'public' | 'master'; html: string } // html is sanitized
export interface DocResponse {
  path: string; title: string; masterOnly: boolean;
  headings: Heading[];
  blocks: DocBlock[];              // in view=public only public blocks, and none at all if masterOnly
  backlinks: { path: string; title: string }[];
}

export interface SearchHit { path: string; title: string; snippet: string; masterOnly: boolean }
export interface SearchResponse { query: string; hits: SearchHit[] }

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';
export interface ChangedFile { path: string; status: FileStatus; from?: string }
export interface ChangeGroup {
  id: string;                 // git commit sha
  at: string;                 // ISO time
  summary: string;            // plain language sentence, derived from the commit message; no hashes, no "commit"
  files: ChangedFile[];       // only canon files, never .campaign/
  chatMessageId?: string;     // the master's message whose agent turn made it
  undone: boolean;            // already reverted by a later undo group
  isUndo: boolean;            // this group is itself an undo
}
export interface ChangesResponse { groups: ChangeGroup[] } // newest first

export interface DiffLine { kind: 'add' | 'del' | 'ctx'; text: string }
export interface DiffHunk { header: string; lines: DiffLine[] }
export interface FileDiff { path: string; status: FileStatus; hunks: DiffHunk[] }
export interface DiffResponse { id: string; files: FileDiff[] }

export interface UndoResponse { ok: boolean; message: string; groupId?: string } // 409 when the tree has uncommitted changes or nothing to undo; message is plain language

export type TurnState = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export type StepKind = 'read' | 'search' | 'write' | 'skill' | 'image' | 'check' | 'save' | 'agent' | 'music' | 'open' | 'other';
export interface TurnStep { id: string; kind: StepKind; text: string; at: string; endedAt?: string; state: 'running' | 'done' | 'failed'; parentId?: string }

export interface ChatMessage {
  id: string; role: 'master' | 'agent'; text: string; at: string; turnId?: string;
  boardChanges?: Array<{ label: string; targetId?: string }>; // live thread: what the agent changed on the board, for the chat line
  steps?: TurnStep[];         // agent message: the steps of the turn that produced it, all with a final state
}
export interface Turn { id: string; messageId: string; state: TurnState; activity: string; startedAt: string; endedAt?: string; fromSha?: string; toSha?: string; error?: string;
  steps?: TurnStep[];         // live list of the steps of the turn, newest last, at most 60
}
export interface ChatResponse { messages: ChatMessage[]; turn: Turn | null }

// Model and thinking effort the master picks for one chat message; absent = the SDK / Claude Code default.
export type ChatModel = 'sonnet' | 'opus' | 'haiku';
export type ChatEffort = 'low' | 'medium' | 'high' | 'max';
export interface ChatChoice { model?: ChatModel; effort?: ChatEffort }

export interface ChecksResponse {
  // checkedLinks (optional, added later): total number of links that were checked

  brokenLinks: { from: string; to: string; text?: string }[];
  sketches: string[];                 // documents that are still sketches
  exclusions: string[];               // recorded audit exclusions, plain text
  checkedAt: string;
}

// SSE: GET /api/events. Each frame has an increasing `id:` and an `event:` name; data is JSON.
export type LiveEvent =
  | { event: 'hello'; data: { serverTime: string } }
  | { event: 'files'; data: { changed: string[]; removed: string[] } }  // canon files, debounced 150 ms
  | { event: 'changes'; data: Record<string, never> }                    // refetch /api/changes
  | { event: 'message'; data: ChatMessage }
  | { event: 'delta'; data: { messageId: string; text: string } }       // streamed agent text, appended
  | { event: 'turn'; data: Turn }
  | { event: 'open'; data: { path: string } }                           // the agent asks the screen to open a document
  | { event: 'status'; data: StatusResponse }
  | { event: 'live'; data: { revision: string } }
  | { event: 'music'; data: { tracks: MusicTrack[]; reason?: string } };

// ---------------------------------------------------------------------------
// Live session (phase 2). State files live in <campaign>/.campaign/state/live/.
// The log and the combat state are owned by the framework skills `session-log`
// and `combat-tracker`; the board is owned by the master-screen server.
// ---------------------------------------------------------------------------

export type LogKind = 'fact' | 'decision' | 'intention' | 'thread';

export interface LogEntry {
  id: string;                 // e.g. "e-0007", stable, never reused inside a session
  at: string;                 // ISO time
  kind: LogKind;              // fact: happened; decision: players chose; intention: players/NPCs plan; thread: open thread
  text: string;
  scene?: string;             // campaign-relative path of the scene document it belongs to
  subjects?: string[];        // subject ids mentioned
  resolved?: boolean;         // only for kind 'thread'
  by: 'master' | 'agent';
}

export interface LiveSession {
  id: string;                 // "2026-11-12" or "2026-11-12-2"
  title: string;
  startedAt: string;
  endedAt?: string;
  sessionRef?: string;        // campaign-relative path of the plot session main file, if any
}

export type Side = 'pc' | 'ally' | 'enemy';
export interface ConditionState { id: string; duration: string; rounds?: number; note?: string }
export interface Combatant {
  id: string;                 // "c-1"...
  name: string;
  side: Side;
  initiative: number | null;
  hp?: number; hpMax?: number; tempHp?: number; ac?: number;
  conditions: ConditionState[];
  resources: Record<string, number>;
  notes?: string;
  sheet?: string;             // campaign-relative path of the creature or character sheet
  hidden?: boolean;           // not yet revealed to the players (master view only matters here)
  defeated?: boolean;
}
export interface CombatState {
  active: boolean;
  round: number;              // 0 before the first turn
  turn: number;               // index into `order`
  order: string[];            // combatant ids in initiative order
  combatants: Combatant[];
  events: { at: string; text: string }[]; // short plain-language history, newest last, max 200
  revision: number;
}

export type CombatOp =
  | { op: 'start' }
  | { op: 'add'; name: string; side: Side; initiative?: number | null; hp?: number; hpMax?: number; ac?: number; sheet?: string; hidden?: boolean; resources?: Record<string, number>; notes?: string }
  | { op: 'remove'; id: string }
  | { op: 'initiative'; id: string; value: number }
  | { op: 'damage'; id: string; amount: number }
  | { op: 'heal'; id: string; amount: number }
  | { op: 'condition-add'; id: string; condition: string; duration?: string; rounds?: number; note?: string }
  | { op: 'condition-remove'; id: string; condition: string }
  | { op: 'resource'; id: string; resource: string; delta?: number; value?: number }
  | { op: 'note'; id: string; text: string }
  | { op: 'reveal'; id: string }
  | { op: 'next' }
  | { op: 'end' };

export type BoardCardKind = 'document' | 'image' | 'note';
export interface BoardCard { id: string; kind: BoardCardKind; ref?: string; text?: string; x: number; y: number; w: number; h: number; z: number; frame?: string;
  anchor?: string;            // heading anchor inside the document ref, when the card points to one section
  reason?: string;            // why the agent placed it, shown as a tooltip
  pinned?: boolean;           // the agent cannot remove it; only the master can
  by?: 'master' | 'agent';    // who placed it
}
export interface BoardFrame { id: string; title: string; x: number; y: number; w: number; h: number;
  color?: string;             // CSS colour of the frame border
}
export interface BoardArrow { id: string; from: string; to: string; label?: string } // card or frame ids
export interface Board { revision: number; cards: BoardCard[]; frames: BoardFrame[]; arrows: BoardArrow[];
  highlight?: string | null;  // id of a card or frame that is centred and marked; null or absent = none
}

// Scene bar of the live table: where the table is now. Free text is never canon.
export interface TableScene {
  place?: string;             // campaign-relative path of the place sheet
  moment?: string;            // short label of the moment, e.g. "arrival at the gate"
  summary?: string;           // one or two plain sentences
  party?: string[];           // player-character sheet paths present
  plotRef?: string;           // campaign-relative path of the plot session or scene
  plotAnchor?: string;        // heading anchor inside plotRef
  revision: number;
}

// One change the agent or the master makes to the board or the scene. Ops are applied in order.
export type BoardOp =
  | { op: 'place'; cards: Array<{ kind: 'document' | 'image' | 'note'; ref?: string; anchor?: string; text?: string;
                                   frame?: string; near?: string; pinned?: boolean; reason?: string }> } // near: card id, or "@N" = the N-th card of the same op
  | { op: 'frame'; title: string; color?: string; cards?: string[]; after?: string[]; before?: string[] }
  | { op: 'link'; links: Array<{ from: string; to: string; label?: string }> }
  | { op: 'move'; ids: string[]; frame: string | null }
  | { op: 'remove'; ids: string[] }          // pinned cards are refused unless by master
  | { op: 'highlight'; id: string | null }
  | { op: 'pin'; id: string; pinned: boolean }
  | { op: 'arrange' }
  | { op: 'clear'; keepPinned: true };

// One undo unit: the board and scene changes of one agent turn (or one master structural edit).
export interface BoardGroup { id: string; turnId?: string; by: 'agent' | 'master'; labels: string[]; targetIds: string[]; at: string; undone?: boolean }

// Battle view (server-owned, not canon, not undo): where the chips are on the battle map.
export interface BattleView {
  map?: { ref: string; cols?: number; rows?: number } | null;   // campaign-relative image path; grid when known
  positions: Record<string, { x: number; y: number }>;           // combatant id -> cell (or fraction 0..1 when no grid)
  revision: number;
}

// Tooltip of a combatant chip, built by the game-system adapter from the sheet's public text.
export interface CombatantStats {
  lines: Array<{ label: string; value: string }>;   // e.g. AC, HP, speed
  actions: Array<{ name: string; text: string }>;   // attacks and other actions
}

// A player character as listed for the initiative popup (name and sheet only, no stats).
export interface LivePlayer { name: string; ref: string }

export interface LiveSnapshot {
  session: LiveSession | null;           // null when no live session is open
  log: LogEntry[];
  combat: CombatState | null;
  board: Board;
  scene?: TableScene | null;             // null when no scene is set; optional so older snapshots still type-check
  battle?: BattleView | null;            // null when no battle is shown
  history?: BoardGroup[];                // undo groups, newest last, max 50
  revision: string;                      // changes whenever anything above changes
}

export interface PlotNode { id: string; kind: 'session' | 'scene'; title: string; path: string; session?: string; status?: string }
export interface PlotEdge { from: string; to: string; kind: 'depends' | 'order' } // 'depends' = declared depends_on; 'order' = only file order
export interface PlotResponse { nodes: PlotNode[]; edges: PlotEdge[] }
/** One sheet of the plot in navigator order (sessions, each followed by its scenes). Never a body. */
export interface PlotSheet { path: string; title: string; kind: 'session' | 'scene'; session?: string }
export interface PlotSheetsResponse { sheets: PlotSheet[] }

// SSE additions: { event: 'live'; data: { revision: string } } means "refetch GET /api/live".

// ---------------------------------------------------------------------------
// Music (phase 3). Tracks come from the `### Musica` / `### Music` sub-section
// of place and scene sheets (master-only block). Playback is in the browser.
// ---------------------------------------------------------------------------

export type MusicProvider = 'youtube' | 'external'; // 'external' = opens in a new tab, no in-app control

export interface MusicTrack {
  id: string;                  // stable: sha1 of `${docPath}|${url}` (first 12 hex)
  title: string;
  url: string;                 // https only
  mood: string;                // the text after the dash in the sheet, may be empty
  provider: MusicProvider;
  videoId?: string;            // for youtube
  docPath: string;             // campaign-relative path of the sheet that lists it
  docTitle: string;            // title of that sheet
  preferred?: boolean;         // the sheet marks it as the preferred one
}
export interface MusicResponse { enabled: boolean; tracks: MusicTrack[]; note?: string } // note: plain-language reason when the framework is too old

// ---------------------------------------------------------------------------
// Encyclopedia and print (phase 3, modules `encyclopedia` and `print`).
// Both are generated by framework skills (CLI JSON); the master screen only drives them.
// ---------------------------------------------------------------------------

export interface EncyclopediaCheck { id: string; status: 'pass' | 'fail' | 'skipped'; message: string }
export interface EncyclopediaReport {
  ok: boolean;
  entries: number;
  excluded: { path: string; reason: string }[];
  warnings: { code: string; path?: string; message: string }[];
  checks: EncyclopediaCheck[];     // the pre-publish checks; a `fail` means nothing was published/generated
  baseUrl: string;                 // QR and link base, from campaign.yaml encyclopedia.base_url
  generatedAt: string;
  previewUrl: string | null;       // '/enc/' when a build exists
}
export interface EncyclopediaStatus { enabled: boolean; built: boolean; report: EncyclopediaReport | null; publishing: 'not-configured' }

export type PrintState = 'to-print' | 'printed' | 'reprint';
export interface PrintCard { id: string; title: string; path: string; category: string; print: PrintState | null; hasImage: boolean; personal: boolean }
export interface PrintStatus { enabled: boolean; cards: PrintCard[]; renderer: 'photoshop' | 'node'; format: '5x7' | 'a4'; cmyk: boolean; baseUrl: string; encyclopediaEnabled: boolean }
export interface PrintSheetResult { ok: boolean; file: string | null; fileUrl: string | null; pages: number; excluded: { id: string; reason: string }[]; warnings: { code: string; message: string }[] }
