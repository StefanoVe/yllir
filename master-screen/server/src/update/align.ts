// Campaign alignment after a framework update: the assistant runs the update skill's steps in one
// dedicated chat conversation (sonnet, one fixed prompt), and this service keeps the state the screen
// shows. The state follows the chat turns of that conversation: a turn that starts makes it running,
// and when the turns end the framework is asked again. The update itself never starts while it runs
// or waits for the master. Owner: update engineer.
import type { AlignState, AlignStatus, Turn } from '../../../shared/src/types.js';
import type { ChatService } from '../chat/index.js';
import { campaignLanguage, TEXTS as CHAT_TEXTS, type Lang } from '../chat/text.js';
import type { Ctx } from '../context.js';
import { runAlignCheck } from './align-check.js';
import { ALIGN_MODEL, ALIGN_PROMPT, ALIGN_TEXTS } from './align-text.js';

/** How long a 'needed' or 'none' answer of the framework check is kept while nothing runs. */
export const ALIGN_CACHE_MS = 30_000;

type Phase = 'running' | 'waiting-answer' | 'done' | 'failed';
type StartResult = { ok: true; status: AlignStatus } | { ok: false; code: 409 | 503; error: string };

export interface AlignDeps {
  now(): number;
  /** True when the campaign still needs the alignment. Rejects when the framework cannot be asked. */
  check(): Promise<boolean>;
  /** The chat service of the campaign; null when the chat routes are not registered. */
  chat(): ChatService | null;
  agent(): { available: boolean; reason?: string };
  language(): Lang;
  onTurn(listener: (turn: Turn) => void): void;
  /** Tells the screen that the conversations changed (a new conversation). */
  notify(): void;
  log(msg: string): void;
}

export class AlignService {
  private phase: Phase | null = null;
  private conversationId: string | null = null;
  /** Turns of the alignment conversation that are queued or running. */
  private readonly open = new Set<string>();
  private starting = false;
  private cache: { at: number; needed: boolean } | null = null;
  private inflight: Promise<boolean> | null = null;

  constructor(private readonly deps: AlignDeps) {
    deps.onTurn((turn) => this.onTurn(turn));
  }

  /** True while an alignment runs or waits for the master: the framework update must not start then. */
  busy(): boolean {
    return this.phase === 'running' || this.phase === 'waiting-answer';
  }

  /** The sentence that refuses a framework update now, or null when the update may start. */
  applyBlocked(): string | null {
    return this.busy() ? ALIGN_TEXTS[this.deps.language()].alignBusy : null;
  }

  /** The current state. While a run is active nothing is asked of the framework. */
  async status(): Promise<AlignStatus> {
    if (this.busy()) return { state: this.phase as AlignState, conversationId: this.conversationId };
    const needed = await this.needed().catch((err: unknown) => {
      this.deps.log(`alignment check failed: ${errorText(err)}`);
      return false;
    });
    if (needed) {
      return this.phase === 'failed'
        ? { state: 'failed', conversationId: this.conversationId }
        : { state: 'needed', conversationId: null };
    }
    return this.phase === 'done'
      ? { state: 'done', conversationId: this.conversationId }
      : { state: 'none', conversationId: null };
  }

  /**
   * Starts the alignment in a new conversation. Allowed when the state is 'needed', or 'failed' (a retry).
   * The conversation is created first and its one turn is queued behind any other chat turn.
   */
  async start(): Promise<StartResult> {
    const lang = this.deps.language();
    const texts = ALIGN_TEXTS[lang];
    if (this.busy() || this.starting) return { ok: false, code: 409, error: texts.alreadyRunning };
    this.starting = true;
    try {
      const current = await this.status();
      if (current.state !== 'needed' && current.state !== 'failed') {
        return { ok: false, code: 409, error: texts.notNeeded };
      }
      const chat = this.deps.chat();
      const agent = this.deps.agent();
      if (chat === null || !agent.available) {
        return { ok: false, code: 503, error: agent.reason ?? CHAT_TEXTS[lang].unavailable };
      }
      const previous = this.phase;
      let conversation;
      try {
        conversation = await chat.store.createConversation();
      } catch (err) {
        this.deps.log(`alignment conversation could not be created: ${errorText(err)}`);
        return { ok: false, code: 503, error: texts.startFailed };
      }
      this.conversationId = conversation.id;
      this.phase = 'running';
      this.cache = null;
      this.deps.notify();
      const submitted = await chat.runner.submit(conversation.id, ALIGN_PROMPT, { model: ALIGN_MODEL });
      if (submitted === null) {
        this.phase = previous;
        return { ok: false, code: 503, error: CHAT_TEXTS[lang].closing };
      }
      return { ok: true, status: { state: 'running', conversationId: conversation.id } };
    } finally {
      this.starting = false;
    }
  }

  private onTurn(turn: Turn): void {
    if (this.conversationId === null || turn.conversationId !== this.conversationId) return;
    if (turn.state === 'queued' || turn.state === 'running') {
      this.open.add(turn.id);
      this.phase = 'running';
      this.cache = null;
      return;
    }
    this.open.delete(turn.id);
    this.cache = null;
    if (this.open.size === 0) void this.settle(turn.state);
  }

  /** Decides the state when the alignment turns have ended. */
  private async settle(outcome: Turn['state']): Promise<void> {
    const needed = await this.needed(true).catch((err: unknown) => {
      this.deps.log(`alignment check failed: ${errorText(err)}`);
      return true; // unknown means not aligned yet
    });
    if (this.open.size > 0) return; // a new turn of the alignment started while the check ran
    if (!needed) this.phase = 'done';
    else this.phase = outcome === 'done' ? 'waiting-answer' : 'failed';
  }

  private needed(fresh = false): Promise<boolean> {
    if (!fresh && this.cache !== null && this.deps.now() - this.cache.at < ALIGN_CACHE_MS) {
      return Promise.resolve(this.cache.needed);
    }
    if (!fresh && this.inflight !== null) return this.inflight;
    const check = this.deps.check().then((needed) => {
      this.cache = { at: this.deps.now(), needed };
      return needed;
    });
    const pending = check.finally(() => {
      if (this.inflight === pending) this.inflight = null;
    });
    this.inflight = pending;
    return pending;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createAlignService(ctx: Ctx, overrides: Partial<AlignDeps> = {}): AlignService {
  return new AlignService({
    now: () => Date.now(),
    check: () => runAlignCheck(ctx.campaignRoot, ctx.frameworkRoot),
    chat: () => ctx.chat,
    agent: () => ctx.agentStatus(),
    language: () => campaignLanguage(ctx.campaignRoot),
    onTurn: (listener) => ctx.onTurn(listener),
    notify: () => ctx.bus.publish('conversations', {}),
    log: (msg) => ctx.log(msg),
    ...overrides,
  });
}
