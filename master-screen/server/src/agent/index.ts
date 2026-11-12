// Chooses the agent provider for this process and reports its status. Owner: chat engineer.
import type { Ctx } from '../context.js';
import type { AgentStatus } from '../context.js';
import { campaignLanguage, TEXTS } from '../chat/text.js';
import { createClaudeProvider, findClaudeCode } from './claude-provider.js';
import type { AgentProvider } from './provider.js';

export type { AgentEvent, AgentProvider, AgentRunInput } from './provider.js';
export { createClaudeProvider, findClaudeCode } from './claude-provider.js';
export { createFakeProvider } from './fake-provider.js';
export type { FakeProvider, FakeProviderOptions, FakeCommit } from './fake-provider.js';

const LOOKUP_TTL_MS = 30_000;
let lookup: { at: number; found: string | null } | null = null;

/** The Claude Code executable, looked up at most every 30 s. */
function cachedClaudeCode(): string | null {
  const now = Date.now();
  if (lookup === null || now - lookup.at > LOOKUP_TTL_MS) {
    lookup = { at: now, found: findClaudeCode() };
  }
  return lookup.found;
}

/**
 * The real provider when the master's Claude Code is found, else null. The chat routes
 * answer 503 with the reason from agentStatus in that case.
 */
export function createProvider(ctx: Ctx): AgentProvider | null {
  return cachedClaudeCode() ? createClaudeProvider(ctx) : null;
}

/**
 * Status for ctx.agentStatus: available when Claude Code is installed, else the plain
 * reason in the campaign language.
 */
export function agentStatus(campaignRoot: string): AgentStatus {
  if (cachedClaudeCode()) return { available: true };
  return { available: false, reason: TEXTS[campaignLanguage(campaignRoot)].noClaudeCode };
}
