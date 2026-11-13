// Turn queue: one agent turn at a time, FIFO. Owns the turn lifecycle (queued, running,
// done, error, cancelled), the idle and hard time limits, cancellation, the steps of a turn
// and the bus events of the chat. Owner: chat engineer.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ChatChoice, ChatMessage, Turn, TurnStep } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import type { AgentEvent, AgentProvider } from '../agent/provider.js';
import { stripLeadingNarration } from '../agent/answer.js';
import { safeSentence } from './activity.js';
import { validateOpenPath } from './paths.js';
import type { ChatStore } from './store.js';
import { TEXTS, type Lang } from './text.js';

export const IDLE_TIMEOUT_MS = 120_000;
export const HARD_LIMIT_MS = 600_000;
/** While a step of kind 'image' is running, image generation can take minutes with no events. */
export const IMAGE_IDLE_TIMEOUT_MS = 480_000;
export const IMAGE_HARD_LIMIT_MS = 1_200_000;
/** The live list of steps of one turn keeps the newest ones only. */
export const MAX_STEPS = 60;

export interface TurnsOptions {
  ctx: Ctx;
  provider: AgentProvider;
  store: ChatStore;
  lang: Lang;
  /** Overrides the idle limit of every turn, the image one included. */
  idleTimeoutMs?: number;
  /** Overrides the hard limit of every turn, the image one included. */
  hardLimitMs?: number;
  /** HEAD of the campaign repository; the default runs `git -C <campaign> rev-parse HEAD`. */
  headSha?: (campaignRoot: string) => Promise<string>;
}

export interface Submitted {
  messageId: string;
  turnId: string;
}

type StopReason = 'cancel' | 'idle' | 'hard';
type Outcome = { state: 'done' } | { state: 'cancelled' } | { state: 'error'; message: string };

interface Job {
  turn: Turn;
  conversationId: string;
  prompt: string;
  choice: ChatChoice;
  agentMessageId: string;
  text: string;
  fromSha: string;
  steps: TurnStep[];
  controller: AbortController | null;
  stop: StopReason | null;
  done: Promise<void> | null;
}

const ABORTED = Symbol('aborted');

/** HEAD of the campaign repository, or '' when there is no commit (not a repo, or an empty one). */
export function gitHeadSha(campaignRoot: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', campaignRoot, 'rev-parse', 'HEAD'],
      { timeout: 10_000, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => resolve(err ? '' : String(stdout).trim()),
    );
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function copySteps(steps: TurnStep[]): TurnStep[] {
  return steps.map((step) => ({ ...step }));
}

export class TurnRunner {
  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private readonly known = new Set<string>();
  private closed = false;
  private readonly idleMs: number;
  private readonly hardMs: number;
  private readonly imageIdleMs: number;
  private readonly imageHardMs: number;
  private readonly headSha: (campaignRoot: string) => Promise<string>;

  constructor(private readonly opts: TurnsOptions) {
    this.idleMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.hardMs = opts.hardLimitMs ?? HARD_LIMIT_MS;
    this.imageIdleMs = opts.idleTimeoutMs ?? IMAGE_IDLE_TIMEOUT_MS;
    this.imageHardMs = opts.hardLimitMs ?? IMAGE_HARD_LIMIT_MS;
    this.headSha = opts.headSha ?? gitHeadSha;
  }

  /** The turn that is queued or running (of the whole campaign), as a snapshot, or null. */
  current(): Turn | null {
    const job = this.running ?? this.queue[0] ?? null;
    return job ? { ...job.turn, steps: copySteps(job.steps) } : null;
  }

  /** The queued or running turn, only when it belongs to this conversation; otherwise null. */
  currentFor(conversationId: string): Turn | null {
    const turn = this.current();
    return turn && turn.conversationId === conversationId ? turn : null;
  }

  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Accepts a master message in a conversation: persists it there, publishes it and queues its turn.
   * The queue is one for the whole campaign (FIFO), so a turn runs only after the turns queued before it.
   * The choice of model and effort is passed to the provider for this turn only.
   * Resolves null once the runner is closing. The caller checks that the conversation exists.
   */
  async submit(conversationId: string, text: string, choice: ChatChoice = {}): Promise<Submitted | null> {
    if (this.closed) return null;
    const at = nowIso();
    const messageId = randomUUID();
    const turnId = randomUUID();
    const turn: Turn = {
      id: turnId,
      messageId,
      state: 'queued',
      activity: TEXTS[this.opts.lang].queued,
      startedAt: at,
      conversationId,
    };
    const job: Job = {
      turn,
      conversationId,
      prompt: text,
      choice,
      agentMessageId: randomUUID(),
      text: '',
      fromSha: '',
      steps: [],
      controller: null,
      stop: null,
      done: null,
    };
    const message: ChatMessage = { id: messageId, role: 'master', text, at, turnId };
    // The store call is made now, so messages keep their order even when persisted in parallel.
    await this.opts.store.addMessage(conversationId, message);
    this.known.add(turnId);
    this.queue.push(job);
    this.opts.ctx.bus.publish('message', { ...message, conversationId });
    this.publishTurn(job);
    this.pump();
    return { messageId, turnId };
  }

  /**
   * Cancels the running turn of one conversation (as cancel does) and drops its queued turns,
   * each published as cancelled. Turns of other conversations are not touched.
   */
  cancelConversation(conversationId: string): void {
    this.dropQueued(conversationId);
    if (this.running && this.running.conversationId === conversationId) {
      this.stop(this.running, 'cancel');
    }
  }

  /**
   * Resolves once no turn of this conversation is running or queued: it cancels them first, and
   * keeps waiting while a turn of the conversation is still running (a turn may be submitted meanwhile).
   */
  async settleConversation(conversationId: string): Promise<void> {
    for (;;) {
      this.cancelConversation(conversationId);
      const job = this.running;
      if (!job || job.conversationId !== conversationId || job.done === null) return;
      await job.done;
    }
  }

  /** Removes the queued turns of a conversation, publishing each as cancelled. */
  private dropQueued(conversationId: string): void {
    for (const job of this.queue.filter((j) => j.conversationId === conversationId)) {
      this.queue.splice(this.queue.indexOf(job), 1);
      job.turn.state = 'cancelled';
      job.turn.endedAt = nowIso();
      job.turn.activity = '';
      this.publishTurn(job);
    }
  }

  /** Cancels a queued or running turn. Returns false when this process has never seen the turn. */
  cancel(turnId: string): boolean {
    const index = this.queue.findIndex((job) => job.turn.id === turnId);
    if (index !== -1) {
      const [job] = this.queue.splice(index, 1);
      job.turn.state = 'cancelled';
      job.turn.endedAt = nowIso();
      job.turn.activity = '';
      this.publishTurn(job);
      return true;
    }
    if (this.running && this.running.turn.id === turnId) {
      this.stop(this.running, 'cancel');
      return true;
    }
    return this.known.has(turnId);
  }

  /** Shutdown: cancels the queue and the running turn, and waits until the running turn has ended. */
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue.splice(0)) {
      job.turn.state = 'cancelled';
      job.turn.endedAt = nowIso();
      job.turn.activity = '';
      this.publishTurn(job);
    }
    const running = this.running;
    if (running) {
      this.stop(running, 'cancel');
      await running.done;
    }
  }

  private pump(): void {
    if (this.running || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = job;
    job.controller = new AbortController();
    job.done = this.run(job).finally(() => {
      this.running = null;
      this.pump();
    });
  }

  private stop(job: Job, reason: StopReason): void {
    if (job.stop !== null || job.controller === null) return;
    job.stop = reason;
    job.controller.abort();
  }

  private publishTurn(job: Job): void {
    this.opts.ctx.bus.publish('turn', { ...job.turn, steps: copySteps(job.steps) });
  }

  private async run(job: Job): Promise<void> {
    const { ctx, provider, store, lang } = this.opts;
    const t = TEXTS[lang];
    const controller = job.controller as AbortController;
    const turn = job.turn;

    turn.state = 'running';
    turn.activity = t.preparing;
    turn.startedAt = nowIso();
    job.fromSha = await this.headSha(ctx.campaignRoot);
    turn.fromSha = job.fromSha;
    this.publishTurn(job);

    const imageRunning = (): boolean => job.steps.some((step) => step.kind === 'image' && step.state === 'running');
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdle = (): void => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => this.stop(job, 'idle'), imageRunning() ? this.imageIdleMs : this.idleMs);
    };
    // The hard limit is extended once, to the image limit, when an image is still being made at that point.
    let extended = false;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    const onHard = (): void => {
      if (!extended && imageRunning()) {
        extended = true;
        hardTimer = setTimeout(onHard, Math.max(0, this.imageHardMs - this.hardMs));
        return;
      }
      this.stop(job, 'hard');
    };
    hardTimer = setTimeout(onHard, this.hardMs);
    armIdle();

    const aborted = new Promise<typeof ABORTED>((resolve) => {
      if (controller.signal.aborted) resolve(ABORTED);
      else controller.signal.addEventListener('abort', () => resolve(ABORTED), { once: true });
    });

    let outcome: Outcome = { state: 'done' };
    let finished = false;
    let iterator: AsyncIterator<AgentEvent> | null = null;
    try {
      iterator = provider
        .run({
          prompt: job.prompt,
          cwd: ctx.campaignRoot,
          frameworkRoot: ctx.frameworkRoot,
          resumeId: store.resumeId(job.conversationId),
          model: job.choice.model,
          effort: job.choice.effort,
          signal: controller.signal,
        })
        [Symbol.asyncIterator]();
      while (!finished) {
        const step = await Promise.race([iterator.next(), aborted]);
        if (step === ABORTED) break;
        if (step.done) break;
        finished = await this.handle(job, step.value, (next) => {
          outcome = next;
        });
        // Re-armed after the event, so a step that starts an image already gets the image limit.
        if (!finished) armIdle();
      }
    } catch (err) {
      ctx.log(`agent turn failed: ${err instanceof Error ? err.message : String(err)}`);
      outcome = { state: 'error', message: t.genericError };
      finished = true;
    } finally {
      clearTimeout(hardTimer);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      if (!finished && iterator?.return) {
        // Not awaited: a provider stuck in a pending step must not hold the queue.
        void Promise.resolve()
          .then(() => iterator?.return?.())
          .catch(() => undefined);
      }
    }

    if (!finished && job.stop !== null) {
      if (job.stop === 'cancel') outcome = { state: 'cancelled' };
      else if (job.stop === 'idle') outcome = { state: 'error', message: t.idleTimeout };
      else outcome = { state: 'error', message: t.hardLimit };
    }

    await this.finish(job, outcome);
  }

  /** Handles one provider event. Returns true when the event ends the turn. */
  private async handle(job: Job, event: AgentEvent, setOutcome: (outcome: Outcome) => void): Promise<boolean> {
    const { ctx, store, lang } = this.opts;
    switch (event.type) {
      case 'activity': {
        const text = safeSentence(event.text, lang);
        if (text !== job.turn.activity) {
          job.turn.activity = text;
          this.publishTurn(job);
        }
        return false;
      }
      case 'step': {
        const step: TurnStep = {
          id: event.id,
          kind: event.kind,
          text: safeSentence(event.text, lang),
          at: nowIso(),
          state: 'running',
          ...(event.parentId ? { parentId: event.parentId } : {}),
        };
        job.steps.push(step);
        if (job.steps.length > MAX_STEPS) job.steps.splice(0, job.steps.length - MAX_STEPS);
        this.publishTurn(job);
        return false;
      }
      case 'step-end': {
        const step = [...job.steps].reverse().find((s) => s.id === event.id && s.state === 'running');
        if (step) {
          step.state = event.ok ? 'done' : 'failed';
          step.endedAt = nowIso();
          this.publishTurn(job);
        }
        return false;
      }
      case 'delta': {
        if (event.text === '') return false;
        job.text += event.text;
        ctx.bus.publish('delta', { messageId: job.agentMessageId, text: event.text, conversationId: job.conversationId });
        return false;
      }
      case 'open': {
        const path = await validateOpenPath(ctx.campaignRoot, event.path);
        if (path !== null) ctx.bus.publish('open', { path });
        else ctx.log('the agent asked to open a path that is not a campaign document');
        return false;
      }
      case 'resume': {
        await store
          .setResumeId(job.conversationId, event.id)
          .catch((err: unknown) => ctx.log(`could not save the session: ${String(err)}`));
        return false;
      }
      case 'done':
        setOutcome({ state: 'done' });
        return true;
      case 'error':
        setOutcome({ state: 'error', message: event.message || TEXTS[lang].genericError });
        return true;
      default:
        return false;
    }
  }

  private async finish(job: Job, outcome: Outcome): Promise<void> {
    const { ctx, store } = this.opts;
    const turn = job.turn;
    const toSha = await this.headSha(ctx.campaignRoot);
    const endedAt = nowIso();
    turn.state = outcome.state;
    turn.endedAt = endedAt;
    turn.activity = '';
    turn.toSha = toSha;
    if (outcome.state === 'error') turn.error = outcome.message;
    // A step still running when the turn ends is closed: the turn no longer works on it.
    for (const step of job.steps) {
      if (step.state === 'running') {
        step.state = 'done';
        step.endedAt = endedAt;
      }
    }

    // job.text holds only the answer (progress never reaches delta); the strip is a safety net.
    const text = stripLeadingNarration(job.text.trim()).trim();
    const agentMessage: ChatMessage | null =
      text === ''
        ? null
        : {
            id: job.agentMessageId,
            role: 'agent',
            text,
            at: endedAt,
            turnId: turn.id,
            ...(job.steps.length > 0 ? { steps: copySteps(job.steps) } : {}),
          };
    try {
      if (agentMessage) await store.addMessage(job.conversationId, agentMessage);
      await store.appendTurn({ messageId: turn.messageId, turnId: turn.id, fromSha: job.fromSha, toSha });
    } catch (err) {
      ctx.log(`chat state could not be saved: ${String(err)}`);
    }
    if (agentMessage) {
      ctx.bus.publish('message', { ...agentMessage, conversationId: job.conversationId });
      // The order and the message count of the conversations changed.
      ctx.bus.publish('conversations', {});
    }
    this.publishTurn(job);
    if (job.fromSha !== toSha) ctx.bus.publish('changes', {});
  }
}
