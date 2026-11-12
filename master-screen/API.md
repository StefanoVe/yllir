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
export interface ChatMessage { id: string; role: 'master' | 'agent'; text: string; at: string; turnId?: string }
export interface Turn { id: string; messageId: string; state: TurnState; activity: string; startedAt: string; endedAt?: string; fromSha?: string; toSha?: string; error?: string }
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
| POST `/chat/messages` | `{ text: string }` (1..8000) | 202 `{ messageId, turnId }`; queued when a turn is running |
| POST `/chat/turns/:id/cancel` | | `{ ok: true }` |
| GET `/checks` | | `ChecksResponse` (last result, or computed once) |
| POST `/checks/run` | | `ChecksResponse` (recomputed with `engine.mjs index` then `query errors` and `query sketches`) |
| GET `/events` | `Last-Event-ID` header | SSE, 15 s heartbeat comment, ring buffer of 500 events for replay |
| POST `/shutdown` | | `{ ok: true }`, then the process exits |

## Undo semantics

A change group is a git commit made by the engine. Undo of group G runs `git revert --no-edit G` on the campaign (adds one commit, never rewrites history), refuses with 409 when the working tree has uncommitted changes in canon files, and then publishes `changes` and `files`. The undo commit's message starts with `Undo: ` so `isUndo` is derivable. Turns store `fromSha` (HEAD when the turn started) and `toSha` (HEAD when it ended); a group belongs to the message of the turn whose range contains it.

## Agent (turn) rules

- One turn at a time per campaign, FIFO queue; idle timeout 120 s, hard limit 10 min; cancellable.
- Provider interface (`server/src/agent/provider.ts`): `run(input: { prompt, cwd, frameworkRoot, resumeId?, signal }): AsyncIterable<AgentEvent>` where `AgentEvent` is `{type:'activity',text}|{type:'delta',text}|{type:'open',path}|{type:'resume',id}|{type:'done'}|{type:'error',message}`. A fake provider for tests lives next to it.
- The real provider uses `@anthropic-ai/claude-agent-sdk`, bundled into `server.mjs`, with `pathToClaudeCodeExecutable` set to the Claude Code the master already has installed (looked up on PATH with `which`/`where`, then the usual install locations); when none is found `agent.available` is false with a plain reason. It runs with the Yllir plugin loaded from `frameworkRoot`, `cwd` = campaign root. No free shell: a `canUseTool` gate allows only (a) Read, Glob, Grep, Skill; (a2) Task and Agent (the framework's own sub-agents; their tool calls pass through this same gate); Read, Glob and Grep only inside the campaign and the framework folders; (b) Write and Edit only on paths under `<campaign>/.campaign/drafts/`; (c) Bash only for the single command shape `node <frameworkRoot>/scripts/<script>.mjs <args>` or `node <frameworkRoot>/skills/**/scripts/<script>.mjs <args>` with no shell metacharacters (`;|&><$` backtick, newline, `..`) in the line, and `git` is never allowed; (d) the in-process MCP tools `search_docs` and `open_document`. Everything else is denied with a plain reason. It also receives the master's message verbatim as the prompt, prefixed by nothing, so the entry skill handles it exactly as in the terminal.
- The master-only block is visible to the agent (it works on canon) and is never sent anywhere else by this server.

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

State lives in `<campaign>/.campaign/state/live/`, never in canon, never in git history of canon (it is under `.campaign/`). The log and the combat state are owned by the framework skills `session-log` and `combat-tracker` (so the terminal and the Claude app can use them with no master screen); the server only calls their library modules through `loadFrameworkModule`-style dynamic import and never re-implements their rules. The board (free canvas) is owned by the server alone and is not part of undo.

Files: `live/active.json` (`{ "sessionId": "<id>" | null }`), `live/<sessionId>/session.json` (LiveSession), `live/<sessionId>/log.json` (LogEntry[]), `live/<sessionId>/combat.json` (CombatState), `live/<sessionId>/board.json` (Board). All written atomically (temp + rename), mode 0600, UTF-8, pretty JSON.

Framework library contract (ESM, in `yllir/skills/library/<skill>/scripts/lib/`). Every function is synchronous, takes the campaign root first, never throws for bad input and returns `{ ok: true, ... }` or `{ ok: false, error: { code: string, message: string } }` (message in English, plain):
- `session-log/scripts/lib/log-store.mjs`: `openSession(root, { title?, sessionRef?, now? })` (fails with code `already-open` when one is active; id is the date, `-2`, `-3` for more the same day) -> `{ session }`; `getActive(root)` -> `{ session | null }`; `addEntry(root, { kind, text, scene?, subjects?, by? , now? })` -> `{ entry }`; `updateEntry(root, id, patch)` (patch: text, kind, scene, subjects, resolved) -> `{ entry }`; `removeEntry(root, id)`; `listEntries(root)` -> `{ entries }`; `endSession(root, { now? })` -> `{ session }` (keeps files; clears active.json); `readSession(root, sessionId)` -> `{ session, entries }`.
- `combat-tracker/scripts/lib/combat-store.mjs`: `getCombat(root)` -> `{ combat | null }` (for the active session); `applyOp(root, op, { now? })` where op is the `CombatOp` union of `shared/src/types.ts` -> `{ combat }`. It loads the adapter named in campaign.yaml `system.adapter` and delegates every rule to `<framework>/modules/systems/<id>/encounter.mjs` (exports `initEncounter(adapter)`, `recordEvent(adapter, state, op)`, `advanceTurn(adapter, state)`, `validateState(adapter, state)`, each pure on plain objects). A validator runs before every save; an invalid result is not saved.
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

The server publishes SSE `live` `{ revision }` after every write through the API and also when anything under `.campaign/state/live/` changes on disk (written by the agent or the terminal): a second chokidar watcher, debounced 150 ms. `revision` is a hash of the four files' mtimes and sizes. The client refetches `/api/live` on `live`.

Rules: log entries are not canon and never touch sheets during the session; the log and combat tools are available to the in-app agent through the framework scripts (the Bash gate already allows `skills/**/scripts/*.mjs`); a combat starts when a `start` op succeeds and the combat panel opens by itself when `combat.active` turns true; the master-only block is never put into `LiveSnapshot` (cards reference documents by path, the reader decides what to show); board validation: at most 300 cards, coordinates within +-20000, `ref` must be a campaign-relative path without `..`.

Client (phase 2): route `/live` (the table: free canvas in the centre, an icon dock on the right with log, combat, quick look-up), route `/plot` (plot map: nodes for sessions and scenes, solid arrows for declared dependencies, dashed lines for mere file order, with a legend). The combat panel opens by itself when a combat starts. The canvas supports document, image and note cards, scene frames and arrows, drag and resize, pan and zoom; layout saves without entering undo. All of it follows the "Client rules" above (icons with tooltips, no jargon, no optimistic updates: the board position shown after a drop is the one the server confirmed, but dragging itself is local and smooth).
