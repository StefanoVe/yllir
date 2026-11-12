import { mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  query as sdkQuery,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ProviderStatus } from "../../../../shared/src/cockpit-types.js";
import { findClaudeCode } from "../../agent/claude-provider.js";
import type { Provider, ProviderEvent, TurnInput } from "./provider.js";

/** The short choices the master can pick for a live session, and the model id each one maps to. */
export const LIVE_MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
} as const;
export type LiveModelChoice = keyof typeof LIVE_MODELS;

/** The default of every new session: the cheapest and fastest choice. */
const DEFAULT_MODEL = LIVE_MODELS.haiku;
const STATUS_CACHE_MS = 30_000;
const STATUS_FAILURE_CACHE_MS = 5_000;
const STATUS_TIMEOUT_MS = 5_000;
const MAX_TURNS = 40;
const execFileAsync = promisify(execFile);
type ClaudeQuery = typeof sdkQuery;

function resultText(message: Extract<SDKMessage, { type: "result" }>) {
  return "result" in message && typeof message.result === "string"
    ? message.result
    : "";
}

function startsTextBlock(message: SDKMessage) {
  if (message.type !== "stream_event" || message.parent_tool_use_id)
    return false;
  const event = message.event as {
    type: string;
    content_block?: { type?: string };
  };
  return (
    event.type === "content_block_start" && event.content_block?.type === "text"
  );
}

export function mapClaudeMessage(message: SDKMessage): ProviderEvent[] {
  if (message.type === "system" && message.subtype === "init")
    return [{ type: "session", id: message.session_id }];
  if (message.type === "stream_event") {
    if (message.parent_tool_use_id) return [];
    const event = message.event as {
      type: string;
      content_block?: { type?: string; name?: string };
      delta?: { type?: string; text?: string };
    };
    if (
      event.type === "content_block_start" &&
      event.content_block?.type === "thinking"
    )
      return [{ type: "thinking" }];
    if (
      event.type === "content_block_start" &&
      event.content_block?.type === "tool_use"
    )
      return [{ type: "tool", name: event.content_block.name || "strumento" }];
    if (
      event.type === "content_block_delta" &&
      event.delta?.type === "text_delta" &&
      event.delta.text
    )
      return [{ type: "text", text: event.delta.text }];
    return [];
  }
  if (message.type === "assistant") {
    if (message.parent_tool_use_id) return [];
    if (message.error === "authentication_failed")
      throw new Error("Claude non autenticato: esegui `claude auth login`.");
    if (message.error)
      throw new Error(`Errore Claude durante la risposta (${message.error}).`);
    return [];
  }
  if (message.type === "result") {
    if (message.subtype === "error_max_turns")
      throw new Error("Claude ha raggiunto il limite massimo di turni.");
    if (message.subtype !== "success" || message.is_error) {
      const details = "errors" in message ? message.errors.join("; ") : "";
      if (/auth|login|credential|api.?key/i.test(details))
        throw new Error("Claude non autenticato: esegui `claude auth login`.");
      throw new Error(
        details
          ? `Errore di esecuzione Claude: ${details}`
          : "Errore di esecuzione Claude.",
      );
    }
  }
  return [];
}

export interface ClaudeProviderOptions {
  cacheDir: string;
  query?: ClaudeQuery;
}

export class ClaudeProvider implements Provider {
  readonly id = "claude" as const;
  readonly defaultModel = DEFAULT_MODEL;
  private active = new Set<AbortController>();
  private statusCache?: { value: ProviderStatus; until: number };
  private statusTask?: Promise<ProviderStatus>;
  private cwdPromise: Promise<string>;
  private query: ClaudeQuery;

  constructor(private options: ClaudeProviderOptions) {
    this.query = options.query || sdkQuery;
    this.cwdPromise = mkdir(path.join(options.cacheDir, "claude-cockpit"), {
      recursive: true,
    }).then(() => path.join(options.cacheDir, "claude-cockpit"));
  }

  async *run(
    input: TurnInput,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    if (signal.aborted) return;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    this.active.add(controller);
    let query: ReturnType<ClaudeQuery> | undefined;
    let emittedText = false;
    let fallback = "";
    try {
      const claudeExecutable = findClaudeCode();
      const options: Options = {
        model: input.model || this.defaultModel,
        systemPrompt: input.systemPrompt,
        tools: [],
        mcpServers: {
          cockpit: {
            type: "http",
            url: input.mcp.url,
            headers: { Authorization: `Bearer ${input.mcp.token}` },
          },
        },
        strictMcpConfig: true,
        allowedTools: input.tools.map((name) => `mcp__cockpit__${name}`),
        permissionMode: "dontAsk",
        settingSources: [],
        cwd: await this.cwdPromise,
        includePartialMessages: true,
        abortController: controller,
        maxTurns: MAX_TURNS,
        effort: "medium",
        ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
        ...(input.resume ? { resume: input.resume } : {}),
      };
      query = this.query({ prompt: input.userPrompt, options });
      for await (const message of query) {
        if (signal.aborted) return;
        if (message.type === "result" && message.subtype === "success")
          fallback = resultText(message);
        // Text resumed after a tool call is a new block: keep it a new paragraph
        // instead of gluing it to the previous sentence ("…Mara).Ho messo").
        if (emittedText && startsTextBlock(message))
          yield { type: "text", text: "\n\n" };
        const events = mapClaudeMessage(message);
        for (const event of events) {
          if (event.type === "text") emittedText = true;
          yield event;
        }
      }
      if (!emittedText && fallback) yield { type: "text", text: fallback };
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      if (input.mcp.token && message.includes(input.mcp.token))
        throw new Error(
          "Il provider Claude ha restituito un errore con credenziali redatte.",
        );
      if (/auth|login|credential|api.?key/i.test(message))
        throw new Error("Claude non autenticato: esegui `claude auth login`.");
      throw new Error(message);
    } finally {
      signal.removeEventListener("abort", abort);
      query?.close();
      this.active.delete(controller);
    }
  }

  async status(): Promise<ProviderStatus> {
    if (this.statusCache && this.statusCache.until > Date.now())
      return this.statusCache.value;
    if (this.statusTask) return this.statusTask;
    this.statusTask = this.inspectStatus();
    try {
      const value = await this.statusTask;
      this.statusCache = {
        value,
        until:
          Date.now() +
          (value.available ? STATUS_CACHE_MS : STATUS_FAILURE_CACHE_MS),
      };
      return value;
    } finally {
      this.statusTask = undefined;
    }
  }

  private async inspectStatus(): Promise<ProviderStatus> {
    try {
      const { stdout } = await execFileAsync(
        findClaudeCode() ?? "claude",
        ["auth", "status", "--json"],
        { timeout: STATUS_TIMEOUT_MS, maxBuffer: 64 * 1024 },
      );
      const status: unknown = JSON.parse(stdout);
      const loggedIn =
        typeof status === "object" &&
        status !== null &&
        "loggedIn" in status &&
        status.loggedIn === true;
      return loggedIn
        ? { id: this.id, available: true, model: this.defaultModel }
        : {
            id: this.id,
            available: false,
            model: this.defaultModel,
            error: "Claude non autenticato: esegui `claude auth login`.",
          };
    } catch {
      return {
        id: this.id,
        available: false,
        model: this.defaultModel,
        error: "Claude CLI non disponibile o non autenticato.",
      };
    }
  }

  async close() {
    for (const controller of this.active) controller.abort();
    this.active.clear();
  }
}
