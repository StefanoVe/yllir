// Test helpers of the cockpit host: a temporary copy of the morvalle fixture campaign and a
// context over the real framework folder. Used only by *.test.ts files.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCtx, type Ctx } from '../context.js';

export const FIXTURE_CAMPAIGN = fileURLToPath(new URL('../../../../testbench/fixtures/morvalle/campaign', import.meta.url));
export const REAL_FRAMEWORK = fileURLToPath(new URL('../../../../yllir', import.meta.url));

/** A fresh copy of the fixture campaign in the temporary folder. */
export async function copyFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yllir-cockpit-host-'));
  await fs.cp(FIXTURE_CAMPAIGN, root, { recursive: true });
  return root;
}

export async function removeCampaign(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

export function contextFor(root: string, logs: string[] = []): Ctx {
  return createCtx({ campaignRoot: root, frameworkRoot: REAL_FRAMEWORK, port: 0, log: (msg) => logs.push(msg) });
}

/** Waits until check() returns true, polling every 50 ms, for at most timeoutMs. */
export async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}
