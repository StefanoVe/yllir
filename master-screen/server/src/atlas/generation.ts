// The atlas assistant: one dedicated chat conversation per run, with the fixed prompt of its mode.
// The state follows the chat turns of that conversation, as the alignment does. No model override:
// the chat's default (main) model runs it, because the atlas is judgement work. Owner: master-screen server.
import type { AtlasGenerationState, AtlasStatus, Turn } from '../../../shared/src/types.js';
import type { ChatService } from '../chat/index.js';
import { TEXTS as CHAT_TEXTS, type Lang } from '../chat/text.js';
import type { AgentStatus } from '../context.js';
import { ATLAS_PROMPTS, ATLAS_TEXTS } from './texts.js';

export type AtlasMode = 'create' | 'update';
export type AtlasGenerationSnapshot = AtlasStatus['generation'];
export type AtlasStartResult =
  | { ok: true; conversationId: string }
  | { ok: false; code: 409 | 503; error: string };

/** What the framework says about the atlas now. */
export interface AtlasFrameworkState {
  exists: boolean;
  /** True when the first generated layer of the atlas (terrain or ground) is locked by the master. */
  approved: boolean;
  pending: number;
}

export interface AtlasGenerationDeps {
  /** A fresh reading of the framework (never cached). Rejects when it cannot be read. */
  framework(): Promise<AtlasFrameworkState>;
  /** The text of the last assistant message of a conversation, or null. */
  lastAnswer(conversationId: string): string | null;
  chat(): ChatService | null;
  agent(): AgentStatus;
  language(): Lang;
  onTurn(listener: (turn: Turn) => void): void;
  /** Tells the screen that the conversations changed. */
  notify(): void;
  log(msg: string): void;
}

type Phase = Exclude<AtlasGenerationState, 'idle'>;

/** True when the assistant's last words are a question, so it waits for the master. */
export function asksQuestion(text: string | null): boolean {
  if (text === null) return false;
  return /[?？]\s*$/.test(text.trim());
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class AtlasGenerationService {
  private phase: Phase | null = null;
  private mode: AtlasMode | null = null;
  private conversationId: string | null = null;
  /** Turns of the atlas conversation that are queued or running. */
  private readonly open = new Set<string>();
  private starting = false;

  constructor(private readonly deps: AtlasGenerationDeps) {
    deps.onTurn((turn) => this.onTurn(turn));
  }

  /** True while a run is starting, running, or waiting for the master's answer. */
  running(): boolean {
    return this.starting || this.phase === 'running' || this.phase === 'waiting-answer';
  }

  snapshot(): AtlasGenerationSnapshot {
    return { state: this.phase ?? 'idle', conversationId: this.conversationId, mode: this.mode };
  }

  /** Starts a run in a new conversation. Refused while another run is active, or when the mode does not fit the atlas. */
  async start(mode: AtlasMode): Promise<AtlasStartResult> {
    const lang = this.deps.language();
    const texts = ATLAS_TEXTS[lang];
    if (this.running()) return { ok: false, code: 409, error: texts.alreadyRunning };
    this.starting = true;
    try {
      const framework = await this.deps.framework();
      if (mode === 'create' && framework.exists) return { ok: false, code: 409, error: texts.alreadyExists };
      if (mode === 'update' && !framework.exists) return { ok: false, code: 409, error: texts.noAtlas };

      const chat = this.deps.chat();
      const agent = this.deps.agent();
      if (chat === null || !agent.available) {
        return { ok: false, code: 503, error: agent.reason ?? CHAT_TEXTS[lang].unavailable };
      }
      const previous = { phase: this.phase, mode: this.mode, conversationId: this.conversationId };
      let conversation;
      try {
        conversation = await chat.store.createConversation();
      } catch (err) {
        this.deps.log(`atlas conversation could not be created: ${errorText(err)}`);
        return { ok: false, code: 503, error: texts.startFailed };
      }
      this.conversationId = conversation.id;
      this.mode = mode;
      this.phase = 'running';
      this.deps.notify();
      const submitted = await chat.runner.submit(conversation.id, ATLAS_PROMPTS[mode], {});
      if (submitted === null) {
        this.phase = previous.phase;
        this.mode = previous.mode;
        this.conversationId = previous.conversationId;
        return { ok: false, code: 503, error: CHAT_TEXTS[lang].closing };
      }
      return { ok: true, conversationId: conversation.id };
    } finally {
      this.starting = false;
    }
  }

  private onTurn(turn: Turn): void {
    if (this.conversationId === null || turn.conversationId !== this.conversationId) return;
    if (turn.state === 'queued' || turn.state === 'running') {
      this.open.add(turn.id);
      this.phase = 'running';
      return;
    }
    this.open.delete(turn.id);
    this.deps.notify();
    if (this.open.size === 0) void this.settle(turn.state);
  }

  /**
   * Decides the state when the atlas turns have ended. A finished turn is 'done' when the atlas
   * exists, its first layer is approved (locked) and the assistant's last message is not a question;
   * otherwise the master is asked to answer. Places may legitimately stay unplaced, so pending places
   * do not block 'done'. A turn that did not finish is 'failed'.
   */
  private async settle(outcome: Turn['state']): Promise<void> {
    let finished = false;
    if (outcome === 'done') {
      finished = await this.isFinished().catch((err: unknown) => {
        this.deps.log(`atlas status failed: ${errorText(err)}`);
        return false;
      });
    }
    if (this.open.size > 0) return; // a new turn started while the check ran
    this.phase = outcome === 'done' ? (finished ? 'done' : 'waiting-answer') : 'failed';
    this.deps.notify();
  }

  private async isFinished(): Promise<boolean> {
    if (this.conversationId === null) return false;
    if (asksQuestion(this.deps.lastAnswer(this.conversationId))) return false;
    const framework = await this.deps.framework();
    return framework.exists && framework.approved;
  }
}
