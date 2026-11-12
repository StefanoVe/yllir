import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Bus } from '../bus.js';
import { createCtx } from '../context.js';
import { startWatcher } from './watcher.js';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await delay(20);
  }
}

interface Recorded {
  event: string;
  data: unknown;
}

function recordPublishes(bus: Bus): Recorded[] {
  const recorded: Recorded[] = [];
  const original = bus.publish.bind(bus);
  bus.publish = ((event: string, data: unknown) => {
    recorded.push({ event, data });
    return original(event as never, data as never);
  }) as unknown as Bus['publish'];
  return recorded;
}

const filesEvents = (events: Recorded[]): Recorded[] => events.filter((e) => e.event === 'files');

describe('startWatcher', () => {
  it('publishes one debounced files event per change and ignores hidden folders', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-watch-'));
    await fs.mkdir(path.join(root, '.campaign'), { recursive: true });
    await fs.mkdir(path.join(root, '.git', 'refs', 'heads'), { recursive: true });
    await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    const ctx = createCtx({ campaignRoot: root, frameworkRoot: root, port: 0, log: () => {} });
    const events = recordPublishes(ctx.bus);
    const stop = startWatcher(ctx);
    await delay(400);

    try {
      // create
      await fs.writeFile(path.join(root, 'notes.md'), '# A\n');
      await waitUntil(() => filesEvents(events).length >= 1);
      await delay(300);
      assert.equal(filesEvents(events).length, 1);
      assert.deepEqual(filesEvents(events)[0].data, { changed: ['notes.md'], removed: [] });

      // two writes in one quiet period: one event
      events.length = 0;
      await fs.writeFile(path.join(root, 'burst.md'), '1');
      await delay(20);
      await fs.writeFile(path.join(root, 'burst.md'), '2');
      await delay(700);
      assert.equal(filesEvents(events).length, 1);
      assert.deepEqual(filesEvents(events)[0].data, { changed: ['burst.md'], removed: [] });

      // modify
      events.length = 0;
      await fs.writeFile(path.join(root, 'notes.md'), '# B\n');
      await waitUntil(() => filesEvents(events).length >= 1);
      await delay(300);
      assert.equal(filesEvents(events).length, 1);
      assert.deepEqual(filesEvents(events)[0].data, { changed: ['notes.md'], removed: [] });

      // delete
      events.length = 0;
      await fs.rm(path.join(root, 'notes.md'));
      await waitUntil(() => filesEvents(events).length >= 1);
      await delay(300);
      assert.equal(filesEvents(events).length, 1);
      assert.deepEqual(filesEvents(events)[0].data, { changed: [], removed: ['notes.md'] });

      // hidden folders and non-tracked files are ignored
      events.length = 0;
      await fs.writeFile(path.join(root, '.campaign', 'x.md'), '# hidden\n');
      await fs.writeFile(path.join(root, 'data.json'), '{}\n');
      await delay(800);
      assert.equal(filesEvents(events).length, 0);

      // branch movement publishes changes, once
      events.length = 0;
      await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/dev\n');
      await waitUntil(() => events.some((e) => e.event === 'changes'));
      await delay(500);
      assert.equal(events.filter((e) => e.event === 'changes').length, 1);
      assert.equal(filesEvents(events).length, 0);
    } finally {
      await stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('stops publishing after close', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-watch-'));
    const ctx = createCtx({ campaignRoot: root, frameworkRoot: root, port: 0, log: () => {} });
    const events = recordPublishes(ctx.bus);
    const stop = startWatcher(ctx);
    await delay(300);
    await stop();
    await fs.writeFile(path.join(root, 'late.md'), '# late\n');
    await delay(500);
    assert.equal(filesEvents(events).length, 0);
    await fs.rm(root, { recursive: true, force: true });
  });
});
