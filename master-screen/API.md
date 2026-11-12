# Master screen: contract between server and client

Single source of truth for the HTTP API and the shared types. Server and client both follow this file; `shared/src/types.ts` is its TypeScript form. Everything here is in English; UI strings shown to the master are in the campaign language (see "UI language").

## Process model

- One Node.js process per campaign: `node server.mjs --campaign <abs path> --framework <abs path to the yllir plugin root> [--port N] [--open]`.
- Binds `127.0.0.1` only. Port: `--port`, else first free port from 4317 up. Once listening it prints exactly one line to stdout: `{"ready":true,"url":"http://127.0.0.1:4317","pid":123}`.
- Rejects any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`, and any state-changing request whose `Origin` is present and different. Sends a strict CSP (`default-src 'self'`, no inline scripts).
- Serves the built client from `<server.mjs dir>/public` for every non-`/api` path (SPA fallback to `index.html`).
- With `--exit-when-closed` (passed by the launcher) it exits 60 s after the last `/api/events` client disconnected, but only once at least one client has connected before; a client reconnecting inside the 60 s cancels the exit.
- Exits cleanly (closing watcher, agent turn, SSE streams) on SIGINT/SIGTERM and when `POST /api/shutdown` is called. A lock file `.campaign/state/master-screen/server.json` (`{pid,port,url}`) is written at start and removed at exit; a stale lock (dead pid) is ignored.
- Reads the campaign only through the framework: `node <framework>/scripts/engine.mjs <command> <campaign> ...` (JSON on stdout, last line `exit: <code>`) and the framework library modules loaded at run time by dynamic `import(<framework>/scripts/lib/<file>.mjs)` (for example `public-text.mjs`, `frontmatter.mjs`, `config.mjs`). Nothing from `<framework>/scripts` is copied into this project. All campaign writes go through `engine.mjs commit` (done by the agent, never by the HTTP API, except undo).
- Operational state lives in `<campaign>/.campaign/state/master-screen/` (chat.json). Never inside canon folders.

## Types (`shared/src/types.ts`)

```ts
export type ModuleId = 'music' | 'print' | 'encyclopedia';

export interface StatusResponse {
  ok: boolean;
  campaign: { name: string; slug: string; language: string };
  frameworkVersion: string;           // from <framework>/.claude-plugin/plugin.json
  modules: Record<ModuleId, boolean>;  // from campaign.yaml `modules:` (missing key = false). Combat is a library function, not a module, so it has no flag
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
export interface TurnStep { id: string; kind: StepKind; text: string; at: string; endedAt?: string; state: 'running' | 'done' | 'failed'; parentId?: string } // text: plain-language sentence, campaign language; parentId: the sub-agent tool use it runs under
export interface ChatMessage { id: string; role: 'master' | 'agent'; text: string; at: string; turnId?: string; steps?: TurnStep[] } // agent message: steps of its turn, all with a final state; absent in files written before steps
export interface Turn { id: string; messageId: string; state: TurnState; activity: string; startedAt: string; endedAt?: string; fromSha?: string; toSha?: string; error?: string; steps?: TurnStep[] } // steps: live list, newest last, at most 60
export interface ChatResponse { messages: ChatMessage[]; turn: Turn | null }

export interface ChecksResponse {
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
  | { event: 'status'; data: StatusResponse };
```

## Endpoints

All under `/api`, JSON, UTF-8. Errors: `{ "error": "<plain-language message>" }` with a 4xx/5xx status. Never expose stack traces, file-system paths outside the campaign, or words like commit/sha/index/frontmatter in `error`, `summary`, `message` or `activity` strings.

| Method and path | Request | Response |
|---|---|---|
| GET `/status` | | `StatusResponse` |
| GET `/docs` | | `DocsResponse` |
| GET `/docs/read` | `?path=<rel>&view=master\|public` (default `master`) | `DocResponse`; 404 for a path outside the campaign, inside `.campaign/` or not Markdown |
| GET `/search` | `?q=<text>&view=` | `SearchResponse`, max 30 hits. Whole words and prefixes, case and accent insensitive (use the framework's `fold.mjs`). `view=public` searches only public text. |
| GET `/changes` | `?limit=30` | `ChangesResponse` |
| GET `/changes/:id/diff` | | `DiffResponse` |
| POST `/changes/undo` | `{ id?: string }` (default: newest group that is not undone and not an undo) | `UndoResponse` |
| GET `/chat` | | `ChatResponse` |
| POST `/chat/messages` | `{ text: string (1..8000), model?: 'sonnet'\|'opus'\|'haiku', effort?: 'low'\|'medium'\|'high'\|'max' }`; `model`/`effort` absent = SDK default; invalid value = 400 | 202 `{ messageId, turnId }`; queued when a turn is running |
| POST `/chat/turns/:id/cancel` | | `{ ok: true }` |
| GET `/checks` | | `ChecksResponse` (last result, or computed once) |
| POST `/checks/run` | | `ChecksResponse` (recomputed with `engine.mjs index` then `query errors` and `query sketches`) |
| GET `/events` | `Last-Event-ID` header | SSE, 15 s heartbeat comment, ring buffer of 500 events for replay |
| POST `/shutdown` | | `{ ok: true }`, then the process exits |

## Undo semantics

A change group is a git commit made by the engine. Undo of group G runs `git revert --no-edit G` on the campaign (adds one commit, never rewrites history), refuses with 409 when the working tree has uncommitted changes in canon files, and then publishes `changes` and `files`. The undo commit's message starts with `Undo: ` so `isUndo` is derivable. Turns store `fromSha` (HEAD when the turn started) and `toSha` (HEAD when it ended); a group belongs to the message of the turn whose range contains it.

## Agent (turn) rules

- One turn at a time per campaign, FIFO queue; idle timeout 120 s, hard limit 10 min; cancellable. While a step of kind `image` is running the limits are 480 s idle and 20 min hard (`IMAGE_IDLE_TIMEOUT_MS`, `IMAGE_HARD_LIMIT_MS` in `server/src/chat/turns.ts`); the hard limit is extended once, when an image is still being made at 10 min.
- Steps: every tool use of the agent starts a step (`TurnStep`, kind from `StepKind`) and its tool result ends it (`done`, or `failed` on an error result). Steps of a sub-agent carry `parentId`. A step text is a plain sentence that never carries a path, a tool name or a technical word; a document title may be quoted in it («…» or “…”, at most 60 characters). Image steps name no image service. A turn that ends closes its running steps as `done`, and its agent message keeps them in `steps`.
- Provider interface (`server/src/agent/provider.ts`): `run(input: { prompt, cwd, frameworkRoot, resumeId?, model?: ChatModel, effort?: ChatEffort, signal }): AsyncIterable<AgentEvent>` (`ChatModel`/`ChatEffort` in `shared/src/types.ts`; the real provider passes them to the SDK options `model` and `effort` when set) where `AgentEvent` is `{type:'activity',text}|{type:'step',id,kind,text,parentId?}|{type:'step-end',id,ok}|{type:'delta',text}|{type:'open',path}|{type:'resume',id}|{type:'done'}|{type:'error',message}`. A fake provider for tests lives next to it.
- The real provider uses `@anthropic-ai/claude-agent-sdk`, bundled into `server.mjs`, with `pathToClaudeCodeExecutable` set to the Claude Code the master already has installed (looked up on PATH with `which`/`where`, then the usual install locations); when none is found `agent.available` is false with a plain reason. It runs with the Yllir plugin loaded from `frameworkRoot`, `cwd` = campaign root. No free shell: a `canUseTool` gate allows only (a) Read, Glob, Grep, Skill; (a2) Task and Agent (the framework's own sub-agents; their tool calls pass through this same gate); Read, Glob and Grep only inside the campaign and the framework folders; (b) Write and Edit only on paths under `<campaign>/.campaign/drafts/`; (c) Bash only for the single command shape `node <frameworkRoot>/scripts/<script>.mjs <args>` or `node <frameworkRoot>/skills/**/scripts/<script>.mjs <args>` with no shell metacharacters (`;|&><$` backtick, newline, `..`) in the line, and `git` is never allowed; (d) the in-process MCP tools `search_docs`, `open_document` and `suggest_music`; (e) the tools of the Yllir plugins named `mcp__plugin_yllir_<plugin>__<tool>` (the Photoshop plugin, used for images), except any tool whose name contains `execute_script` or `install_font`. Everything else is denied with a plain reason. It also receives the master's message verbatim as the prompt, prefixed by nothing, so the entry skill handles it exactly as in the terminal.
- The master-only block is visible to the agent (it works on canon) and is never sent anywhere else by this server.
- Live-table turns (the live thread) also get: (a) the live digest (scene, board, log, combat) as a per-turn system prompt append; the prompt stays the master's verbatim text; (b) the in-process MCP server `yllir_live`, registered only for live-thread turns and allowed by the gate only there, with the tools `get_table`, `board_stage`, `board_place`, `board_frame`, `board_link`, `board_move`, `board_remove`, `board_highlight`, `board_pin`, `board_arrange`, `scene_set`, `log_add`, `log_update`, `log_remove`, `combat_op`, `battle_map_set`, `battle_move`, `find_battle_map`; (c) one thread per live session with its own resume id. The FIFO queue is shared with the home chat.

## Client rules

- Angular standalone components, signals, lazy routes. Routes: `/` (chat + changes), `/doc/:path*` (reader), `/search`, `/settings`.
- One `EventSource` on `/api/events`, reconnecting with backoff. It stays open while the tab is hidden (the server uses the open stream to know the screen is still there).
- Icons only in the navigation (Lucide), each with a tooltip and an `aria-label`; no text labels next to icons. Page content may contain text.
- Words shown to the master: document, scene, sheet, session, character. Never: commit, index, canon, frontmatter, token, provider, sha.
- No optimistic updates: what is on screen is what the server confirmed.
- Preferences (theme, text size, recent and favourite documents) in `localStorage`, keys prefixed `yllir:<campaign slug>:`. Wrap every access in try/catch.
- Modern, calm, readable: CSS custom properties for tokens, light and dark theme following the system with a manual override, `prefers-reduced-motion` respected, visible focus rings, keyboard shortcut Ctrl/Cmd+K for search, layout works from 360 px width.
- UI language: the campaign language from `/api/status` (`it` or `en` at least); strings live in one `i18n` file per language, no hard-coded copy in templates.

## Live session (phase 2)

State lives in `<campaign>/.campaign/state/live/`, never in canon, never in git history of canon (it is under `.campaign/`). The log and the combat state are owned by the framework skills `session-log` and `combat-tracker` (so the terminal and the Claude app can use them with no master screen); the server only calls their library modules through `loadFrameworkModule`-style dynamic import and never re-implements their rules. The board (free canvas), the scene bar and the battle view are owned by the server alone; undo covers the board and the scene only (see "Undo of the live table").

Files: `live/active.json` (`{ "sessionId": "<id>" | null }`), `live/<sessionId>/session.json` (LiveSession), `live/<sessionId>/log.json` (LogEntry[]), `live/<sessionId>/combat.json` (CombatState), `live/<sessionId>/board.json` (Board), `scene.json` (TableScene), `battle.json` (BattleView), `history.json` (BoardGroup[] plus the board and scene snapshots for undo, max 50), `chat.json` (the live chat thread: messages and resume id). All written atomically (temp + rename), mode 0600, UTF-8, pretty JSON.

Framework library contract (ESM, in `yllir/skills/library/<skill>/scripts/lib/`). Every function is synchronous except `applyOp` (combat-store, async because its rules file is loaded with a dynamic import; callers must await it). Every function takes the campaign root first, never throws for bad input and returns `{ ok: true, ... }` or `{ ok: false, error: { code: string, message: string } }` (message in English, plain):
- `session-log/scripts/lib/log-store.mjs`: `openSession(root, { title?, sessionRef?, now? })` (fails with code `already-open` when one is active; id is the date, `-2`, `-3` for more the same day) -> `{ session }`; `getActive(root)` -> `{ session | null }`; `addEntry(root, { kind, text, scene?, subjects?, by? , now? })` -> `{ entry }`; `updateEntry(root, id, patch)` (patch: text, kind, scene, subjects, resolved) -> `{ entry }`; `removeEntry(root, id)`; `listEntries(root)` -> `{ entries }`; `endSession(root, { now? })` -> `{ session }` (keeps files; clears active.json); `readSession(root, sessionId)` -> `{ session, entries }`.
- `combat-tracker/scripts/lib/combat-store.mjs`: `getCombat(root)` -> `{ combat | null }` (for the active session); `async applyOp(root, op, { now? })` (returns a Promise) where op is the `CombatOp` union of `shared/src/types.ts` -> `{ combat }`. It loads the adapter named in campaign.yaml `system.adapter` and delegates every rule to `<framework>/modules/systems/<id>/encounter.mjs` (exports `initEncounter(adapter)`, `recordEvent(adapter, state, op)`, `advanceTurn(adapter, state)`, `validateState(adapter, state)`, each pure on plain objects). A validator runs before every save; an invalid result is not saved.
- CLIs, one JSON document on stdout and a last line `exit: <code>` (0 ok, 1 domain error, 2 usage): `node <framework>/skills/library/session-log/scripts/session-log.mjs <open|add|update|remove|list|end|status> <root> [options]` and `node <framework>/skills/library/combat-tracker/scripts/combat.mjs <op> <root> [options]` (op names as in `CombatOp`, plus `status`).

Server endpoints (all under `/api`):

| Method and path | Request | Response |
|---|---|---|
| GET `/live` | | `LiveSnapshot` |
| POST `/live/open` | `{ title?: string, sessionRef?: string }` | `LiveSnapshot` (409 plain message if already open) |
| POST `/live/end` | | `LiveSnapshot` (session null) |
| POST `/live/log` | `{ kind, text, scene?, subjects? }` | `LiveSnapshot` |
| PATCH `/live/log/:id` | `{ text?, kind?, scene?, subjects?, resolved? }` | `LiveSnapshot` |
| DELETE `/live/log/:id` | | `LiveSnapshot` |
| POST `/live/combat` | `CombatOp` | `LiveSnapshot` (409 plain message when the rule engine refuses) |
| PUT `/live/board` | `Board` (full replacement, `revision` must equal the stored one else 409 with the current board in `{ error, board }`) | `{ board }` |
| GET `/plot` | | `PlotResponse` built from the framework `plot/plot-map.mjs` |
| POST `/live/board/ops` | `{ ops: BoardOp[] }` (1..20, master structural edits) | `LiveSnapshot` |
| PUT `/live/board/layout` | `{ items: [{id,x,y,w,h}] }` (1..300, geometry only, no undo group) | `{ board }` |
| POST `/live/undo` | `{ groupId }`, must be the latest not-undone group | `LiveSnapshot` (409 otherwise) |
| PUT `/live/battle` | `{ positions?, map? }` | `LiveSnapshot` |
| GET `/live/combat/stats/:id` | | `CombatantStats` (404 when unknown) |
| GET `/live/players` | | `{ players: LivePlayer[] }` from the player-character category |
| GET `/live/chat` | | `{ messages: ChatMessage[], turn }` of the live thread |
| POST `/live/chat` | `{ text, scope?: 'table' \| 'combat' }` | `{ turnId }` |
| POST `/live/chat/cancel` | | `{}` |

The server publishes SSE `live` `{ revision }` after every write through the API and also when anything under `.campaign/state/live/` changes on disk (written by the agent or the terminal): a second chokidar watcher, debounced 150 ms. `revision` is a hash of the mtimes and sizes of every file under the live folder, the new files included. The client refetches `/api/live` on `live`. Live-table chat uses the existing chat events with `thread: 'live'`. The existing `PUT /live/board` stays for compatibility.

Rules: log entries are not canon and never touch sheets during the session; the log and combat tools are available to the in-app agent through the framework scripts (the Bash gate already allows `skills/**/scripts/*.mjs`); a combat starts when a `start` op succeeds and the combat panel opens by itself when `combat.active` turns true; the master-only block is never put into `LiveSnapshot` (cards reference documents by path, the reader decides what to show); board validation: at most 300 cards, coordinates within +-20000, `ref` must be a campaign-relative path without `..`.

### Board ops (agent and master structural edits)

`POST /live/board/ops` applies a list of `BoardOp` (1..20) in order, read-modify-write inside the serialize queue. Master drags and resizes use `PUT /live/board/layout` and never create an undo group.

- `place`: every `ref` must exist as a campaign document or image. `near` is a card id, or `@N` = the N-th card of the same op.
- `remove`: pinned cards are refused when the op comes from the agent; only the master removes them.
- `clear`: keeps the pinned cards (`keepPinned: true`, the only value).
- `arrange`: runs automatically at the end of an agent turn, after the structural ops.

### Undo of the live table

- Undo covers the board and the scene only. `POST /live/undo` `{ groupId }` undoes the latest group that is not undone; any other group gets 409.
- One agent turn that changes the board or the scene is one `BoardGroup`; every board and scene tool call of that turn joins that group.
- `history.json` keeps the board and scene snapshots of each group, max 50 groups.
- Log and combat are not undone by the button: the master corrects them by talking to the agent.

### Free text in the snapshot

Free text the agent writes into the snapshot (log text, card `reason`, scene `summary`, combat notes) must never copy text from the master-only block of any sheet. The agent writes its own short words; it may quote only public text.

### Combat overlay

- Full state (hp, conditions, resources) only for NPCs and creatures. Player characters have name, initiative and position only; the server never reads a player sheet beyond its title.
- Every document card of a character or creature on the board has a swords button, which opens the full-screen combat overlay.
  - Step 1, initiative popup: player characters come from `GET /live/players`; creatures are the card's own, plus any other character or creature card the master ticks.
  - Step 2, battle view: the battle map when one is set and the preference "show battle maps" is on (localStorage `showBattleMaps`, default on); otherwise a list. A chip for each combatant, draggable inside the map (`PUT /live/battle`). Hovering a chip shows the stats from `GET /live/combat/stats/:id`.
  - A floating chat on the right, scope `combat`; the agent applies the words with the combat tools.
- The stats tooltip is built from the sheet with its master-only block removed, before the adapter sees it.
- Place sheets link their battle map; the agent finds it with `find_battle_map`.

### Player-character category

The player characters are the documents of the category in `campaign.yaml` `structure.categories` whose id is `players`, `giocatori`, `pg` or `pc`; otherwise the first `master-only` category whose documents use the player-character format (format 4.13 in `templates/content-format.md`). `GET /live/players` lists their titles and refs.

Client (phase 2): route `/live` (the table: free canvas in the centre, an icon dock on the right with log, combat, quick look-up), route `/plot` (plot map: nodes for sessions and scenes, solid arrows for declared dependencies, dashed lines for mere file order, with a legend). The combat panel opens by itself when a combat starts. The canvas supports document, image and note cards, scene frames and arrows, drag and resize, pan and zoom; layout saves without entering undo. All of it follows the "Client rules" above (icons with tooltips, no jargon, no optimistic updates: the board position shown after a drop is the one the server confirmed, but dragging itself is local and smooth).

## Music (phase 3)

Module `music` of campaign.yaml (`modules.music: true`). When it is off: no `/api/music` data (`enabled:false`, empty list), no rail icon, and the CSP does not allow any third-party host.

- Tracks come from the sub-section `### Musica` (it) / `### Music` (en) inside the MASTER-ONLY block of any sheet, as list items `- [<title>](<https url>) — <mood>` (format written by the `music-search` skill: see `yllir/skills/library/music-search/scripts/lib/links.mjs`, reuse its parser, do not re-implement the format; a `Preferita:`/`Preferred:` mood prefix marks the preferred one). Never lists links from the public part. Links that are not https are dropped.
- `GET /api/music/tracks?q=&doc=` -> `MusicResponse`. `q`: whole words and prefixes, folded, over title + mood + sheet title + sheet path (so "porto nebbia" finds tracks of the port sheet with a foggy mood); `doc`: only the tracks of that sheet. No `q` and no `doc`: all, preferred first, sorted by sheet title then title. Max 200.
- SSE `music` `{tracks, reason?}`: the agent suggests music by SHOWING it; nothing plays by itself. Published by the in-process agent tool `suggest_music` (input `{query?: string, doc?: string, reason?: string}`; the server resolves it with the same search and publishes at most 5 tracks; an empty result publishes nothing and the tool says so).
- CSP: when music is on, add exactly `frame-src https://www.youtube-nocookie.com` and `script-src 'self' https://www.youtube.com` (the IFrame API loader) and `img-src` for `https://i.ytimg.com`; nothing else. Master text is never sent anywhere: the browser only loads the video id.
- Client: a persistent mini player in the shell (survives route changes), a library page `/music` (search, by sheet, preferred first), suggestion chips when a `music` event arrives (click = play, never auto-play), controls: play/pause, volume, loop, fade out (and fade in on start), next/previous within the list; YouTube through the IFrame API (`youtube-nocookie.com`, `origin` set, `enablejsapi=1`, controls hidden, one hidden player instance reused); other hosts show an 'Open' button that opens the link in a new tab (`rel=noopener`). Player state shown is what the player reported (no optimistic state). Volume and loop preference saved per campaign in localStorage. Works with the tab in the background.

## Encyclopedia and print (modules `encyclopedia` and `print`)

Decided by the author (2026-11-12): option A (a section of the master screen generates the static site); hosting is LOCAL ONLY for now (no publication, no credentials: `publishing` is always `not-configured`); entries cover objects, places and characters (public part only; fully master-only categories and the seed never appear, title included); locked texts open with a code, checked in the browser; cards are made with the Photoshop MCP when it is available and otherwise with a Node renderer.

Generated output goes to `<campaign>/.campaign/cache/encyclopedia/` and `<campaign>/.campaign/cache/print/` (git-ignored, always regenerable, never canon).

campaign.yaml (validated by the framework `config.mjs`): `modules.encyclopedia`, `modules.print` (existing booleans) plus two optional top-level mappings: `encyclopedia: { title?: string, base_url?: string(http/https URL, no query, no fragment, trailing slash optional) }` and `print: { format?: "5x7"|"a4", cmyk?: boolean, renderer?: "auto"|"photoshop"|"node" }` (defaults: format 5x7, cmyk false, renderer auto). `encyclopedia.base_url` defaults to `http://localhost/` and is what QR codes point to.

Stable addresses: an entry lives at `<base_url>/e/<id>/` where `<id>` is the sheet's metadata id (never the file name). Ids listed in a sheet's `merged_ids` redirect to the surviving entry; ids in the retired-ids registry show a plain "no longer available" page.

Framework CLIs (JSON on stdout and a final `exit: <code>` line, 0 ok, 1 domain error, 2 usage; all fail closed):
- `node <fw>/skills/library/encyclopedia/scripts/encyclopedia.mjs <build|status> <root>`: `build` generates the whole site into a temp folder and swaps it atomically into `.campaign/cache/encyclopedia/` only when every pre-publish check passes; stdout is an `EncyclopediaReport`. `status` prints `{ built, report|null }` from the saved `report.json`.
- `node <fw>/skills/library/print/scripts/print.mjs <list|state|render-card|sheets> <root> [options]`: `list` -> `{ cards: PrintCard[], renderer, format, cmyk, baseUrl }`; `state --id <id> --state to-print|printed|reprint` changes the sheet's `print` metadata THROUGH the engine write cycle (draft + `engine.mjs commit`), never by direct write; `render-card --id <id> [--renderer auto|photoshop|node]` writes `img/<base>.png` in the category's img folder; `sheets [--ids a,b] [--format 5x7|a4] [--copies <id>=<n>,...] [--cmyk true|false]` writes `.campaign/cache/print/sheets-<timestamp>.pdf` (front pages and QR backs) and prints a `PrintSheetResult` with `file` relative to the campaign.

Server endpoints (under `/api`; both modules answer `{enabled:false,...}` with no work when off):

| Method and path | Request | Response |
|---|---|---|
| GET `/encyclopedia` | | `EncyclopediaStatus` |
| POST `/encyclopedia/build` | | `EncyclopediaReport` (409 plain message when a check fails; body still carries the report) |
| GET `/enc/*` | | the built static site, same origin, read-only, `Content-Security-Policy: sandbox allow-scripts allow-same-origin`-free: serve with the site's own strict CSP (`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:`) |
| GET `/print` | | `PrintStatus` |
| POST `/print/state` | `{ id, state: PrintState }` | `PrintStatus` |
| POST `/print/render` | `{ id, renderer? }` | `PrintStatus` |
| POST `/print/sheets` | `{ ids?: string[], format?, copies?: Record<string,number>, cmyk? }` | `PrintSheetResult` |
| GET `/print/files/:name` | | the generated PDF (name validated `^sheets-[0-9TZ-]+\.pdf$`, `Content-Disposition: inline`) |

The server only runs the CLIs through `execFile` (never a shell), one build or sheet job at a time (409 plain message if busy), a 120 s timeout, and publishes SSE `files` when canon files change as it already does. Client: route `/encyclopedia` (build button, report with the checks as plain sentences, an Open-preview link and an embedded preview, base address shown with a hint that it can be changed in the campaign settings through the assistant, and a calm note that publishing is not configured) and route `/print` (card list with a state chip per card using icon + text, select all/none, personal-card copies per character, generate-sheets button, PDF link opening inline, per-card render button); rail icons only when the module is on.
