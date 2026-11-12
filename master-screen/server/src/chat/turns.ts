// Turn queue: one agent turn at a time, FIFO. Owns the turn lifecycle (queued, running,
// done, error, cancelled), the idle and hard time limits, cancellation, and the bus
// events of the chat. Owner: chat engineer.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, Turn } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import type { AgentEvent, AgentProvider } from '../agent/provider.js';
import { stripLeadingNarration } from '../agent/answer.js';
import { safeActivity } from './activity.js';
import { validateOpenPath } from './paths.js';
import type { ChatStore } from './store.js';
import { TEXTS, type Lang } from './text.js';

export const IDLE_TIMEOUT_MS = 120_000;
export const HARD_LIMIT_MS = 600_000;

export interface TurnsOptions {
  ctx: Ctx;
  provider: AgentProvider;
  store: ChatStore;
  lang: Lang;
  idleTimeoutMs?: number;
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
  prompt: string;
  agentMessageId: string;
  text: string;
  fromSha: string;
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

export class TurnRunner {
  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private readonly known = new Set<string>();
  private closed = false;
  private readonly idleMs: number;
  private readonly hardMs: number;
  private readonly headSha: (campaignRoot: string) => Promise<string>;

  constructor(private readonly opts: TurnsOptions) {
    this.idleMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.hardMs = opts.hardLimitMs ?? HARD_LIMIT_MS;
    this.headSha = opts.headSha ?? gitHeadSha;
  }

  /** The turn that is queued or running, as a snapshot, or null. */
  current(): Turn | null {
    const job = this.running ?? this.queue[0] ?? null;
    return job ? { ...job.turn } : null;
  }

  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Accepts a master message: persists it, publishes it and queues its turn.
   * Resolves null once the runner is closing.
   */
  async submit(text: string): Promise<Submitted | null> {
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
    };
    const job: Job = {
      turn,
      prompt: text,
      agentMessageId: randomUUID(),
      text: '',
      fromSha: '',
      controller: null,
      stop: null,
      done: null,
    };
    const message: ChatMessage = { id: messageId, role: 'master', text, at, turnId };
    // The store call is made now, so messages keep their order even when persisted in parallel.
    await this.opts.store.addMessage(message);
    this.known.add(turnId);
    this.queue.push(job);
    this.opts.ctx.bus.publish('message', message);
    this.publishTurn(job);
    this.pump();
    return { messageId, turnId };
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
    this.opts.ctx.bus.publish('turn', { ...job.turn });
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

    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdle = (): void => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => this.stop(job, 'idle'), this.idleMs);
    };
    const hardTimer = setTimeout(() => this.stop(job, 'hard'), this.hardMs);
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
          resumeId: store.resumeId(),
          signal: controller.signal,
        })
        [Symbol.asyncIterator]();
      while (!finished) {
        const step = await Promise.race([iterator.next(), aborted]);
        if (step === ABORTED) break;
        if (step.done) break;
        armIdle();
        finished = await this.handle(job, step.value, (next) => {
          outcome = next;
        });
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
        const text = safeActivity(event.text, lang);
        if (text !== job.turn.activity) {
          job.turn.activity = text;
          this.publishTurn(job);
        }
        return false;
      }
      case 'delta': {
        if (event.text === '') return false;
        job.text += event.text;
        ctx.bus.publish('delta', { messageId: job.agentMessageId, text: event.text });
        return false;
      }
      case 'open': {
        const path = await validateOpenPath(ctx.campaignRoot, event.path);
        if (path !== null) ctx.bus.publish('open', { path });
        else ctx.log('the agent asked to open a path that is not a campaign document');
        return false;
      }
      case 'resume': {
        await store.setResumeId(event.id).catch((err: unknown) => ctx.log(`could not save the session: ${String(err)}`));
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

    // job.text holds only the answer (progress never reaches delta); the strip is a safety net.
    const text = stripLeadingNarration(job.text.trim()).trim();
    const agentMessage: ChatMessage | null =
      text === '' ? null : { id: job.agentMessageId, role: 'agent', text, at: endedAt, turnId: turn.id };
    try {
      if (agentMessage) await store.addMessage(agentMessage);
      await store.appendTurn({ messageId: turn.messageId, turnId: turn.id, fromSha: job.fromSha, toSha });
    } catch (err) {
      ctx.log(`chat state could not be saved: ${String(err)}`);
    }
    if (agentMessage) ctx.bus.publish('message', agentMessage);
    this.publishTurn(job);
    if (job.fromSha !== toSha) ctx.bus.publish('changes', {});
  }
}
