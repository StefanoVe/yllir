import assert from 'node:assert/strict';
import express from 'express';
import { after, describe, it } from 'node:test';
import type { Turn, UpdateStatus } from '../../../shared/src/types.js';
import { createCtx, type Ctx } from '../context.js';
import { makeCampaign } from '../live/test-support.js';
import { request, startServer, type RunningServer, type TestResponse } from '../testing.js';
import { createUpdateService, UpdateService } from '../update/service.js';
import { fakeUpdate, settle, type FakeUpdate } from '../update/test-support.js';
import { UPDATE_TEXTS } from '../update/text.js';
import { registerUpdateRoutes } from './update.js';

const EN = UPDATE_TEXTS.en;
const servers: RunningServer[] = [];
after(async () => {
  for (const s of servers) await s.close();
});

/** The routes on a bare express app, with the given service. */
async function serve(service: UpdateService): Promise<RunningServer> {
  const server = await startServer(() => {
    const app = express();
    app.use(express.json({ limit: '64kb' }));
    const api = express.Router();
    registerUpdateRoutes(api, {} as Ctx, { service });
    app.use('/api', api);
    return app;
  });
  servers.push(server);
  return server;
}

function call(server: RunningServer, method: string, route: string): Promise<TestResponse> {
  return request(server.port, { method, path: `/api${route}` });
}

describe('update routes', () => {
  it('GET answers the status and POST check refreshes it', async () => {
    const fake = fakeUpdate();
    const server = await serve(new UpdateService(fake.deps));
    const before = await call(server, 'GET', '/update');
    assert.equal(before.status, 200, before.text);
    assert.equal((before.json as UpdateStatus).state, 'idle');

    const checked = await call(server, 'POST', '/update/check');
    assert.equal(checked.status, 200, checked.text);
    const status = checked.json as UpdateStatus;
    assert.equal(status.state, 'available');
    assert.equal(status.canApply, true);
    assert.equal(status.news, 'Something new for the master.');
    assert.deepEqual(Object.keys(status).sort(), ['blockedReason', 'canApply', 'news', 'snoozed', 'state']);
  });

  it('POST snooze answers the status with snoozed true', async () => {
    const fake = fakeUpdate();
    const server = await serve(new UpdateService(fake.deps));
    await call(server, 'POST', '/update/check');
    const res = await call(server, 'POST', '/update/snooze');
    assert.equal(res.status, 200, res.text);
    assert.equal((res.json as UpdateStatus).snoozed, true);
  });

  it('POST apply answers 409 with a plain sentence when there is nothing to apply', async () => {
    const fake = fakeUpdate();
    fake.world.installed = '1.2.0';
    const server = await serve(new UpdateService(fake.deps));
    await call(server, 'POST', '/update/check');
    const res = await call(server, 'POST', '/update/apply');
    assert.equal(res.status, 409, res.text);
    assert.deepEqual(res.json, { error: EN.noUpdate });
    assert.equal(fake.execs.length, 0);
  });

  it('POST apply answers 202 and the update runs in the background', async () => {
    const fake = fakeUpdate();
    const server = await serve(new UpdateService(fake.deps));
    await call(server, 'POST', '/update/check');
    const res = await call(server, 'POST', '/update/apply');
    assert.equal(res.status, 202, res.text);
    assert.deepEqual(res.json, { ok: true });
    await settle();
    assert.deepEqual(fake.order.slice(0, 2), ['exec plugin update yllir@yllir --json', 'exec plugin list --json']);
    assert.equal(fake.shutdowns(), 1);
    assert.equal(fake.restarts.length, 1);
  });
});

describe('update routes with the real chat turn tracking', () => {
  function turn(state: Turn['state']): Turn {
    return {
      id: 'turn-1',
      messageId: 'message-1',
      state,
      activity: '',
      startedAt: new Date().toISOString(),
    };
  }

  it('a chat turn that is running blocks the apply until it ends, and the status says why', async () => {
    const root = makeCampaign();
    const ctx = createCtx({ campaignRoot: root, frameworkRoot: root, port: 0, log: () => undefined });
    const fake: FakeUpdate = fakeUpdate();
    const service = createUpdateService(ctx, { ...fake.deps, campaignRoot: root, chatTurnOpen: () => ctx.chatTurnOpen() });
    const server = await serve(service);
    await call(server, 'POST', '/update/check');

    ctx.bus.publish('turn', turn('running'));
    const blocked = await call(server, 'POST', '/update/apply');
    assert.equal(blocked.status, 409, blocked.text);
    assert.deepEqual(blocked.json, { error: EN.turnRunning });
    const status = (await call(server, 'GET', '/update')).json as UpdateStatus;
    assert.equal(status.blockedReason, 'turn-running');
    assert.equal(status.canApply, false);

    ctx.bus.publish('turn', turn('done'));
    const free = (await call(server, 'GET', '/update')).json as UpdateStatus;
    assert.equal(free.blockedReason, null);
    assert.equal(free.canApply, true);
  });
});
