# Master screen: contract between server and client

Single source of truth for the HTTP API and the shared types. Server and client both follow this file; `shared/src/types.ts` is its TypeScript form. Everything here is in English; UI strings shown to the master are in the campaign language (see "UI language").

## Process model

- One Node.js process per campaign: `node server.mjs --campaign <abs path> --framework <abs path to the yllir plugin root> [--port N] [--open]`.
- Binds `127.0.0.1` only. Port: `--port`, else first free port from 4317 up. Once listening it prints exactly one line to stdout: `{"ready":true,"url":"http://127.0.0.1:4317","pid":123}`.
- Rejects any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`, and any state-changing request whose `Origin` is present and different. Sends a strict CSP (`default-src 'self'`, no inline scripts).
- Serves the built client from `<server.mjs dir>/public` for every non-`/api` path (SPA fallback to `index.html`).
- With `--exit-when-closed` (passed by the launcher) it exits 60 s after the last `/api/events` client disconnected, but only once at least one client has connected before; a client reconnecting inside the 60 s cancels the exit.
- Exits cleanly (closing watcher, agent turn, SSE streams) on SIGINT/SIGTERM and when `POST /api/shutdown` is called. A lock file `.campaign/state/master-screen/server.json` (`{pid,port,url}`) is written at start and removed at exit; a stale lock (dead pid) is ignored.
- Reads the campaign only through the framework: `node <framework>/scripts/engine.mjs <command> <campaign> ...` (JSON on stdout, last line `exit: <code>`) and the framework library modules loaded at run time by dynamic `import(<framework>/scripts/lib/<file>.mjs)` (for example `public-text.mjs`, `frontmatter.mjs`, `config.mjs`). Nothing from `<framework>/scripts` is copied into this project. All campaign writes go through `engine.mjs commit` (done by the agent, or by a sheet tool of the live table; never by an HTTP route, except undo).
- Operational state lives in `<campaign>/.campaign/state/master-screen/`: `chats/<id>.json` (one file per conversation) and `turns.json`. Never inside canon folders.

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
export interface Turn { id: string; messageId: string; state: TurnState; activity: string; startedAt: string; endedAt?: string; fromSha?: string; toSha?: string; error?: string; steps?: TurnStep[]; conversationId?: string } // steps: live list, newest last, at most 60; conversationId absent in data written before conversations
/** One conversation of the master: its own agent session, so its own fresh context. */
export interface Conversation { id: string; title: string; createdAt: string; updatedAt: string; messageCount: number } // title: '' until the first master message; the client shows a default name
export interface ConversationsResponse { conversations: Conversation[]; currentId: string; turn: Turn | null } // newest updatedAt first; turn = the queued or running turn of the whole campaign, whatever its conversation
export interface ChatResponse { conversationId: string; messages: ChatMessage[]; turn: Turn | null } // turn only when it belongs to this conversation

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
  | { event: 'conversations'; data: Record<string, never> }              // refetch /api/chats
  | { event: 'message'; data: ChatMessage & { conversationId: string } }
  | { event: 'delta'; data: { messageId: string; text: string; conversationId: string } }  // streamed agent text, appended
  | { event: 'turn'; data: Turn }
  | { event: 'open'; data: { path: string } }                           // the agent asks the screen to open a document
  | { event: 'status'; data: StatusResponse };
```

Live table types: `shared/src/cockpit-types.ts` (session view, board, events, actions) and `shared/src/types.ts` (`CombatState`, `BattleView`, `CombatantStats`, `LivePlayer`, `LogEntry`).

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
| GET `/chats` | | `ConversationsResponse`. Creates the first conversation when none exists |
| POST `/chats` | | 201 `Conversation`; publishes SSE `conversations` |
| DELETE `/chats/:id` | | `{ ok: true }`; 404 for an unknown id. Cancels the running turn of that conversation and drops its queued turns; the change groups already made stay in the canon. If it was the last conversation a fresh empty one is created. Publishes SSE `conversations` |
| GET `/chat` | `?conversationId=` (absent = most recently updated conversation) | `ChatResponse`; 404 for an unknown id |
| POST `/chat/messages` | `{ text: string (1..8000), model?: 'sonnet'\|'opus'\|'haiku', effort?: 'low'\|'medium'\|'high'\|'max', conversationId?: string (absent = most recently updated conversation) }`; `model`/`effort` absent = SDK default; invalid value = 400; unknown `conversationId` = 404 | 202 `{ messageId, turnId }`; queued when a turn is running |
| POST `/chat/turns/:id/cancel` | | `{ ok: true }` |
| GET `/checks` | | `ChecksResponse` (last result, or computed once) |
| POST `/checks/run` | | `ChecksResponse` (recomputed with `engine.mjs index` then `query errors` and `query sketches`) |
| GET `/plot` | | `PlotResponse` (nodes and edges of the plot map, paths and statuses only, never a body); 503 when the framework has no plot module, 500 on a failed build |
| GET `/plot/sheets` | | `PlotSheetsResponse`: the plot sheets in navigator order (each session, then its scenes), `path`, `title`, `kind`, `session`; same 503/500 as `/plot` |
| GET `/events` | `Last-Event-ID` header | SSE, 15 s heartbeat comment, ring buffer of 500 events for replay |
| POST `/shutdown` | | `{ ok: true }`, then the process exits |

## Conversations

- The master can have many conversations. Each one is its own agent session, so it has its own fresh context; the `resume` id of its session is stored per conversation (`resumeId` in `chats/<id>.json`). At most 500 messages are kept per conversation.
- The turn queue stays ONE per campaign: FIFO, across all conversations. The canon is shared, so turns must not overlap. A turn queued behind a turn of another conversation shows as `queued` (`Turn.state`), with its `conversationId`.
- SSE `message`, `delta` and `turn` carry `conversationId`, so the screen can show them only in the conversation they belong to. SSE `conversations` means: refetch `GET /api/chats`.
- The title of a conversation is taken from the first master message: whitespace collapsed, cut to 60 characters with "…" when cut. Until then it is `''`.
- Deleting a conversation never undoes canon changes; they stay in "what changed".
- The former single chat (`chat.json`) is converted once into one conversation when the store first loads; the old file is then kept as `chat.json.migrated`.

## Undo semantics

A change group is a git commit made by the engine. Undo of group G runs `git revert --no-edit G` on the campaign (adds one commit, never rewrites history), refuses with 409 when the working tree has uncommitted changes in canon files, and then publishes `changes` and `files`. The undo commit's message starts with `Undo: ` so `isUndo` is derivable. Turns store `fromSha` (HEAD when the turn started) and `toSha` (HEAD when it ended); a group belongs to the message of the turn whose range contains it.

## Agent (turn) rules

- One turn at a time per campaign, FIFO queue; idle timeout 120 s, hard limit 10 min; cancellable. While a step of kind `image` is running the limits are 480 s idle and 20 min hard (`IMAGE_IDLE_TIMEOUT_MS`, `IMAGE_HARD_LIMIT_MS` in `server/src/chat/turns.ts`); the hard limit is extended once, when an image is still being made at 10 min.
- Steps: every tool use of the agent starts a step (`TurnStep`, kind from `StepKind`) and its tool result ends it (`done`, or `failed` on an error result). Steps of a sub-agent carry `parentId`. A step text is a plain sentence that never carries a path, a tool name or a technical word; a document title may be quoted in it («…» or “…”, at most 60 characters). Image steps name no image service. A turn that ends closes its running steps as `done`, and its agent message keeps them in `steps`.
- Provider interface (`server/src/agent/provider.ts`): `run(input: { prompt, cwd, frameworkRoot, resumeId?, model?: ChatModel, effort?: ChatEffort, signal }): AsyncIterable<AgentEvent>` (`ChatModel`/`ChatEffort` in `shared/src/types.ts`; the real provider passes them to the SDK options `model` and `effort` when set) where `AgentEvent` is `{type:'activity',text}|{type:'step',id,kind,text,parentId?}|{type:'step-end',id,ok}|{type:'delta',text}|{type:'open',path}|{type:'resume',id}|{type:'done'}|{type:'error',message}`. A fake provider for tests lives next to it.
- The real provider uses `@anthropic-ai/claude-agent-sdk`, bundled into `server.mjs`, with `pathToClaudeCodeExecutable` set to the Claude Code the master already has installed (looked up on PATH with `which`/`where`, then the usual install locations); when none is found `agent.available` is false with a plain reason. It runs with the Yllir plugin loaded from `frameworkRoot`, `cwd` = campaign root. No free shell: a `canUseTool` gate allows only (a) Read, Glob, Grep, Skill; (a2) Task and Agent (the framework's own sub-agents; their tool calls pass through this same gate); Read, Glob and Grep only inside the campaign and the framework folders; (b) Write and Edit only on paths under `<campaign>/.campaign/drafts/`; (c) Bash only for the single command shape `node <frameworkRoot>/scripts/<script>.mjs <args>` or `node <frameworkRoot>/skills/**/scripts/<script>.mjs <args>` with no shell metacharacters (`;|&><$` backtick, newline, `..`) in the line, and `git` is never allowed; (d) the in-process MCP tools `search_docs`, `open_document` and `suggest_music`; (e) the tools of the Yllir plugins named `mcp__plugin_yllir_<plugin>__<tool>` (the Photoshop plugin, used for images), except any tool whose name contains `execute_script` or `install_font`. Everything else is denied with a plain reason. It also receives the master's message verbatim as the prompt, prefixed by nothing, so the entry skill handles it exactly as in the terminal.
- The master-only block is visible to the agent (it works on canon) and is never sent anywhere else by this server.

The live table (cockpit) has its own turn manager, `server/src/cockpit/turns.ts`, and does not share the queue of the home chat. Its turns run one at a time per cockpit session, in order; a turn stops after 90 s without activity (`DEFAULT_IDLE_TIMEOUT_MS`) or after 5 min in total (`DEFAULT_TURN_TIMEOUT_MS`), and can be cancelled. Its tools, token and undo rules are in "Live table (cockpit)".

## Client rules

- Angular standalone components, signals, lazy routes. Routes: `/` (chat + changes), `/doc/:path*` (reader), `/search`, `/settings`, `/live` (the live table, see "Live table (cockpit)"), `/plot` (plot map), `/docs` (documents explorer).
- One `EventSource` on `/api/events`, reconnecting with backoff. It stays open while the tab is hidden (the server uses the open stream to know the screen is still there).
- Icons only in the navigation (Lucide), each with a tooltip and an `aria-label`; no text labels next to icons. Page content may contain text.
- Words shown to the master: document, scene, sheet, session, character. Never: commit, index, canon, frontmatter, token, provider, sha.
- No optimistic updates: what is on screen is what the server confirmed.
- Preferences (theme, text size, recent and favourite documents) in `localStorage`, keys prefixed `yllir:<campaign slug>:`. Wrap every access in try/catch.
- Modern, calm, readable: CSS custom properties for tokens, light and dark theme following the system with a manual override, `prefers-reduced-motion` respected, visible focus rings, keyboard shortcut Ctrl/Cmd+K for search, layout works from 360 px width.
- UI language: the campaign language from `/api/status` (`it` or `en` at least); strings live in one `i18n` file per language, no hard-coded copy in templates.

## Live table (cockpit)

Route `/live`. The live table is the cockpit: a board (a free canvas with document, image and note cards, scene frames and arrows), the current scene, the session log, the combat overlay, and one chat thread with the table assistant per cockpit session, plus a separate combat thread per fight with its own assistant. While the master plays, the assistant arranges the board, keeps the log and runs the combat on the master's words. The cockpit was imported from the author's prototype and adapted to the master screen (theme, campaign language, framework libraries). Claude is the only provider. The code is in `server/src/cockpit/` (agent side, tools, turns, store, REST, MCP), `server/src/cockpit-host/` (the adapters that connect it to this server: archive, maps, music, categories, engine, battle), `server/src/routes/battle.ts` (battle endpoints) and `client/src/app/cockpit/` (screen, board, chat, combat overlay). `server/src/cockpit/ports.ts` is the only interface between the cockpit and the rest of the server.

### State

Operational state, never canon, always under `.campaign/`.

- Cockpit, one folder per cockpit session: `.campaign/state/live/cockpit/<uuid>/`. Files: `session.json` (chat messages, turns, revision, action groups), `undo.json` (board and scene snapshots of the last 50 undo groups), `live.json` (the framework session the cockpit is bound to, the ledger and combat links, and the sheets created at this session), `tools.jsonl` (tool calls of the turns), `files/` (images the master added). A combat thread is stored in its own folder of the same kind, `.campaign/state/live/cockpit/<uuid>/`, with `kind: "combat"` and `parentId` (the table session); the fight's `CombatMeta.threadId` lives in the table's `live.json`.
- Framework, shared with the terminal and the Claude app: `.campaign/state/live/active.json` (`{ "sessionId": "<id>" | null }`, the open session), and per session `.campaign/state/live/<sessionId>/`: `session.json` and `log.json` (the session log, written by the `session-log` library), `combat.json` (the combat, written by the `combat-tracker` library), `battle.json` (the battle screen: map and chip positions, with a `revision`, written by this server atomically).

The cockpit does not write the log or the combat files by hand: each change goes through the framework library (`session-log` for the log, `combat-tracker` for the combat). Every read of a cockpit session fills them from the libraries before the state is sent, so the terminal and the screen show the same thing. A change made in the terminal (a log entry, a combat step) is watched on disk and pushed to the open screen. The board, the scene and the chat stay in the cockpit folder.

### REST endpoints (`/api/cockpit`)

Errors: `{ "error": "<plain-language message>" }`, status 400 by default, 404 for an unknown cockpit route, 409 for a refused change, 413 for a body or image too large (JSON body max 64 KB; image upload max 15 MB, `png`, `jpg`, `webp` or `gif`).

| Method and path | Request | Response |
|---|---|---|
| GET `/api/cockpit/sessions` | | list of sessions |
| POST `/api/cockpit/sessions` | `{ title: 1..200 chars, provider?: "claude", model?: "haiku"\|"sonnet"\|"opus" }` (any other provider is refused; `model` missing = `haiku`, any other value = 400) | 201 session view; opens the framework live session, or joins the one already open. The stored `model` is the full id (`claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`) |
| PATCH `/api/cockpit/sessions/:id` | `{ model: "haiku"\|"sonnet"\|"opus" }` | session view; the next turn uses the new model, the conversation is kept; any other value = 400 |
| GET `/api/cockpit/sessions/:id` | | session view (ledger and combat filled from the framework) |
| DELETE `/api/cockpit/sessions/:id` | | `{ ok: true }`; 409 while a turn of the session is running |
| GET `/api/cockpit/sessions/:id/events` | `Last-Event-ID` header or `lastEventId` query | SSE (see below) |
| POST `/api/cockpit/sessions/:id/messages` | `{ text: 1..8000 chars, clientId?: string }` | 202 `{ turnId, messageId }`; a repeated `clientId` returns the same turn |
| POST `/api/cockpit/sessions/:id/turns/:turnId/cancel` | | `{ ok: true }` |
| POST `/api/cockpit/sessions/:id/combat/thread` | | `{ threadId }`: the thread of the active fight, created when missing (default model Haiku); 409 when no fight is active; 400 when `:id` is itself a thread |
| POST `/api/cockpit/sessions/:id/actions` | `{ actions: 1..20 CockpitAction }` | `{ revision, group }`; the master's own board edits, one undo group for the whole request |
| POST `/api/cockpit/sessions/:id/layout` | `{ items: 1..300 }` (geometry only) | `{ revision }`; no undo group |
| POST `/api/cockpit/sessions/:id/undo` | `{ groupId }`, must be the newest group not yet undone | `{ revision }`; 409 otherwise |
| POST `/api/cockpit/sessions/:id/files` | raw image body, `Content-Type` `image/png`, `image/jpeg`, `image/webp` or `image/gif` | 201 `{ name }` |
| GET `/api/cockpit/sessions/:id/files/:name` | | the image (cached, immutable) |
| GET `/api/cockpit/runtime?sessionId=` | | status of the Claude provider and, when `sessionId` is given, of that session's turn |

A combat thread accepts the ordinary session routes (GET, events, messages, cancel, PATCH model, DELETE); `actions`, `files` upload, `undo` and `layout` answer 409. A message to a thread whose fight is over is refused with 409 "Lo scontro è finito: la sua chat è chiusa". Threads are not listed by `GET /api/cockpit/sessions`, and deleting a table session deletes its threads.

Error messages are plain language, in the campaign language, with no stack trace or file path.

### SSE

`GET /api/cockpit/sessions/:id/events` is one stream per open session. The first frame is `snapshot` (the whole session view). Then `state` (new revision, board and scene view, and the undo group when the change was one), `message`, `delta` (streamed text of the assistant), `turn` and `deleted`. Each frame has an `id`; the server keeps the last 500 events per session and replays the missing ones from `Last-Event-ID`. A heartbeat goes out every 15 s. `state` frames are published in order, after the framework state of the session is read.

### MCP endpoint and turn tokens

- `POST /mcp/cockpit` is the MCP endpoint (streamable HTTP, JSON responses, one server per request). It is outside `/api`.
- Each turn gets its own random token (32 bytes, base64url). The token is valid only while that turn runs and is revoked when the turn ends. A request needs `Authorization: Bearer <token>`; without a valid token it gets 401. The `Host` header must be `127.0.0.1` or `localhost`, otherwise 403.
- The Claude provider receives this URL and the token of its own turn only. Each turn token carries its own tool list, and the endpoint lists only the tools of that turn. A table turn gets every cockpit tool below except the combat and battle-screen ones (`combat_*`, `find_battle_map`, `battle_map_set`, `battle_move`), with the exception of `combat_start`, which the table has too. A combat-thread turn gets exactly `search_docs`, `read_doc`, `ledger_note`, `combat_start`, `combat_add`, `combat_update`, `combat_remove`, `combat_turn`, `combat_notes`, `combat_end`, `find_battle_map`, `battle_map_set` and `battle_move`.

### Agent tools

These are the tools of `COCKPIT_TOOL_NAMES` (`server/src/cockpit/tools.ts`), in the campaign language in their descriptions. The list is split by turn: the table has the tools below, and a combat thread has the tools under "Combat thread tools" at the end of this section.

Reading the campaign:
- `search_docs`: finds names or themes in the sources the master can see (up to 12 hits).
- `read_doc`: reads a document or a section and lists its headings; the text may be truncated, and the result says so.
- `plot_neighbors`: the plot node of the current scene, with its predecessors, successors and optional branches.
- `session_outline`: a whole session or activity: scenes in order, sections, branches, linked sheets and maps.
- `list_maps`: the map assets of the campaign, filtered by a name or an area.
- `find_images`: images by subject, split into the player version and the master version, plus object cards.
- `search_music`: up to eight tracks; searching never plays anything.
- `get_board`: the board with ids and sources, for a check after many changes in one turn.

Board and scene:
- `board_stage`: lays out the whole session on the board, one frame per scene; `replace` clears the board first (pinned cards stay).
- `board_place`: puts on the board NPCs, enemies, maps, battle maps, objects, music, plot sections and notes; an existing source is updated and moved if its frame changes.
- `board_move`: moves cards already on the board into a frame, or out of every frame.
- `board_remove`: removes cards, frames or arrows that are clearly out of date.
- `board_highlight`: highlights the card or frame that matters now (the canvas centres on it).
- `board_pin`: protects a card or frame from automatic clean-up, or makes it removable.
- `board_frame`: creates a frame that groups cards, and can link frames in sequence (`after` and `before`).
- `board_link`: draws arrows between cards or frames, one or many in one call.
- `board_arrange`: reorders frames and cards, only when the master asks. The board is also reordered at the end of every turn that changed its structure.
- `scene_set`: updates the place, the time, the plot section and the group of characters.
- `open_source`: opens a source in the reader, only on an explicit request.

Sheets:
- `sheet_create`: creates a new sheet (NPC, creature, object or place) and puts it on the board. Use it only after `search_docs` has shown that no sheet exists. The sheet is saved through the review flow below.
- `sheet_update`: rewrites the body of a sheet this cockpit session created. Hand-written sheets are read only.

Session log (framework library `session-log`):
- `ledger_note`: adds an entry of kind fact, decision, intention or open thread, stated by the master.
- `ledger_update`: merges fragments, corrects an entry, resolves it or drops it.
- `ledger_remove`: removes a wrong or outdated entry.

Music:
- `music_play`, `music_stop`: only when the master explicitly asks.

Among the combat tools the table agent has only `combat_start`, so it can start a fight when the master declares one (creatures are given with their sheet path as source, initiative only when the master gives it). It has none of the other combat tools (`combat_*`) nor the battle-screen tools (`find_battle_map`, `battle_map_set`, `battle_move`): damage, turns and conditions go in the combat chat. The swords button of the overlay still starts a fight too, and the master's stop button ends it.

#### Combat thread tools

A combat thread has these tools and no others. Their changes go to the parent table session (log entries and combat), with the combat system prompt and a digest of the place, the party, the combat line and the thread's last messages.
- `search_docs`, `read_doc`: as above.
- `ledger_note`: as above; it may cite the dm messages of the thread as evidence.
- `combat_start`, `combat_add`, `combat_update`, `combat_remove`, `combat_condition`, `combat_turn`, `combat_notes`, `combat_end`: the combat state (framework library `combat-tracker`), as the master declares it. Nothing is rolled and no tactics are chosen. Player characters carry only name and initiative. The turn advances only on an explicit order.
- `find_battle_map`: battle maps of the campaign, filtered by the place (title or path of the sheet that holds them), with grid size when known.
- `battle_map_set`: shows a battle map on the battle screen of the open session.
- `battle_move`: moves a combatant's chip to a grid cell, only when the master says where it is.

### Undo

- A turn or a request from the screen makes one undo group. `POST .../undo` reverts the newest group not yet undone; the other groups cannot be reached.
- The undo covers the board and the position only: the scene (place, time, section, group of characters) and the board. It does not touch the log, the combat or the sheets.
- The log and the combat are corrected by talking to the assistant, not with the undo button.
- A sheet created or changed at the table is an ordinary change of the campaign: it appears in "what changed" and can be undone there.
- The battle screen (chips, battle map) has no undo group.

### Sheets created at the table

A sheet made at the table follows the same write cycle as every other sheet:

1. The draft is written under `.campaign/drafts/`.
2. `engine.mjs check` validates it. The engine also links every mention of an existing sheet.
3. When the batch adds facts to the canon, the `batch-reviewer` sub-agent checks it against the canon and the seed. The sheet is saved only on its approval; otherwise the objections come back in plain words and nothing is saved. Without Claude Code on the computer the review is not available, and such sheets cannot be saved from the table.
4. `engine.mjs commit` saves it as one change group, which appears in "what changed".

The sheet is remembered in the cockpit session's `live.json`, which is what lets `sheet_update` rewrite it later.

### Free text

The assistant writes its own short words in the log, in a card's reason, in a scene summary and in a combat note, and may quote only public text. It never copies text from the master-only block of a sheet.

### Battle screen endpoints (`/api/battle`)

Owned by `routes/battle.ts` and `cockpit-host/battle.ts`. Battle state lives in the open session's `battle.json`.

| Method and path | Request | Response |
|---|---|---|
| GET `/api/battle` | | `BattleView` of the open session (`map`, `positions`, `revision`), or `null` when no session is open |
| PUT `/api/battle` | `{ positions?: { <combatant id>: { x, y } \| null }, map?: { ref, cols?, rows? } \| null }` | the new `BattleView`; positions are merged into the stored ones (`null` removes a chip), `map: null` clears the map; `revision` goes up by one. 409 when no session is open; 400 for invalid input, a map that is not an image of the campaign (`.png`, `.jpg`, `.jpeg`, `.webp`) or more than 300 chips |
| GET `/api/battle/players` | | `{ players: LivePlayer[] }` (name and ref only) |
| GET `/api/battle/maps?place=` | `place` optional | battle maps of the campaign (category `Battlemap`), filtered by the title or the path of the sheet that holds them, accents and case ignored |
| GET `/api/battle/stats/:combatantId` | | `CombatantStats` (`lines`, `actions`, `image?`, `card?`, `source?`); 404 when the id is not in the active combat |

`CombatantStats.card?` is the sheet's `ActionCard` (`sheet`, `sheetHash`, `actions: CardAction[]`, `traits?`, `at`), and `source?` is `'agent'` when `card` is set or `'parser'` when only the deterministic `actions` are available. `CardAction` has `name`, `timing` (`own_turn` | `any_turn` | `others_turns`), `cost` (`action` | `bonus` | `reaction` | `legendary` | `free` | `movement`), `kind` (`attack` | `save` | `spell` | `utility` | `movement`), optional `toHit`, `damage[]`, `save`, `range`, `area`, `recharge`, `uses`, `trigger`, and `effect` (one sentence in the campaign language). Both are defined in `shared/src/types.ts`.

The stats tooltip is built by the game system's adapter (`statSummary` of the encounter module) from the public part of the combatant's sheet: the master-only block is removed before the adapter sees the text. The labels of hit points and armour class come from the adapter. A player character gets its initiative only, with no actions.

#### Action cards

- When creatures join a fight (`combat.start` or `combat.add`), the server runs one background Haiku job per non-player sheet that has no valid card (`server/src/cockpit/card-interpreter.ts`). Identical sheets share one job.
- The job receives only the public part of the sheet. It publishes its result through the MCP tool `combat_card_set`. That tool is listed in `CARD_TOOL_NAMES` (`server/src/cockpit/tools.ts`) and is given neither to the table agent nor to the combat thread.
- Cards are stored in `.campaign/state/live/<session>/cards.json`, keyed by sheet path. A card is valid while the hash of the sheet's public text is unchanged; identical creatures share one card.
- `Combat.cardPending` lists the combatant ids whose card is being written right now. The field is absent when none is.
- Until a card exists, the stats fall back to the adapter's deterministic actions (`source: 'parser'`).

Player-character category: the sheets of the category in `campaign.yaml` `structure.categories` whose id is `players`, `giocatori`, `pg` or `pc`; otherwise the first `master-only` category whose documents use the player-character format (format 4.13 in `templates/content-format.md`). `GET /api/battle/players` lists their titles and refs.

### Combat overlay (client)

- Each document card of an NPC or an enemy on the board has a swords button. It opens the full-screen combat overlay. Player characters have no button.
- Step 1, initiative popup: the player characters come from `GET /api/battle/players`, each with an initiative field; the creature cards come from the board. Any other character or creature card can be ticked, and each ticked creature is an ally or an enemy (a click switches it). Starting the combat sends `combat.start` through the cockpit.
- Step 2, battle view: when the open session has a battle map and the preference "show battle maps" is on (default on, saved per campaign), the map is shown with a chip for each combatant; otherwise the combatants are listed in initiative order. Chips are dragged inside the map and saved with `PUT /api/battle`. A button writes a request to find the battle map of the scene into the combat chat. The round and the current turn are shown; the stop button ends the combat.
- In list mode every enemy and ally row always shows its hit points, conditions, phase, stat lines and actions (from `GET /api/battle/stats/:id`); player characters show name and initiative only. Each enemy or ally row has quick buttons that send table actions directly, with no assistant: damage and heal by an amount (`combat.update` with the clamped `hp`), defeated (`hp: 0` and a phase, after a confirm) and remove from the fight (`combat.remove`, after a confirm). The header has a next-turn button (`combat.turn` to the next combatant in initiative order, skipping enemies and allies at 0 hit points). The battle view is fetched again on every `snapshot` and `state` event, so a map set by the assistant shows at once.
- Combat screen layout: the battle map (or the list) fills the overlay. Initiative, the turn panel, the combat chat and a mini music player (`ms-music-mini`) are floating panels over it, with a toggle rail. The panels auto-hide after 4 s without pointer activity (no auto-hide under 900 px); key H hides or shows all of them. The header (title, round, the newest notice that is not a turn change, next turn, end, close) stays on top. The initiative strip has one tile per combatant and a hit-point bar. The turn panel shows the actions of the creature whose turn it is (the adapter's `own_turn` groups) and, for every other creature still standing, its reactions and legendary actions (`any_turn`, `others_turns`). Chips and rows show the sheet's artwork when the public part of the sheet has an image (`image` in `GET /api/battle/stats/:id`). Conditions use the adapter's labels and durations (`GET /api/battle/rules`); they are added and removed with `combat.condition`. The rules' automatic changes (`Combat.notices`) appear in the header. End, defeat and remove confirm in the page with a second click, never with a browser dialog. Below 900 px the turn panel and the chat are bottom sheets, one open at a time, and the chat starts folded.
- Hovering or focusing a chip shows a tooltip with the initiative and, for creatures, the stats and actions from `GET /api/battle/stats/:id`.
- The floating chat is the fight's own chat thread (the combat thread), not the table thread. Before the fight starts it shows that the combat chat starts with the fight. Its assistant applies what the master says with the combat tools only, and the chat closes when the fight is no longer the active one.
- The overlay opens by itself only when a combat starts while the live table is on screen, and stays closed once the master closes it.

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

## Settings (master screen settings)

Saved in the campaign file `.campaign/master-screen.yaml` (snake_case keys, written only for the values the master changed) and committed to the campaign's git history, one commit per save, touching only that file. The API uses the camelCase names of `ScreenSettings` (`shared/src/types.ts`); the mapping to the file keys is one table in `server/src/settings/schema.ts`.

| Method and path | Request | Response |
|---|---|---|
| GET `/settings` | | `SettingsResponse` (`settings`, `defaults`, `canSave`, `explicit` as dotted camelCase paths) |
| PUT `/settings` | `ScreenSettingsPatch` (any subset, two levels deep, unknown keys rejected) | `SettingsResponse`; publishes SSE `settings` with the merged settings |

Errors: 400 `{ error: 'Invalid settings' }` for a body that does not validate; 409 when the campaign folder is not a git repository (nothing is written, `canSave` is false); 500 `{ error: 'Settings could not be saved.' }` when the write or commit fails. A missing or unreadable settings file gives the defaults, never an error.

## Update (framework update from the screen)

The screen knows whether a newer Yllir is published, shows the news, and can apply the update and restart itself. The code is in `server/src/update/` (`service.ts` holds the state; `source.ts` the published source; `notice.ts` the notice memory; `restart.ts` the helper that starts the new launcher). The notice memory is the file `.campaign/state/update-notice.yaml`, the same one the framework's update check writes.

| Method and path | Request | Response |
|---|---|---|
| GET `/update` | | `UpdateStatus` |
| POST `/update/check` | | `UpdateStatus`, after a fresh check |
| POST `/update/snooze` | | `UpdateStatus`; writes the notice memory with a one-day snooze when an update is available, else nothing |
| POST `/update/apply` | `{ confirmClose?: boolean }` (absent or not `true` = no confirmation) | 202 `{ ok: true }`, then the update runs in the background (after the open sessions are closed, when there were some); 409 `{ error, sessions? }` when refused: with `sessions` (`OpenSession[]`) when open sessions need the master's confirmation, and nothing is closed or started |

`UpdateStatus` (`shared/src/types.ts`) never carries a version number. `state` is `idle` (up to date, or nothing checked yet), `available`, `offline` (the source could not be read; silent), `updating`, `restarting` or `failed`. `snoozed` is true while the snooze runs past today. `canApply` is true whenever `state` is `available`: open sessions do not block the update. `blockedReason` is `offline` or null. `sessions` (`OpenSession[]`, empty unless `state` is `available`) lists what the update would close: `{ kind: 'live' | 'chat', id, title }`, where `kind: 'live'` is the active live-table session (its title from the cockpit session attached to it, else its id) and `kind: 'chat'` is a conversation with a turn queued or running (its title, or `Chat` when it has none).

Applying with open sessions: the first POST `/update/apply` without `confirmClose: true` answers 409 `{ error, sessions }` (`error` is the plain sentence of `UPDATE_TEXTS.confirmClose`, in the campaign language) and closes nothing. The screen shows the list and repeats the POST with `{ "confirmClose": true }`. That closes every chat turn of the listed conversations (queued ones dropped, the running one cancelled, both waited for) and ends the live session (`lib.endSession`); a failure there is logged, never thrown, and the update goes on. Without open sessions the body is not needed and the update runs at once.

The published source is read with unauthenticated GET requests and a generic User-Agent only, with an 8 s timeout: the plugin manifest (`yllir/.claude-plugin/plugin.json` on the main branch) and the news folder `yllir/news`, from which `X.Y.Z.md` or `X.Y.Z.<campaign language>.md` is taken for each version after the installed one, oldest first, capped at 8000 characters. A failure of the news alone keeps the update available without news. The check runs at most once an hour; the first status request after start starts the first check in the background.

Apply runs one at a time (the closing of the sessions, when confirmed, comes first): `claude plugin update yllir@yllir --json` (no shell, 3 minutes at most), then `claude plugin list --json` to find the plugin's install folder. Then the server starts a detached helper that waits for this process to exit (30 s at most) and starts that folder's `scripts/launcher/launch.mjs` for the campaign, and the server shuts down. Any failure ends in `failed`, with nothing else changed and the old server running. `failed` is cleared by POST `/update/check`, after which the update can be applied again.

## Alignment (campaign alignment after a framework update)

After the assistant is updated, the campaign is aligned: the framework's `update-campaign.mjs` runs (deterministic), then the assistant does the guided sheet format follow-up of the pending migrations. The screen runs this in one dedicated chat conversation with the model `sonnet` and one fixed English prompt (`server/src/update/align-text.ts`). Code: `server/src/update/align.ts` (state), `align-check.ts` (the framework check), routes in `server/src/routes/update.ts`.

| Method and path | Request | Response |
|---|---|---|
| GET `/update/align` | | `AlignStatus` |
| POST `/update/align/start` | | 202 `AlignStatus` (`state` `running`); 409 `{ error }` when the state is not `needed` or `failed`, or a run is active; 503 `{ error }` when the agent is not available |

`AlignStatus` (`shared/src/types.ts`): `{ state: 'none' | 'needed' | 'running' | 'waiting-answer' | 'done' | 'failed', conversationId: string | null }`.

- The check is the framework's `update-campaign.mjs <campaign> --dry-run` (no shell, writes nothing). It says `needed` when the result is `would-update`, or `failed` with first error `interrupted-update`, or `pending_migrations` is not empty. The answer is cached for 30 s, and never asked while a run is active.
- `none`: nothing to do. `needed`: the campaign must be aligned. `failed` (still needed): the last run ended with an error or was cancelled; start is allowed again as a retry.
- `running`: a turn of the alignment conversation is queued or running (also when the master answers in it, through the existing `POST /api/chat/messages`).
- When the turns end: nothing needed any more gives `done`; still needed after a normal end gives `waiting-answer` (the assistant asked a question); an error or a cancel gives `failed`.
- `conversationId` is set for `running`, `waiting-answer`, `done` and `failed`. The alignment conversation is an ordinary conversation: it stays listed in `GET /api/chats`, with the English prompt as its first master message, so its title is the English first line of that prompt.
- While the state is `running` or `waiting-answer`, POST `/update/apply` answers 409 `{ error }` (the sentence of `alignBusy`).
- The state is kept in memory: after a restart it is recomputed from the framework check (a run that was waiting is then `needed` again). No SSE event is sent for it: the screen follows the `turn` events of the conversation, or asks again.

