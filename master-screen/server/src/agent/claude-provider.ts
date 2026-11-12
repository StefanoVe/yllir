// Real agent provider on @anthropic-ai/claude-agent-sdk: runs the master's Claude Code
// with the Yllir plugin, a permission gate and two in-process tools. Owner: chat engineer.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createSdkMcpServer,
  query as sdkQuery,
  tool,
  type CanUseTool,
  type Options,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { runEngine } from '../engine.js';
import { describeTool, narrationActivity, type ActivityRoots } from '../chat/activity.js';
import { suggestMusic } from '../music/suggest.js';
import { validateOpenPath } from '../chat/paths.js';
import { TEXTS, campaignLanguage, type Lang } from '../chat/text.js';
import { stripLeadingNarration } from './answer.js';
import { isAllowed, type GateContext } from './gate.js';
import type { AgentEvent, AgentProvider, AgentRunInput } from './provider.js';
import { MASTER_SCREEN_PROMPT } from './system-prompt.js';

export interface LookupDeps {
  /** Runs `which claude` / `where claude`; returns the first line or null. */
  whichClaude?: () => string | null;
  exists?: (file: string) => boolean;
  /** Names of the entries of a directory; empty when it cannot be read. */
  readDir?: (dir: string) => string[];
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
}

function defaultReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Parses `v20.11.1` (or `20.11.1`) into numbers; null for any other name. */
function parseVersionDir(name: string): number[] | null {
  const found = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(name);
  return found ? [Number(found[1]), Number(found[2]), Number(found[3])] : null;
}

/** The claude binaries of nvm-installed Node versions, newest version first. */
function nvmClaudeCandidates(nvmNode: string, readDir: (dir: string) => string[]): string[] {
  const versions: Array<{ name: string; parts: number[] }> = [];
  for (const name of readDir(nvmNode)) {
    const parts = parseVersionDir(name);
    if (parts) versions.push({ name, parts });
  }
  versions.sort((a, b) => {
    for (let i = 0; i < 3; i += 1) {
      if (a.parts[i] !== b.parts[i]) return b.parts[i] - a.parts[i];
    }
    return 0;
  });
  return versions.map((v) => path.join(nvmNode, v.name, 'bin', 'claude'));
}

function defaultWhich(platform: NodeJS.Platform): () => string | null {
  return () => {
    try {
      const out = execFileSync(platform === 'win32' ? 'where' : 'which', ['claude'], {
        encoding: 'utf8',
        timeout: 3_000,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      const first = out.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '');
      return first ?? null;
    } catch {
      return null;
    }
  };
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * The Claude Code the master already has: the path the launcher found (YLLIR_CLAUDE_PATH),
 * then PATH, then the usual install locations. Returns an absolute path or null.
 */
export function findClaudeCode(deps: LookupDeps = {}): string | null {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const home = deps.home ?? os.homedir();
  const exists = deps.exists ?? isFile;
  const readDir = deps.readDir ?? defaultReadDir;
  const fromLauncher = env.YLLIR_CLAUDE_PATH;
  if (fromLauncher && exists(fromLauncher)) return path.resolve(fromLauncher);
  const onPath = (deps.whichClaude ?? defaultWhich(platform))();
  const candidates: string[] = [];
  if (onPath) candidates.push(onPath);
  candidates.push(path.join(home, '.claude', 'local', 'claude'));
  candidates.push(path.join(home, '.local', 'bin', 'claude'));
  candidates.push(path.join(home, '.npm-global', 'bin', 'claude'));
  candidates.push(path.join(home, '.volta', 'bin', 'claude'));
  candidates.push(path.join(home, '.bun', 'bin', 'claude'));
  candidates.push('/usr/local/bin/claude');
  candidates.push('/opt/homebrew/bin/claude');
  candidates.push(...nvmClaudeCandidates(path.join(home, '.nvm', 'versions', 'node'), readDir));
  if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe'));
  if (env.APPDATA) candidates.push(path.join(env.APPDATA, 'npm', 'claude.cmd'));
  for (const candidate of candidates) {
    if (exists(candidate)) return path.resolve(candidate);
  }
  return null;
}

/** A minimal async queue: the SDK loop and the in-process tools push, the generator yields. */
class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift() as T, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: (): Promise<IteratorResult<T>> => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

/** Per-run state of the mapping: whether the run ended, and the answer held until it succeeds. */
export interface RunState {
  finished: boolean;
  answer: string;
}

const AUTH_PATTERN = /auth|login|credential|api.?key|unauthori/i;

function classifyFailure(lang: Lang, subtype: string | undefined, details: string[]): string {
  const t = TEXTS[lang];
  if (subtype === 'error_max_turns') return t.tooLong;
  if (details.some((d) => AUTH_PATTERN.test(d))) return t.authFailed;
  return t.genericError;
}

interface ContentBlock {
  type: string;
  id?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
}

function rootsOf(ctx: Ctx): ActivityRoots | undefined {
  return typeof ctx.campaignRoot === 'string' && typeof ctx.frameworkRoot === 'string'
    ? { campaignRoot: ctx.campaignRoot, frameworkRoot: ctx.frameworkRoot }
    : undefined;
}

/**
 * The events of the tool uses of one message: an activity sentence (when the tool has one) and
 * a step that starts. A sub-agent's tool uses carry `parentId`, the tool use that started it.
 */
function toolEvents(content: ContentBlock[], lang: Lang, ctx: Ctx, parentId?: string): AgentEvent[] {
  const events: AgentEvent[] = [];
  const roots = rootsOf(ctx);
  for (const block of content) {
    if (block.type !== 'tool_use' || typeof block.name !== 'string') continue;
    const described = describeTool(block.name, block.input ?? {}, lang, roots);
    if (described) events.push({ type: 'activity', text: described.text });
    const step = described ?? { kind: 'other' as const, text: TEXTS[lang].working };
    events.push({
      type: 'step',
      id: typeof block.id === 'string' ? block.id : randomUUID(),
      kind: step.kind,
      text: step.text,
      ...(parentId ? { parentId } : {}),
    });
  }
  return events;
}

/**
 * Maps one SDK message to agent events. Every tool use starts a step; every tool result ends one.
 * Sub-agent messages (parent_tool_use_id) only contribute their tool steps, never text or the end.
 * An assistant message is complete when it arrives, so it is judged whole: text of a message
 * that uses a tool is progress (activity only); text of a message that uses no tool is the
 * answer, held in `state` and sent once as a delta when the run succeeds, just before done.
 */
export function mapMessage(message: SDKMessage, state: RunState, ctx: Ctx, lang: Lang): AgentEvent[] {
  const t = TEXTS[lang];
  switch (message.type) {
    case 'system': {
      if (message.subtype === 'init' && message.session_id) return [{ type: 'resume', id: message.session_id }];
      return [];
    }
    case 'assistant': {
      const parentId = message.parent_tool_use_id || undefined;
      const content = (message.message?.content ?? []) as unknown as ContentBlock[];
      if (parentId) return toolEvents(content, lang, ctx, parentId);
      if (state.finished) return [];
      if (message.error) {
        state.finished = true;
        ctx.log(`agent message error: ${message.error}`);
        return [
          {
            type: 'error',
            message: message.error === 'authentication_failed' ? t.authFailed : t.genericError,
          },
        ];
      }
      const text = content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('\n\n');
      const toolUses = content.filter((block) => block.type === 'tool_use' && typeof block.name === 'string');
      if (toolUses.length === 0) {
        state.answer = stripLeadingNarration(text.trim());
        return [];
      }
      const events: AgentEvent[] = [];
      const narration = narrationActivity(text, lang);
      if (narration) events.push({ type: 'activity', text: narration });
      events.push(...toolEvents(content, lang, ctx));
      return events;
    }
    case 'user': {
      // Tool results end the steps they answer; a failed tool result ends its step as failed.
      if (state.finished) return [];
      const content: unknown = message.message?.content;
      if (!Array.isArray(content)) return [];
      return (content as ContentBlock[])
        .filter((block) => block.type === 'tool_result' && typeof block.tool_use_id === 'string')
        .map((block): AgentEvent => ({ type: 'step-end', id: block.tool_use_id as string, ok: block.is_error !== true }));
    }
    case 'result': {
      if (state.finished) return [];
      state.finished = true;
      const details = 'errors' in message && Array.isArray(message.errors) ? message.errors.map(String) : [];
      if (message.subtype !== 'success' || message.is_error) {
        ctx.log(`agent run ended with ${message.subtype}${details.length ? `: ${details.join('; ')}` : ''}`);
        return [{ type: 'error', message: classifyFailure(lang, message.subtype, details) }];
      }
      return state.answer === ''
        ? [{ type: 'done' }]
        : [{ type: 'delta', text: state.answer }, { type: 'done' }];
    }
    default:
      return [];
  }
}

function resultText(value: unknown): string {
  const text = JSON.stringify(value ?? null) ?? 'null';
  return text.length > 8000 ? `${text.slice(0, 8000)}…` : text;
}

async function* runTurn(ctx: Ctx, executable: string, input: AgentRunInput): AsyncGenerator<AgentEvent> {
  const lang = campaignLanguage(input.cwd);
  const t = TEXTS[lang];
  const out = new EventQueue<AgentEvent>();
  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort();
  if (input.signal.aborted) controller.abort();
  else input.signal.addEventListener('abort', abortFromCaller, { once: true });

  const gate: GateContext = { campaignRoot: input.cwd, frameworkRoot: input.frameworkRoot };
  const state: RunState = { finished: false, answer: '' };

  const searchDocs = tool(
    'search_docs',
    'Search the campaign documents for a word or phrase. Returns the matching documents as JSON.',
    { query: z.string().min(1).max(200) },
    async ({ query }) => {
      const result = await runEngine(ctx, ['query', 'find', query], { timeoutMs: 20_000, signal: controller.signal });
      return { content: [{ type: 'text', text: resultText(result.json) }] };
    },
  );
  const openDocument = tool(
    'open_document',
    'Ask the screen to open one campaign document for the master. Give a campaign-relative Markdown path.',
    { path: z.string().min(1).max(512) },
    async ({ path: rel }) => {
      const checked = await validateOpenPath(input.cwd, rel);
      if (checked === null) {
        return { content: [{ type: 'text', text: 'That is not an existing campaign document.' }], isError: true };
      }
      out.push({ type: 'open', path: checked });
      return { content: [{ type: 'text', text: 'The document is open on the screen.' }] };
    },
  );
  const suggestMusicTool = tool(
    'suggest_music',
    'Show up to five pieces of music of the campaign on the screen, for a query (words of the title, mood or sheet) and/or one sheet path. Nothing plays by itself; the master chooses. Give a short reason when useful.',
    {
      query: z.string().min(1).max(200).optional(),
      doc: z.string().min(1).max(512).optional(),
      reason: z.string().max(200).optional(),
    },
    async (input) => {
      const result = await suggestMusic(ctx, input);
      return {
        content: [{ type: 'text', text: result.text }],
        ...(result.isError ? { isError: true } : {}),
      };
    },
  );
  const yllirTools = createSdkMcpServer({
    name: 'yllir',
    version: '1.0.0',
    tools: [searchDocs, openDocument, suggestMusicTool],
  });

  const canUseTool: CanUseTool = async (toolName, toolInput) => {
    const decision = isAllowed(toolName, toolInput, gate);
    if (decision.allow) return { behavior: 'allow', updatedInput: toolInput };
    ctx.log(`agent tool denied: ${toolName}`);
    return { behavior: 'deny', message: decision.reason };
  };

  const options: Options = {
    cwd: input.cwd,
    pathToClaudeCodeExecutable: executable,
    plugins: [{ type: 'local', path: input.frameworkRoot }],
    settingSources: [],
    permissionMode: 'default',
    canUseTool,
    mcpServers: { yllir: yllirTools },
    systemPrompt: { type: 'preset', preset: 'claude_code', append: MASTER_SCREEN_PROMPT },
    // Text is judged per complete assistant message, so partial text messages are not needed.
    includePartialMessages: false,
    abortController: controller,
    ...(input.resumeId ? { resume: input.resumeId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
  };

  // Ends by itself: the SDK stream stops when the controller aborts, and every failure is queued.
  void (async () => {
    try {
      const stream = sdkQuery({ prompt: input.prompt, options });
      for await (const message of stream) {
        if (controller.signal.aborted) break;
        for (const event of mapMessage(message, state, ctx, lang)) out.push(event);
      }
      if (!state.finished && !controller.signal.aborted) {
        state.finished = true;
        out.push({ type: 'error', message: t.stopped });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const text = err instanceof Error ? err.message : String(err);
        ctx.log(`agent run failed: ${text}`);
        out.push({ type: 'error', message: AUTH_PATTERN.test(text) ? t.authFailed : t.genericError });
      }
    } finally {
      out.close();
    }
  })();

  try {
    for await (const event of out) yield event;
  } finally {
    input.signal.removeEventListener('abort', abortFromCaller);
    controller.abort();
    out.close();
  }
}

/** Real provider. Throws when Claude Code is not installed: use createProvider to check first. */
export function createClaudeProvider(ctx: Ctx): AgentProvider {
  const executable = findClaudeCode();
  if (!executable) throw new Error('Claude Code is not installed on this computer');
  return {
    run(input: AgentRunInput): AsyncIterable<AgentEvent> {
      return runTurn(ctx, executable, input);
    },
  };
}
