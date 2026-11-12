// Scripted agent provider for tests. Replays the given events, one run per call, and
// honours the abort signal. Owner: chat engineer.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentEvent, AgentProvider, AgentRunInput } from './provider.js';

export interface FakeCommit {
  /** Campaign-relative file to write and commit before the script runs. */
  path: string;
  content: string;
  message: string;
}

export interface FakeProviderOptions {
  /** Pause before each scripted event. */
  delayMs?: number;
  /** Keep the stream open after the script until the signal aborts (no done event). */
  hang?: boolean;
  /** Simulates an engine write: commits a file in the campaign before the script runs. */
  commit?: FakeCommit;
}

export interface FakeProvider extends AgentProvider {
  /** Every run input received, in order. */
  readonly calls: AgentRunInput[];
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function git(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'user.name=Yllir Test', '-c', 'user.email=test@example.invalid', '-C', cwd, ...args],
      { windowsHide: true },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

async function commitFile(campaignRoot: string, commit: FakeCommit): Promise<void> {
  const file = path.join(campaignRoot, ...commit.path.split('/'));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, commit.content, 'utf8');
  await git(campaignRoot, ['add', '--', commit.path]);
  await git(campaignRoot, ['commit', '-m', commit.message]);
}

/** Returns a provider that replays `script` for each run. */
export function createFakeProvider(script: AgentEvent[] = [], opts: FakeProviderOptions = {}): FakeProvider {
  const calls: AgentRunInput[] = [];
  return {
    calls,
    async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
      calls.push(input);
      if (input.signal.aborted) return;
      if (opts.commit) await commitFile(input.cwd, opts.commit);
      for (const event of script) {
        if (input.signal.aborted) return;
        if (opts.delayMs !== undefined && opts.delayMs > 0) {
          await sleep(opts.delayMs, input.signal);
          if (input.signal.aborted) return;
        }
        yield event;
      }
      if (opts.hang) {
        await new Promise<void>((resolve) => {
          if (input.signal.aborted) resolve();
          else input.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
    },
  };
}
