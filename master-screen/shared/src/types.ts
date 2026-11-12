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
