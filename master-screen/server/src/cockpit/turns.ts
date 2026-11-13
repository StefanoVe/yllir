import { randomUUID } from "node:crypto";
import type {
  ActionSummary,
  ChatMessage,
  CockpitSession,
  ProviderId,
  RuntimeStatus,
  Turn,
  TurnActivity,
} from "../../../shared/src/cockpit-types.js";
import type { CockpitStore } from "./store.js";
import type { CockpitBus } from "./bus.js";
import type { Provider, ProviderEvent, TurnInput } from "./providers/provider.js";
import type { Resolver } from "./view.js";
import type { TurnTokens } from "./mcp.js";
import {
  COMBAT_TOOL_NAMES,
  TABLE_TOOL_NAMES,
  type ToolContext,
} from "./tools.js";
import type { PlotGraph } from "./ports.js";
import type { CombatRules } from "../../../shared/src/types.js";
import {
  buildCombatSystemPrompt,
  buildCombatUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from "./prompt.js";

const DEFAULT_IDLE_TIMEOUT_MS = 90_000;
const DEFAULT_TURN_TIMEOUT_MS = 300_000;
const TEXT_PERSIST_INTERVAL_MS = 500;
/** Actions that change the structure of the board (links, frames, frame membership). */
const STRUCTURAL_ACTIONS: ReadonlySet<ActionSummary["type"]> = new Set([
  "link.add",
  "link.remove",
  "frame.add",
  "frame.remove",
  "module.update",
]);
function sameActivity(a: TurnActivity, b: TurnActivity) {
  return a.kind === b.kind && a.tool === b.tool && a.label === b.label;
}
type QueuedTurn = { turnId: string; messageId: string; sessionId: string };
type RunningTurn = {
  turnId: string;
  controller: AbortController;
  cancelled: boolean;
  activity: TurnActivity;
  groupId?: string;
  providerTool: boolean;
  lastActivity: number;
  activityWrite: Promise<void>;
};

export interface TurnManagerDeps {
  store: CockpitStore;
  bus: CockpitBus;
  providers: Partial<Record<ProviderId, Provider>>;
  tokens: TurnTokens;
  resolve: Resolver;
  getPlotGraph(): PlotGraph;
  mcpUrl: string;
  /** System prompt of the campaign (language and game system). English without a campaign. */
  systemPrompt?: string;
  /** System prompt of combat threads. */
  combatSystemPrompt?: string;
  /** Fills the ledger and combat of a session from the framework before the digest is built. */
  hydrate?: (session: CockpitSession) => Promise<CockpitSession>;
  /** Condition and duration labels for the combat digest. Errors leave the digest without them. */
  combatRules?: () => Promise<CombatRules>;
  idleTimeoutMs?: number;
  turnTimeoutMs?: number;
}
const DEFAULT_SYSTEM_PROMPT = buildSystemPrompt({ language: "en", systemName: null });
const DEFAULT_COMBAT_SYSTEM_PROMPT = buildCombatSystemPrompt({ language: "en", systemName: null });
export class TurnManager {
  private queues = new Map<string, QueuedTurn[]>();
  private running = new Map<string, RunningTurn>();
  private pumping = new Set<string>();
  private clientRequests = new Map<
    string,
    Promise<{ turnId: string; messageId: string }>
  >();
  private pumpTasks = new Set<Promise<void>>();
  /** The execution promise of each session's running turn, awaited by cancel(). */
  private executions = new Map<string, Promise<void>>();
  private recovery: Promise<void>;
  private closed = false;
  private idleTimeoutMs: number;
  private turnTimeoutMs: number;
  constructor(private deps: TurnManagerDeps) {
    this.idleTimeoutMs = deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.turnTimeoutMs = deps.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    this.recovery = this.recover();
  }
  async submit(
    sessionId: string,
    text: string,
    clientId?: string,
  ): Promise<{ turnId: string; messageId: string }> {
    if (this.closed) throw new Error("Gestore turni chiuso");
    await this.recovery;
    if (clientId) {
      const prior = this.clientRequests.get(`${sessionId}:${clientId}`);
      if (prior) return prior;
    }
    const submission = this.createSubmission(sessionId, text, clientId);
    if (clientId)
      this.clientRequests.set(`${sessionId}:${clientId}`, submission);
    try {
      return await submission;
    } catch (error) {
      if (
        clientId &&
        this.clientRequests.get(`${sessionId}:${clientId}`) === submission
      )
        this.clientRequests.delete(`${sessionId}:${clientId}`);
      throw error;
    }
  }
  private async createSubmission(
    sessionId: string,
    text: string,
    clientId?: string,
  ): Promise<{ turnId: string; messageId: string }> {
    const turnId = randomUUID();
    const messageId = randomUUID();
    const now = new Date().toISOString();
    const message: ChatMessage = {
      id: messageId,
      role: "dm",
      text,
      at: now,
      turnId,
      status: "complete",
    };
    await this.deps.store.appendMessage(sessionId, message);
    const turn: Turn = { id: turnId, messageId, status: "queued" };
    await this.deps.store.upsertTurn(sessionId, turn);
    const result = { turnId, messageId };
    const queue = this.queues.get(sessionId) || [];
    queue.push({ sessionId, turnId, messageId });
    this.queues.set(sessionId, queue);
    const pump = this.pump(sessionId);
    this.pumpTasks.add(pump);
    void pump.finally(() => this.pumpTasks.delete(pump));
    return result;
  }
  private async pump(sessionId: string) {
    if (this.pumping.has(sessionId)) return;
    this.pumping.add(sessionId);
    try {
      while (!this.closed) {
        const queued = this.queues.get(sessionId)?.shift();
        if (!queued) break;
        const execution = this.execute(queued);
        this.executions.set(sessionId, execution);
        try {
          await execution;
        } finally {
          if (this.executions.get(sessionId) === execution)
            this.executions.delete(sessionId);
        }
      }
    } finally {
      this.pumping.delete(sessionId);
      if (!this.queues.get(sessionId)?.length) this.queues.delete(sessionId);
    }
  }
  private async setTurn(
    sessionId: string,
    turnId: string,
    patch: Partial<Turn>,
  ) {
    const session = await this.deps.store.get(sessionId);
    const current = session.turns.find((item) => item.id === turnId);
    if (!current) return;
    await this.deps.store.upsertTurn(sessionId, { ...current, ...patch });
  }
  private async persistMessage(sessionId: string, message: ChatMessage) {
    await this.deps.store.updateMessage(sessionId, message.id, message);
  }
  private async execute(job: QueuedTurn) {
    const { sessionId, turnId, messageId } = job;
    const controller = new AbortController();
    const run: RunningTurn = {
      turnId,
      controller,
      cancelled: false,
      activity: { kind: "thinking" },
      providerTool: false,
      lastActivity: Date.now(),
      activityWrite: Promise.resolve(),
    };
    this.running.set(sessionId, run);
    let providerSession: CockpitSession;
    try {
      providerSession = await this.deps.store.get(sessionId);
    } catch {
      this.running.delete(sessionId);
      return;
    }
    const combatThread =
      providerSession.kind === "combat" && providerSession.parentId
        ? providerSession.parentId
        : undefined;
    /** The session whose state the tools change: the table for a combat thread. */
    const stateSessionId = combatThread ?? sessionId;
    const toolNames = combatThread ? COMBAT_TOOL_NAMES : TABLE_TOOL_NAMES;
    const provider = this.deps.providers[providerSession.provider];
    if (!provider) {
      await this.finishError(job, "Provider non configurato");
      this.running.delete(sessionId);
      return;
    }
    const startedAt = new Date().toISOString();
    await this.setTurn(sessionId, turnId, {
      status: "running",
      activity: run.activity,
      startedAt,
    });
    const agentMessage: ChatMessage = {
      id: randomUUID(),
      role: "agent",
      text: "",
      at: startedAt,
      turnId,
      status: "streaming",
    };
    await this.deps.store.appendMessage(sessionId, agentMessage);
    let content = "";
    let lastPersist = Date.now();
    let persistInFlight: Promise<void> | undefined;
    let pendingPersist: ReturnType<typeof setTimeout> | undefined;
    let terminalError: string | undefined;
    const persist = async () => {
      if (pendingPersist) {
        clearTimeout(pendingPersist);
        pendingPersist = undefined;
      }
      if (persistInFlight) return;
      lastPersist = Date.now();
      const snapshot: ChatMessage = {
        ...agentMessage,
        text: content,
        status: "streaming",
      };
      const write = this.persistMessage(sessionId, snapshot);
      persistInFlight = write;
      try {
        await write;
      } finally {
        if (persistInFlight === write) persistInFlight = undefined;
      }
    };
    const persistSafely = () => {
      void persist().catch((error: unknown) => {
        terminalError = error instanceof Error ? error.message : String(error);
        controller.abort();
      });
    };
    const touch = () => {
      run.lastActivity = Date.now();
      if (terminalError?.startsWith("Il modello non risponde"))
        terminalError = undefined;
      armIdle();
    };
    let idleTimer: ReturnType<typeof setTimeout>;
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (Date.now() - run.lastActivity >= this.idleTimeoutMs) {
          terminalError = `Il modello non risponde da ${Math.ceil(this.idleTimeoutMs / 1000)} s: turno interrotto`;
          controller.abort();
        }
      }, this.idleTimeoutMs);
    };
    armIdle();
    const totalTimer = setTimeout(() => {
      terminalError = "Il turno ha superato il tempo massimo";
      controller.abort();
    }, this.turnTimeoutMs);
    const toolContext: ToolContext = {
      get groupId() {
        return run.groupId;
      },
      sessionId: stateSessionId,
      turnId,
      tools: toolNames,
      onActivity: (label) => {
        const activity: TurnActivity = { kind: "tool", label };
        if (!sameActivity(run.activity, activity)) {
          run.activity = activity;
          run.activityWrite = run.activityWrite.then(() =>
            this.setTurn(sessionId, turnId, { activity }),
          );
        }
        run.providerTool = true;
        touch();
      },
      setGroupId: (id) => {
        run.groupId = id;
      },
    };
    const token = this.deps.tokens.issue(toolContext);
    let resume = providerSession.providerSessionId;
    try {
      let attempt = 0;
      while (true) {
        const stored = await this.deps.store.get(sessionId);
        let input: TurnInput;
        if (combatThread) {
          const table = this.deps.hydrate
            ? await this.deps.hydrate(await this.deps.store.get(combatThread))
            : await this.deps.store.get(combatThread);
          const userMessage = stored.messages.find(
            (item) => item.id === messageId,
          )!;
          const rules = this.deps.combatRules
            ? await this.deps.combatRules().catch(() => undefined)
            : undefined;
          input = {
            sessionId,
            turnId,
            model: stored.model,
            systemPrompt:
              this.deps.combatSystemPrompt ?? DEFAULT_COMBAT_SYSTEM_PROMPT,
            userPrompt: buildCombatUserPrompt(table, stored, userMessage, { rules }),
            mcp: { url: this.deps.mcpUrl, token },
            tools: COMBAT_TOOL_NAMES,
            ...(resume ? { resume } : {}),
          };
        } else {
          const latest = this.deps.hydrate
            ? await this.deps.hydrate(stored)
            : stored;
          const userMessage = latest.messages.find(
            (item) => item.id === messageId,
          )!;
          const source = latest.state.position.source;
          const plotNeighbors = source
            ? this.plotNeighbors(source.path, source.anchor)
            : undefined;
          input = {
            sessionId,
            turnId,
            model: latest.model,
            systemPrompt: this.deps.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
            userPrompt: buildUserPrompt(latest, userMessage, {
              resolve: this.deps.resolve,
              ...(plotNeighbors ? { plotNeighbors } : {}),
            }),
            mcp: { url: this.deps.mcpUrl, token },
            tools: TABLE_TOOL_NAMES,
            ...(resume ? { resume } : {}),
          };
        }
        try {
          const iterator = provider
            .run(input, controller.signal)
            [Symbol.asyncIterator]();
          while (true) {
            if (controller.signal.aborted)
              throw new Error(terminalError || "Turno annullato");
            const next = await this.nextOrAbort(
              iterator,
              controller.signal,
              () => terminalError || "Turno annullato",
            );
            if (next.done) break;
            const event = next.value;
            touch();
            await run.activityWrite;
            await this.handleProviderEvent(
              event,
              job,
              run,
              agentMessage,
              (appendText) => {
                content += appendText;
                this.deps.bus.publish(sessionId, {
                  type: "delta",
                  messageId: agentMessage.id,
                  text: appendText,
                });
                if (Date.now() - lastPersist >= TEXT_PERSIST_INTERVAL_MS)
                  persistSafely();
                else if (!pendingPersist)
                  pendingPersist = setTimeout(
                    persistSafely,
                    TEXT_PERSIST_INTERVAL_MS - (Date.now() - lastPersist),
                  );
              },
            );
          }
          break;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          if (
            resume &&
            attempt === 0 &&
            content === "" &&
            run.groupId === undefined
          ) {
            attempt++;
            resume = undefined;
            await this.deps.store.setProviderSession(sessionId, {
              providerSessionId: undefined,
            });
            continue;
          }
          throw error;
        }
      }
      await run.activityWrite;
      if (run.cancelled) {
        agentMessage.status = "cancelled";
        agentMessage.text = content;
      } else {
        agentMessage.status = "complete";
        if (run.groupId && !combatThread)
          await this.arrangeAfterStructuralChanges(
            sessionId,
            turnId,
            run.groupId,
          );
        const actions = this.groupActions(
          await this.deps.store.get(stateSessionId),
          turnId,
        );
        agentMessage.actions = actions;
        if (!content.trim())
          agentMessage.text = actions.length
            ? actions.map((action) => action.label).join("; ")
            : "Nessuna modifica.";
        else agentMessage.text = content;
      }
      await this.persistMessage(sessionId, agentMessage);
      await this.setTurn(sessionId, turnId, {
        status: run.cancelled ? "cancelled" : "done",
        activity: undefined,
        endedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message =
        terminalError ||
        (run.cancelled
          ? "Turno annullato"
          : error instanceof Error
            ? error.message
            : String(error));
      agentMessage.status = run.cancelled ? "cancelled" : "error";
      agentMessage.text = content ? `${content}\n\n${message}` : message;
      await this.persistMessage(sessionId, agentMessage);
      await this.setTurn(sessionId, turnId, {
        status: run.cancelled ? "cancelled" : "error",
        error: run.cancelled ? undefined : message,
        activity: undefined,
        endedAt: new Date().toISOString(),
      });
    } finally {
      clearTimeout(idleTimer!);
      clearTimeout(totalTimer);
      if (pendingPersist) clearTimeout(pendingPersist);
      this.deps.tokens.revoke(token);
      if (this.running.get(sessionId) === run) this.running.delete(sessionId);
    }
  }
  private nextOrAbort<T>(
    iterator: AsyncIterator<T>,
    signal: AbortSignal,
    message: () => string,
  ) {
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      const abort = () => reject(new Error(message()));
      signal.addEventListener("abort", abort, { once: true });
      iterator
        .next()
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  }
  private async handleProviderEvent(
    event: ProviderEvent,
    job: QueuedTurn,
    run: RunningTurn,
    message: ChatMessage,
    append: (text: string) => void,
  ) {
    if (event.type === "session") {
      await this.deps.store.setProviderSession(job.sessionId, {
        providerSessionId: event.id,
      });
      return;
    }
    if (event.type === "text") {
      run.providerTool = false;
      await this.updateActivity(job.sessionId, job.turnId, run, {
        kind: "writing",
      });
      append(event.text);
      return;
    }
    if (event.type === "tool") {
      if (!run.providerTool) {
        await this.updateActivity(job.sessionId, job.turnId, run, {
          kind: "tool",
          tool: event.name,
          label: `Strumento · ${event.name.replace(/^mcp__cockpit__/, "")}`,
        });
      }
      return;
    }
    run.providerTool = false;
    await this.updateActivity(job.sessionId, job.turnId, run, {
      kind: "thinking",
    });
  }
  private async updateActivity(
    sessionId: string,
    turnId: string,
    run: RunningTurn,
    activity: TurnActivity,
  ) {
    if (sameActivity(run.activity, activity)) return;
    run.activity = activity;
    await this.setTurn(sessionId, turnId, { activity });
  }
  /**
   * Re-runs the automatic layout, in the turn's own action group, once the turn
   * changed the structure of the board: the agent never positions cards itself.
   * Skipped when the group already ends its structural changes with an arrange.
   * A failure is logged and never fails the turn.
   */
  private async arrangeAfterStructuralChanges(
    sessionId: string,
    turnId: string,
    groupId: string,
  ) {
    try {
      const session = await this.deps.store.get(sessionId);
      const group = session.history.find(
        (item) => item.id === groupId && !item.undone,
      );
      if (!group) return;
      let lastStructural = -1;
      group.actions.forEach((action, index) => {
        if (STRUCTURAL_ACTIONS.has(action.type)) lastStructural = index;
      });
      if (lastStructural < 0) return;
      if (
        group.actions
          .slice(lastStructural + 1)
          .some((action) => action.type === "board.arrange")
      )
        return;
      await this.deps.store.apply(sessionId, [{ type: "board.arrange" }], {
        origin: "agent",
        turnId,
        groupId,
      });
    } catch (error) {
      console.error(
        "Riordino automatico della scrivania non riuscito:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  private groupActions(
    session: CockpitSession,
    turnId: string,
  ): ActionSummary[] {
    return session.history
      .filter((group) => group.turnId === turnId && !group.undone)
      .flatMap((group) => group.actions);
  }
  private plotNeighbors(path: string, anchor?: string) {
    const graph = this.deps.getPlotGraph();
    const node = graph.nodes.find(
      (item) =>
        item.target?.path === path &&
        (!anchor || item.target.anchor === anchor),
    );
    if (!node) return undefined;
    const targetLabel = (id: string) => {
      const target = graph.nodes.find((item) => item.id === id);
      if (!target) return undefined;
      const suffix = target.target
        ? ` (${target.target.path}#${target.target.anchor})`
        : "";
      return `${target.title}${suffix}`;
    };
    return {
      predecessors: graph.edges
        .filter((edge) => edge.to === node.id && edge.relation !== "membership")
        .map((edge) => targetLabel(edge.from))
        .filter((label): label is string => !!label),
      successors: graph.edges
        .filter(
          (edge) => edge.from === node.id && edge.relation !== "membership",
        )
        .map((edge) => targetLabel(edge.to))
        .filter((label): label is string => !!label),
    };
  }
  private async finishError(job: QueuedTurn, message: string) {
    const agentMessage: ChatMessage = {
      id: randomUUID(),
      role: "agent",
      text: message,
      at: new Date().toISOString(),
      turnId: job.turnId,
      status: "error",
    };
    await this.deps.store.appendMessage(job.sessionId, agentMessage);
    await this.setTurn(job.sessionId, job.turnId, {
      status: "error",
      error: message,
      endedAt: new Date().toISOString(),
    });
  }
  async cancel(sessionId: string, turnId: string) {
    const queue = this.queues.get(sessionId) || [];
    const index = queue.findIndex((item) => item.turnId === turnId);
    if (index >= 0) {
      const [job] = queue.splice(index, 1);
      if (!queue.length) this.queues.delete(sessionId);
      const message: ChatMessage = {
        id: randomUUID(),
        role: "agent",
        text: "Turno annullato",
        at: new Date().toISOString(),
        turnId,
        status: "cancelled",
      };
      await this.deps.store.appendMessage(sessionId, message);
      await this.setTurn(sessionId, turnId, {
        status: "cancelled",
        endedAt: new Date().toISOString(),
      });
      return;
    }
    const active = this.running.get(sessionId);
    if (active?.turnId === turnId) {
      active.cancelled = true;
      active.controller.abort();
      // Resolve only once the turn is persisted as cancelled, so a client reading
      // the session right after this call never sees it still running.
      await this.executions.get(sessionId);
      return;
    }
    throw new Error("Turno non attivo o non trovato");
  }
  async recover() {
    for (const summary of await this.deps.store.list()) {
      const session = await this.deps.store.get(summary.id);
      for (const turn of session.turns.filter(
        (item) => item.status === "queued" || item.status === "running",
      )) {
        const message = session.messages.find(
          (item) => item.turnId === turn.id && item.role === "agent",
        );
        if (message) {
          message.status = "error";
          message.text = "Turno interrotto dal riavvio del server";
          await this.deps.store.updateMessage(session.id, message.id, message);
        } else {
          await this.deps.store.appendMessage(session.id, {
            id: randomUUID(),
            role: "agent",
            text: "Turno interrotto dal riavvio del server",
            at: new Date().toISOString(),
            turnId: turn.id,
            status: "error",
          });
        }
        await this.deps.store.upsertTurn(session.id, {
          ...turn,
          status: "error",
          error: "Turno interrotto dal riavvio del server",
          endedAt: new Date().toISOString(),
        });
      }
    }
  }
  async runtime(sessionId?: string): Promise<RuntimeStatus> {
    const session = sessionId
      ? await this.deps.store.get(sessionId)
      : undefined;
    const statuses = await Promise.all(
      Object.values(this.deps.providers)
        .filter((provider): provider is Provider => !!provider)
        .map((provider) => provider.status()),
    );
    const selected = session?.provider || statuses[0]?.id || "claude";
    const provider = this.deps.providers[selected];
    return {
      provider: selected,
      model: session?.model || provider?.defaultModel || "",
      providers: statuses,
    };
  }
  hasRunningSession(sessionId: string) {
    return this.running.has(sessionId);
  }
  async close() {
    this.closed = true;
    await this.recovery;
    for (const [sessionId, run] of this.running) {
      run.cancelled = true;
      run.controller.abort();
    }
    for (const [sessionId, queue] of this.queues) {
      for (const job of queue) {
        await this.deps.store.appendMessage(job.sessionId, {
          id: randomUUID(),
          role: "agent",
          text: "Turno annullato alla chiusura del server",
          at: new Date().toISOString(),
          turnId: job.turnId,
          status: "cancelled",
        });
        await this.setTurn(sessionId, job.turnId, {
          status: "cancelled",
          endedAt: new Date().toISOString(),
        });
      }
      queue.length = 0;
    }
    await Promise.allSettled([...this.pumpTasks]);
  }
}
