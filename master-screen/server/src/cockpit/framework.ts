// The cockpit's only door to the framework: the live session log, the combat tracker and the
// engine (sheets). Everything the cockpit needs from them is named here, so the unit tests
// inject a fake (test-helpers/fake-framework.ts) and never run the real framework.
import fs from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { query as sdkQuery, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CombatOp, CombatState, Combatant as SharedCombatant, LiveSession, LogEntry, LogKind } from "../../../shared/src/types.js";
import { findClaudeCode } from "../agent/claude-provider.js";
import type { Ctx } from "../context.js";
import { loadFrameworkModule, runEngine, type EngineResult } from "../engine.js";
import { callLog, importFramework, type LibResult, LIB_MISSING, INTERNAL } from "../live/framework.js";

export type { LibResult } from "../live/framework.js";

/** Input of one log entry written by the cockpit (`by` is always set by the caller). */
export interface LogInput {
  kind: LogKind;
  text: string;
  by: "master" | "agent";
  resolved?: boolean;
}

export interface LogPatch {
  text?: string;
  kind?: LogKind;
  resolved?: boolean;
}

export interface ReviewInput {
  /** Campaign-relative draft paths of the batch. */
  drafts: string[];
  /** Campaign-relative paths the drafts become (from `check`). */
  finalFiles: string[];
  /** One sentence in English: what the batch does. */
  intent: string;
}

export interface ReviewVerdict {
  approved: boolean;
  /** Plain sentences, one per objection, when not approved. */
  objections: string[];
}

/** The session log of the campaign's live session. Calls never throw. */
export interface CockpitLog {
  active(): Promise<LibResult<{ session: LiveSession | null }>>;
  open(title: string, sessionRef?: string): Promise<LibResult<{ session: LiveSession }>>;
  add(input: LogInput): Promise<LibResult<{ entry: LogEntry }>>;
  update(id: string, patch: LogPatch): Promise<LibResult<{ entry: LogEntry }>>;
  remove(id: string): Promise<LibResult<object>>;
  list(): Promise<LibResult<{ entries: LogEntry[] }>>;
}

/** The combat of the active live session. */
export interface CockpitCombat {
  get(): Promise<LibResult<{ sessionId: string; combat: FrameworkCombatState | null }>>;
  apply(op: CombatOp): Promise<LibResult<{ combat: CombatState }>>;
}

/** A condition as the framework keeps it: duration and rounds only when the rule has them. */
export interface FrameworkCondition {
  id: string;
  duration?: string;
  rounds?: number;
  note?: string;
}

/** Automatic change written by the game system's rules into the combat events (see encounter.mjs). */
export type FrameworkNotice =
  | { kind: "condition-ended"; id: string; name: string; condition: string }
  | { kind: "defeated"; id: string; name: string }
  | { kind: "unconscious"; id: string; name: string }
  | { kind: "turn"; id: string; name: string; round: number; newRound: boolean };

export interface FrameworkCombatEvent {
  at: string;
  text: string;
  notice?: FrameworkNotice;
}

export type FrameworkCombatant = Omit<SharedCombatant, "conditions"> & { conditions: FrameworkCondition[] };

/** The combat state as the framework writes it (combat.json): the shared shape plus the optional rule fields. */
export type FrameworkCombatState = Omit<CombatState, "combatants" | "events"> & {
  combatants: FrameworkCombatant[];
  events: FrameworkCombatEvent[];
};

/** Result of one engine command: its JSON and exit code (see engine.mjs). */
export type EngineRun = EngineResult<unknown>;

export interface CockpitFramework {
  log: CockpitLog;
  combat: CockpitCombat;
  /** Runs `engine.mjs <args[0]> <campaign> ...args[1..]`. Never rejects. */
  engine(args: string[]): Promise<EngineRun>;
  /**
   * Model review of a batch that adds facts to the canon, required by `commit` before it
   * saves. Resolves with the reviewer's verdict on the current drafts: `approved` only on
   * APPLY, otherwise the reviewer's objections as plain sentences. Absent when the host has
   * no reviewer: such batches cannot be saved from the cockpit.
   */
  review?(input: ReviewInput): Promise<ReviewVerdict>;
  /** Calls the listener when the framework's live files change. Returns the unsubscribe function. */
  watch?(listener: () => void): () => void;
}

const unavailable = (message: string): LibResult<never> => ({
  ok: false,
  error: { code: LIB_MISSING, message },
});

/** A framework with nothing behind it: every call answers "not supported". Used when no host wires one. */
export function unavailableFramework(): CockpitFramework {
  const message = "The live session library is not installed.";
  return {
    log: {
      active: async () => unavailable(message),
      open: async () => unavailable(message),
      add: async () => unavailable(message),
      update: async () => unavailable(message),
      remove: async () => unavailable(message),
      list: async () => unavailable(message),
    },
    combat: {
      get: async () => unavailable(message),
      apply: async () => unavailable(message),
    },
    engine: async () => ({ code: 2, json: { error: { message } } }),
  };
}

const COMBAT_LIB = "skills/library/combat-tracker/scripts/lib/combat-store.mjs";

/** Time the model review may take before the batch is refused. */
export const REVIEW_TIMEOUT_MS = 180_000;
const REVIEW_FILE = path.join(".campaign", "state", "engine", "review.json");
const REVIEWER = "yllir:batch-reviewer";
const NO_CLAUDE = "The review is not available: Claude Code is not installed on this computer.";
const NO_ANSWER = "The review did not answer in a usable way. Try again.";
const TIMED_OUT = "The review took too long and was stopped. Try again.";

/** The one-query runner the review uses: the Claude Agent SDK's query, or a fake in tests. */
export type ReviewQuery = (args: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface CampaignFrameworkOptions {
  /** Runs the review query. Defaults to the Claude Agent SDK. */
  query?: ReviewQuery;
  /** Finds the Claude Code executable. Defaults to findClaudeCode(). */
  findClaude?: () => string | null;
  /** Review time limit in milliseconds. Defaults to REVIEW_TIMEOUT_MS. */
  reviewTimeoutMs?: number;
}

/** The reviewer's answer, validated: outcome APPLY or FIX, FIX items with file, problem and fix. */
interface ReviewAnswer {
  outcome: "APPLY" | "FIX";
  items: Array<{ file: string; problem: string; fix: string }>;
}

function parseReviewAnswer(text: string): ReviewAnswer | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const record = json as { outcome?: unknown; items?: unknown };
  if (record.outcome !== "APPLY" && record.outcome !== "FIX") return null;
  if (!Array.isArray(record.items)) return null;
  const items: ReviewAnswer["items"] = [];
  for (const raw of record.items) {
    const item = raw as { file?: unknown; problem?: unknown; fix?: unknown } | null;
    if (typeof item?.file !== "string" || typeof item.problem !== "string" || typeof item.fix !== "string") return null;
    items.push({ file: item.file, problem: item.problem, fix: item.fix });
  }
  return { outcome: record.outcome, items };
}

/** The prompt of the review query: it launches the reviewer exactly as authoring.md describes, and relays its answer. */
export function reviewPrompt(input: { root: string; drafts: string[]; finalFiles: string[]; seed: string; intent: string }): string {
  return [
    "You are the review step of one Yllir batch. Change nothing and write no file.",
    `Launch exactly one sub-agent with the Agent tool, subagent_type "${REVIEWER}", and this prompt with exactly these keys, one per line:`,
    `CAMPAIGN_ROOT: ${input.root}`,
    `DRAFTS: ${input.drafts.join(",")}`,
    `FINAL_FILES: ${input.finalFiles.join(",")}`,
    `SEED: ${input.seed}`,
    `INTENT: ${input.intent}`,
    "When it answers, reply with its whole answer exactly as it came back: one JSON object and nothing else.",
  ].join("\n");
}

/** The seed of the campaign (campaign.seed in campaign.yaml), campaign-relative, or "none". */
async function seedOf(ctx: Ctx): Promise<string> {
  try {
    const yaml = await loadFrameworkModule<{ parseYamlLite(text: string): { data: unknown; errors: unknown[] } }>(ctx, "yaml-lite");
    const text = fs.readFileSync(path.join(ctx.campaignRoot, "campaign.yaml"), "utf8");
    const parsed = yaml.parseYamlLite(text);
    const campaign = (parsed.data as { campaign?: { seed?: unknown } } | null)?.campaign;
    return typeof campaign?.seed === "string" && campaign.seed !== "" ? campaign.seed : "none";
  } catch {
    return "none";
  }
}

/**
 * Runs one review of the current drafts: one query asks the batch reviewer, the answer is saved
 * exactly to .campaign/state/engine/review.json (where commit reads it), and the verdict returns.
 * A missing or unusable answer removes any old review file, so an old APPLY cannot be used.
 */
export async function reviewBatch(
  ctx: Ctx,
  input: ReviewInput,
  options: CampaignFrameworkOptions = {},
): Promise<ReviewVerdict> {
  const root = ctx.campaignRoot;
  const reviewFile = path.join(root, REVIEW_FILE);
  const refuse = async (message: string): Promise<ReviewVerdict> => {
    await rm(reviewFile, { force: true }).catch(() => undefined);
    return { approved: false, objections: [message] };
  };
  const executable = (options.findClaude ?? findClaudeCode)();
  if (!executable) return refuse(NO_CLAUDE);
  const prompt = reviewPrompt({
    root,
    drafts: input.drafts,
    finalFiles: input.finalFiles,
    seed: await seedOf(ctx),
    intent: input.intent,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.reviewTimeoutMs ?? REVIEW_TIMEOUT_MS);
  const run = options.query ?? (sdkQuery as unknown as ReviewQuery);
  let answer: string | null = null;
  try {
    const stream = run({
      prompt,
      options: {
        cwd: root,
        pathToClaudeCodeExecutable: executable,
        plugins: [{ type: "local", path: ctx.frameworkRoot }],
        settingSources: [],
        // Only the reviewer's tools are allowed; anything else is denied, so nothing can be written here.
        permissionMode: "dontAsk",
        allowedTools: ["Agent", "Task", "Read", "Glob", "Grep"],
        disallowedTools: ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "WebSearch"],
        systemPrompt: "You relay the answer of the Yllir batch reviewer. You never change files.",
        includePartialMessages: false,
        abortController: controller,
      },
    });
    for await (const message of stream) {
      if (message.type === "result" && message.subtype === "success" && typeof message.result === "string")
        answer = message.result.trim();
    }
  } catch (error) {
    if (controller.signal.aborted) return refuse(TIMED_OUT);
    ctx.log(`batch review failed: ${error instanceof Error ? error.message : String(error)}`);
    return refuse(NO_ANSWER);
  } finally {
    clearTimeout(timer);
  }
  if (controller.signal.aborted) return refuse(TIMED_OUT);
  const parsed = answer === null ? null : parseReviewAnswer(answer);
  if (answer === null || parsed === null) return refuse(NO_ANSWER);
  await mkdir(path.dirname(reviewFile), { recursive: true });
  await writeFile(reviewFile, `${answer}\n`, "utf8");
  if (parsed.outcome === "APPLY") return { approved: true, objections: [] };
  const objections = parsed.items.map((item) => `${item.problem} ${item.fix}`.trim());
  return { approved: false, objections: objections.length ? objections : [NO_ANSWER] };
}

/** The real framework of one campaign, read from the framework folder at each call. */
export function createCampaignFramework(ctx: Ctx, options: CampaignFrameworkOptions = {}): CockpitFramework {
  const root = ctx.campaignRoot;
  const log = <T>(run: (lib: Record<string, (...args: never[]) => unknown>) => unknown) =>
    callLog<T>(ctx, (lib) => run(lib as unknown as Record<string, (...args: never[]) => unknown>) as LibResult<T>);
  const combatCall = async <T>(run: (lib: Record<string, (...args: never[]) => unknown>) => Promise<LibResult<T>>): Promise<LibResult<T>> => {
    try {
      const lib = await importFramework<Record<string, (...args: never[]) => unknown>>(ctx, COMBAT_LIB);
      if (lib === null) return unavailable("The combat tracker library is not installed.");
      return await run(lib);
    } catch (err) {
      ctx.log(`combat tracker failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      return { ok: false, error: { code: INTERNAL, message: "Internal error." } };
    }
  };
  const call = (name: string, ...args: unknown[]) =>
    log<unknown>((lib) => (lib[name] as (...a: unknown[]) => unknown)(root, ...args)) as Promise<LibResult<never>>;
  return {
    log: {
      active: () => call("getActive") as ReturnType<CockpitLog["active"]>,
      open: (title, sessionRef) =>
        call("openSession", { title, ...(sessionRef ? { sessionRef } : {}) }) as ReturnType<CockpitLog["open"]>,
      add: (input) => call("addEntry", input) as ReturnType<CockpitLog["add"]>,
      update: (id, patch) => call("updateEntry", id, patch) as ReturnType<CockpitLog["update"]>,
      remove: (id) => call("removeEntry", id) as ReturnType<CockpitLog["remove"]>,
      list: () => call("listEntries") as ReturnType<CockpitLog["list"]>,
    },
    combat: {
      get: () =>
        combatCall(async (lib) => (lib.getCombat as unknown as (r: string) => LibResult<{ sessionId: string; combat: FrameworkCombatState | null }>)(root)),
      apply: (op) =>
        combatCall(async (lib) =>
          (lib.applyOp as unknown as (r: string, o: CombatOp) => Promise<LibResult<{ combat: CombatState }>>)(root, op),
        ),
    },
    engine: (args) => runEngine(ctx, args),
    review: (input) => reviewBatch(ctx, input, options),
    watch(listener) {
      const dir = path.join(root, ".campaign", "state", "live");
      let timer: ReturnType<typeof setTimeout> | undefined;
      let watcher: fs.FSWatcher | undefined;
      try {
        watcher = fs.watch(dir, { recursive: true }, () => {
          clearTimeout(timer);
          timer = setTimeout(listener, 150);
        });
        watcher.on("error", () => {});
      } catch {
        // The folder does not exist yet: nothing to watch until a session is opened.
      }
      return () => {
        clearTimeout(timer);
        watcher?.close();
      };
    },
  };
}
