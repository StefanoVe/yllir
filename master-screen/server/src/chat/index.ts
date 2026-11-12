// Chat state (chat.json), turn queue and turn lifecycle. Owner: chat engineer.
// The routes live in src/routes/chat.ts.
import type { Ctx } from '../context.js';
import type { AgentProvider } from '../agent/provider.js';
import { ChatStore } from './store.js';
import { TurnRunner } from './turns.js';
import { campaignLanguage } from './text.js';

export { ChatStore, MAX_MESSAGES } from './store.js';
export type { TurnRecord } from './store.js';
export { TurnRunner, HARD_LIMIT_MS, IDLE_TIMEOUT_MS, gitHeadSha } from './turns.js';
export type { Submitted, TurnsOptions } from './turns.js';
export { TEXTS, campaignLanguage, langOf } from './text.js';
export type { Lang } from './text.js';
export { toolActivity, safeActivity } from './activity.js';
export { validateOpenPath } from './paths.js';

export interface ChatService {
  store: ChatStore;
  runner: TurnRunner;
}

export interface ChatServiceOptions {
  idleTimeoutMs?: number;
  hardLimitMs?: number;
  headSha?: (campaignRoot: string) => Promise<string>;
}

/**
 * Creates the chat state and the turn runner for a campaign and registers the shutdown
 * hook (the running turn is cancelled and the queue emptied on close).
 */
export function createChatService(ctx: Ctx, provider: AgentProvider, opts: ChatServiceOptions = {}): ChatService {
  const store = new ChatStore(ctx.state.dir, ctx.log);
  const runner = new TurnRunner({
    ctx,
    provider,
    store,
    lang: campaignLanguage(ctx.campaignRoot),
    idleTimeoutMs: opts.idleTimeoutMs,
    hardLimitMs: opts.hardLimitMs,
    headSha: opts.headSha,
  });
  ctx.onClose(async () => {
    await runner.close();
    await store.flush();
  });
  return { store, runner };
}
