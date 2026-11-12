// Helpers for the chat tests: a temporary campaign, a recording bus and a wait helper.
// Used only by *.test.ts files (not a test file itself).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentStatus, Ctx } from '../context.js';
import { createCtx } from '../context.js';
import type { Bus } from '../bus.js';

export interface Recorded {
  event: string;
  data: any;
}

export interface TestCampaign {
  dir: string;
  framework: string;
  ctx: Ctx;
  events: Recorded[];
  logs: string[];
  /** Events of one name, in publish order. */
  of(name: string): Recorded[];
  cleanup(): void;
}

const GIT_ARGS = ['-c', 'user.name=Yllir Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false'];

export function git(dir: string, args: string[]): string {
  return execFileSync('git', [...GIT_ARGS, '-C', dir, ...args], { encoding: 'utf8' }).trim();
}

export function makeCampaign(opts: { git?: boolean; agent?: AgentStatus; language?: 'it' | 'en' } = {}): TestCampaign {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-chat-'));
  const dir = path.join(root, 'campaign');
  const framework = path.join(root, 'yllir');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(framework, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'campaign.yaml'), `campaign:\n  name: Test\nlanguage:\n  main: ${opts.language ?? 'it'}\n`);
  fs.mkdirSync(path.join(dir, 'characters'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'characters', 'mara.md'), '# Mara\n\nUn personaggio.\n');
  if (opts.git) {
    git(dir, ['init', '-q']);
    git(dir, ['add', '--', 'campaign.yaml', 'characters/mara.md']);
    git(dir, ['commit', '-q', '-m', 'Initial']);
  }
  const events: Recorded[] = [];
  const logs: string[] = [];
  const bus = {
    publish(event: string, data: unknown): number {
      events.push({ event, data });
      return events.length;
    },
  } as unknown as Bus;
  const ctx = createCtx({
    campaignRoot: dir,
    frameworkRoot: framework,
    port: 4317,
    log: (msg) => logs.push(msg),
    agentStatus: () => opts.agent ?? { available: true },
  });
  ctx.bus = bus;
  return {
    dir,
    framework,
    ctx,
    events,
    logs,
    of: (name) => events.filter((e) => e.event === name),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** Polls until check() is true; throws with `label` when the time runs out. */
export async function waitFor(check: () => boolean, label = 'condition', timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
