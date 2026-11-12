import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Bus } from '../bus.js';
import { createCtx } from '../context.js';
import { startLiveWatcher } from './watcher.js';
import { liveRevision } from './snapshot.js';
import { makeCampaign, type Recorded } from './test-support.js';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** fsevents reports the setup write a little after the watch starts; let that pass and forget it. */
async function settle(events: Recorded[]): Promise<void> {
  await delay(600);
  events.length = 0;
}

async function waitUntil(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await delay(20);
  }
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

const liveEvents = (events: Recorded[]): Recorded[] => events.filter((e) => e.event === 'live');

describe('startLiveWatcher', () => {
  it('publishes a debounced live event with the new revision on an external write', async () => {
    const root = makeCampaign({ '.campaign/state/live/active.json': '{"sessionId":null}\n' });
    const ctx = createCtx({ campaignRoot: root, frameworkRoot: root, port: 0, log: () => undefined });
    const events = recordPublishes(ctx.bus);
    const stop = startLiveWatcher(ctx, { debounceMs: 150 });
    await settle(events);

    try {
      await fs.writeFile(path.join(root, '.campaign/state/live/active.json'), '{"sessionId":"2026-11-12"}\n');
      await waitUntil(() => liveEvents(events).length >= 1);
      await delay(300);
      assert.equal(liveEvents(events).length, 1);
      const data = liveEvents(events)[0].data as { revision: string };
      assert.match(data.revision, /^[0-9a-f]{40}$/);
      assert.equal(data.revision, await liveRevision(root));
    } finally {
      await stop();
    }
  });

  it('coalesces a burst of writes into one event', async () => {
    const root = makeCampaign({ '.campaign/state/live/active.json': '{"sessionId":null}\n' });
    const ctx = createCtx({ campaignRoot: root, frameworkRoot: root, port: 0, log: () => undefined });
    const events = recordPublishes(ctx.bus);
    const stop = startLiveWatcher(ctx, { debounceMs: 150 });
    await settle(events);
    try {
      for (let i = 0; i < 4; i++) {
        await fs.writeFile(path.join(root, '.campaign/state/live/active.json'), `{"sessionId":null,"n":${i}}\n`);
        await delay(20);
      }
      await waitUntil(() => liveEvents(events).length >= 1);
      await delay(400);
      assert.equal(liveEvents(events).length, 1);
    } finally {
      await stop();
    }
  });

  it('waits for the live folder to appear, then reports writes to it', async () => {
    const root = makeCampaign();
    const ctx = createCtx({ campaignRoot: root, frameworkRoot: root, port: 0, log: () => undefined });
    const events = recordPublishes(ctx.bus);
    const stop = startLiveWatcher(ctx, { debounceMs: 50, pollMs: 50 });
    try {
      await delay(200);
      assert.equal(liveEvents(events).length, 0);
      const live = path.join(root, '.campaign/state/live');
      await fs.mkdir(live, { recursive: true });
      await waitUntil(() => liveEvents(events).length >= 1);
      events.length = 0;
      await fs.writeFile(path.join(live, 'active.json'), '{"sessionId":"2026-11-12"}\n');
      await waitUntil(() => liveEvents(events).length >= 1);
    } finally {
      await stop();
    }
  });

  it('stops cleanly: no event after stop, and stop resolves', async () => {
    const root = makeCampaign({ '.campaign/state/live/active.json': '{"sessionId":null}\n' });
    const ctx = createCtx({ campaignRoot: root, frameworkRoot: root, port: 0, log: () => undefined });
    const events = recordPublishes(ctx.bus);
    const stop = startLiveWatcher(ctx, { debounceMs: 50, pollMs: 50 });
    await settle(events);
    await stop();
    await fs.writeFile(path.join(root, '.campaign/state/live/active.json'), '{"sessionId":"x"}\n');
    await delay(400);
    assert.equal(liveEvents(events).length, 0);
  });

  it('stops while the folder is still missing (no poll left behind)', async () => {
    const root = makeCampaign();
    const ctx = createCtx({ campaignRoot: root, frameworkRoot: root, port: 0, log: () => undefined });
    const stop = startLiveWatcher(ctx, { pollMs: 30 });
    await delay(100);
    await stop();
    await fs.mkdir(path.join(root, '.campaign/state/live'), { recursive: true });
    await fs.writeFile(path.join(root, '.campaign/state/live/active.json'), '{"sessionId":"a"}\n');
    const events = recordPublishes(ctx.bus);
    await delay(200);
    assert.equal(liveEvents(events).length, 0);
  });
});

describe('liveRevision', () => {
  it('is stable without writes and changes when a file of the active session changes', async () => {
    const root = makeCampaign();
    const live = path.join(root, '.campaign/state/live');
    await fs.mkdir(path.join(live, '2026-11-12'), { recursive: true });
    await fs.writeFile(path.join(live, 'active.json'), '{"sessionId":"2026-11-12"}\n');
    await fs.writeFile(path.join(live, '2026-11-12/session.json'), '{"id":"2026-11-12"}\n');
    const first = await liveRevision(root);
    assert.equal(await liveRevision(root), first);

    await fs.writeFile(path.join(live, '2026-11-12/log.json'), '[]\n');
    const afterLog = await liveRevision(root);
    assert.notEqual(afterLog, first);

    await fs.writeFile(path.join(live, '2026-11-12/board.json'), '{"revision":1}\n');
    assert.notEqual(await liveRevision(root), afterLog);
  });

  it('differs between no session and an open session', async () => {
    const root = makeCampaign();
    const none = await liveRevision(root);
    const live = path.join(root, '.campaign/state/live');
    await fs.mkdir(path.join(live, '2026-11-12'), { recursive: true });
    await fs.writeFile(path.join(live, 'active.json'), '{"sessionId":"2026-11-12"}\n');
    assert.notEqual(await liveRevision(root), none);
  });
});
