// Card interpreter: one background job per creature sheet that has no action card yet. Each job
// gives the sheet's public text to a cheap model, which publishes the card with combat_card_set.
// Identical sheets share one job; the pending set tells the combat view what is being read.
import { randomUUID } from "node:crypto";
import type { TurnTokens } from "./mcp.js";
import type { Provider } from "./providers/provider.js";
import type { CockpitBattle } from "./ports.js";
import { CARD_TOOL_NAMES } from "./tools.js";
import { buildCardSystemPrompt, buildCardUserPrompt } from "./prompt.js";

export interface CardInterpreterDeps {
  provider: Provider | undefined;
  tokens: TurnTokens;
  mcpUrl: string;
  battle?: Pick<CockpitBattle, "card" | "cardSource">;
  model: string;
  language: string;
  systemName: string | null;
  /** Called whenever the set of pending sheets changes. */
  onChange(): void;
  log?(message: string): void;
  timeoutMs?: number; // default 120_000
}

interface Job {
  controller: AbortController;
  promise: Promise<void>;
}

export class CardInterpreter {
  private jobs = new Map<string, Job>();

  constructor(private deps: CardInterpreterDeps) {}

  /** Starts one job per sheet that has no valid card and no job running. Never throws, never awaits the jobs. */
  request(sessionId: string, sheets: readonly string[]): void {
    const { provider, battle } = this.deps;
    if (!provider || !battle?.card || !battle.cardSource) return;
    for (const sheet of new Set(sheets)) {
      if (this.jobs.has(sheet)) continue;
      const job: Job = { controller: new AbortController(), promise: Promise.resolve() };
      // Pending is set synchronously, so a second request for the same sheet starts no job.
      this.jobs.set(sheet, job);
      this.deps.onChange();
      job.promise = this.run(sessionId, sheet, job);
    }
  }

  /** Sheets with a job running. */
  pending(): ReadonlySet<string> {
    return new Set(this.jobs.keys());
  }

  /** Resolves when every running job has finished (for tests). */
  async idle(): Promise<void> {
    while (this.jobs.size > 0) {
      await Promise.all([...this.jobs.values()].map((job) => job.promise));
    }
  }

  /** Aborts every running job. */
  close(): void {
    for (const job of this.jobs.values()) job.controller.abort();
  }

  private async run(sessionId: string, sheet: string, job: Job): Promise<void> {
    const { provider, tokens, mcpUrl, battle, model, language, systemName, onChange, log } = this.deps;
    const { controller } = job;
    let token: string | undefined;
    const timeout = setTimeout(() => controller.abort(), this.deps.timeoutMs ?? 120_000);
    try {
      if (await battle!.card!(sheet)) return;
      const source = await battle!.cardSource!(sheet);
      if (!source) return;
      const turnId = randomUUID();
      token = tokens.issue({
        sessionId,
        turnId,
        tools: CARD_TOOL_NAMES,
        onActivity() {},
        setGroupId() {},
      });
      const signal = controller.signal;
      const consume = async () => {
        for await (const _ of provider!.run(
          {
            sessionId,
            turnId,
            model,
            systemPrompt: buildCardSystemPrompt({ language, systemName }),
            userPrompt: buildCardUserPrompt(sheet, source.text),
            mcp: { url: mcpUrl, token: token! },
            tools: CARD_TOOL_NAMES,
          },
          signal,
        )) {
          // Events are not needed: the card arrives through combat_card_set.
        }
      };
      // A provider that ignores the signal must not keep the job pending past its timeout.
      const aborted = new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error("interrotto (tempo massimo o chiusura)"));
        signal.addEventListener(
          "abort",
          () => reject(new Error("interrotto (tempo massimo o chiusura)")),
          { once: true },
        );
      });
      aborted.catch(() => {});
      await Promise.race([consume(), aborted]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log?.(`card ${sheet}: ${message}`);
    } finally {
      clearTimeout(timeout);
      if (token) tokens.revoke(token);
      if (this.jobs.get(sheet) === job) this.jobs.delete(sheet);
      onChange();
    }
  }
}
