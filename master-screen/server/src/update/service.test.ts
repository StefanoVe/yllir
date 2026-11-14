import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { NOTICE_RELATIVE_PATH } from './notice.js';
import { CHECK_INTERVAL_MS, createUpdateService, UpdateService } from './service.js';
import { fakeUpdate, settle, type FakeUpdate } from './test-support.js';
import type { OpenSession } from '../../../shared/src/types.js';
import { createCtx } from '../context.js';
import { makeCampaign } from '../live/test-support.js';
import { PLUGIN_MANIFEST_URL } from './source.js';
import { UPDATE_TEXTS } from './text.js';

const EN = UPDATE_TEXTS.en;
const STATUS_KEYS = ['blockedReason', 'canApply', 'news', 'sessions', 'snoozed', 'state'];
const LIVE: OpenSession = { kind: 'live', id: '2026-11-14', title: 'Night in the crypt' };
const CHAT: OpenSession = { kind: 'chat', id: 'conv-1', title: 'Chat' };

let fake: FakeUpdate;

function service(overrides: Partial<FakeUpdate['deps']> = {}): UpdateService {
  fake = fakeUpdate();
  return new UpdateService({ ...fake.deps, ...overrides });
}

describe('status', () => {
  it('is idle when the installed version is the published one', async () => {
    const svc = service();
    fake.world.installed = '1.2.0';
    const status = await svc.check();
    assert.deepEqual(status, {
      state: 'idle',
      news: null,
      snoozed: false,
      canApply: false,
      blockedReason: null,
      sessions: [],
    });
  });

  it('is available with the news, and never carries a version number', async () => {
    const svc = service();
    const status = await svc.check();
    assert.equal(status.state, 'available');
    assert.equal(status.news, 'Something new for the master.');
    assert.equal(status.canApply, true);
    assert.equal(status.blockedReason, null);
    assert.deepEqual(status.sessions, []);
    assert.deepEqual(Object.keys(status).sort(), STATUS_KEYS);
    assert.ok(!JSON.stringify(status).includes('1.2.0'));
  });

  it('is available without news when the news cannot be read', async () => {
    fake = fakeUpdate();
    const base = fake.deps.fetchText;
    const svc = new UpdateService({
      ...fake.deps,
      fetchText: async (url) => {
        if (url.includes('/news/')) throw new Error('down');
        return base(url);
      },
    });
    const status = await svc.check();
    assert.equal(status.state, 'available');
    assert.equal(status.news, null);
    assert.equal(status.canApply, true);
  });

  it('is offline and silent when the source cannot be reached', async () => {
    const svc = service();
    fake.world.offline = true;
    const status = await svc.check();
    assert.deepEqual(status, {
      state: 'offline',
      news: null,
      snoozed: false,
      canApply: false,
      blockedReason: 'offline',
      sessions: [],
    });
    assert.deepEqual(fake.logs, []);
  });

  it('lists the open sessions, and open sessions do not block the update', async () => {
    const svc = service();
    fake.world.sessions = [LIVE, CHAT];
    const status = await svc.check();
    assert.deepEqual(status.sessions, [LIVE, CHAT]);
    assert.equal(status.canApply, true);
    assert.equal(status.blockedReason, null);
  });

  it('checks at most once an hour, and a forced check always reads the source', async () => {
    fake = fakeUpdate();
    let reads = 0;
    const base = fake.deps.fetchText;
    const svc = new UpdateService({
      ...fake.deps,
      fetchText: async (url) => {
        if (url === PLUGIN_MANIFEST_URL) reads += 1;
        return base(url);
      },
    });
    await svc.check();
    assert.equal(reads, 1);
    await svc.status();
    await settle();
    assert.equal(reads, 1, 'a fresh cache is not read again');
    fake.clock.now += CHECK_INTERVAL_MS - 1;
    await svc.status();
    await settle();
    assert.equal(reads, 1);
    fake.clock.now += 1;
    await svc.status();
    await settle();
    assert.equal(reads, 2, 'an hour later the next status starts a background check');
    await svc.check();
    assert.equal(reads, 3, 'a forced check reads the source at once');
  });
});

describe('snooze', () => {
  it('writes the notice memory for the available version and reports it snoozed', async () => {
    const svc = service();
    await svc.check();
    const status = await svc.snooze();
    assert.equal(status.snoozed, true);
    assert.equal(status.state, 'available');
    const file = fs.readFileSync(path.join(fake.campaignRoot, NOTICE_RELATIVE_PATH), 'utf8');
    assert.ok(file.includes('last_notified_version: "1.2.0"'), file);
    assert.ok(file.includes('snoozed_until: "2026-11-15"'), file);
  });

  it('writes nothing when there is no update to snooze', async () => {
    const svc = service();
    fake.world.installed = '1.2.0';
    await svc.check();
    const status = await svc.snooze();
    assert.equal(status.state, 'idle');
    assert.equal(fs.existsSync(path.join(fake.campaignRoot, NOTICE_RELATIVE_PATH)), false);
  });
});

describe('apply refusals', () => {
  it('refuses when no update is available, with a plain sentence and no start', async () => {
    const svc = service();
    fake.world.installed = '1.2.0';
    await svc.check();
    const result = await svc.apply();
    assert.deepEqual(result, { ok: false, error: EN.noUpdate });
    assert.equal(fake.execs.length, 0);
  });

  it('refuses when offline', async () => {
    const svc = service();
    fake.world.offline = true;
    await svc.check();
    assert.deepEqual(await svc.apply(), { ok: false, error: EN.offline });
  });

  it('without confirmation, open sessions answer with them and nothing is closed or started', async () => {
    const svc = service();
    fake.world.sessions = [LIVE, CHAT];
    await svc.check();
    assert.deepEqual(await svc.apply(), { ok: false, error: EN.confirmClose, sessions: [LIVE, CHAT] });
    assert.deepEqual(fake.closed, []);
    assert.equal(fake.execs.length, 0);
    assert.equal(fake.restarts.length, 0);
    assert.equal(fake.shutdowns(), 0);
    assert.deepEqual(fake.world.sessions, [LIVE, CHAT], 'the sessions stay open');
    // A later refusal does not leave the update half started: the next apply can still be confirmed.
    assert.equal((await svc.status()).state, 'available');
  });

  it('a second confirmed apply while the first runs is refused as already running', async () => {
    const svc = service();
    fake.world.sessions = [CHAT];
    await svc.check();
    const first = await svc.apply(() => {}, { confirmClose: true });
    assert.equal(first.ok, true);
    assert.deepEqual(await svc.apply(() => {}, { confirmClose: true }), { ok: false, error: EN.alreadyRunning });
    if (first.ok) await first.done;
  });

  it('refuses a second update while one runs', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const svc = service({
      exec: async (file, args) => {
        fake.execs.push({ file, args });
        await gate;
        return '';
      },
    });
    await svc.check();
    const first = await svc.apply();
    assert.equal(first.ok, true);
    assert.deepEqual(await svc.apply(), { ok: false, error: EN.alreadyRunning });
    release();
    if (first.ok) await first.done;
  });
});

describe('apply', () => {
  it('answers 202 first, runs plugin update then list, restarts on the new launcher and shuts down', async () => {
    const svc = service();
    await svc.check();
    const accepted: string[] = [];
    const result = await svc.apply(() => {
      accepted.push('202');
      fake.order.push('202');
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    await result.done;
    assert.deepEqual(accepted, ['202']);
    assert.deepEqual(fake.order, [
      '202',
      'exec plugin update yllir@yllir --json',
      'exec plugin list --json',
      'restart',
      'shutdown',
    ]);
    assert.equal(fake.execs[0].file, '/fake/bin/claude');
    assert.deepEqual(fake.restarts, [
      {
        pid: 4242,
        launchFile: path.join(fake.installDir, 'scripts', 'launcher', 'launch.mjs'),
        campaignRoot: fake.campaignRoot,
      },
    ]);
    assert.equal(fake.shutdowns(), 1);
    assert.equal((await svc.status()).state, 'restarting');
  });

  it('with confirmation, the sessions are closed first, then the update runs as usual', async () => {
    const svc = service();
    fake.world.sessions = [LIVE, CHAT];
    await svc.check();
    const accepted: string[] = [];
    const result = await svc.apply(
      () => {
        accepted.push('202');
        fake.order.push('202');
      },
      { confirmClose: true },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    await result.done;
    assert.deepEqual(accepted, ['202']);
    assert.deepEqual(fake.closed, [LIVE.id, CHAT.id]);
    assert.deepEqual(fake.order, [
      '202',
      'close',
      'exec plugin update yllir@yllir --json',
      'exec plugin list --json',
      'restart',
      'shutdown',
    ]);
    assert.equal(fake.shutdowns(), 1);
  });

  it('with no open sessions, the update runs directly, without closing anything', async () => {
    const svc = service();
    await svc.check();
    const result = await svc.apply(() => {}, { confirmClose: true });
    assert.equal(result.ok, true);
    if (result.ok) await result.done;
    assert.deepEqual(fake.closed, []);
    assert.ok(!fake.order.includes('close'));
    assert.equal(fake.shutdowns(), 1);
  });

  it('a failed plugin update is failed: nothing restarts, the server keeps running', async () => {
    const svc = service({
      exec: async (file, args) => {
        fake.execs.push({ file, args });
        if (args[1] === 'update') throw new Error('exit 1');
        return '';
      },
    });
    await svc.check();
    const result = await svc.apply();
    assert.equal(result.ok, true);
    if (result.ok) await result.done;
    assert.equal((await svc.status()).state, 'failed');
    assert.equal(fake.restarts.length, 0);
    assert.equal(fake.shutdowns(), 0);
    assert.ok(fake.logs.some((line) => line.includes('exit 1')));
  });

  it('Claude Code not found is failed', async () => {
    const svc = service({ findClaude: () => null });
    await svc.check();
    const result = await svc.apply();
    if (result.ok) await result.done;
    assert.equal((await svc.status()).state, 'failed');
    assert.equal(fake.shutdowns(), 0);
  });

  it('a plugin missing from the list, or a launcher missing from its folder, is failed', async () => {
    fake = fakeUpdate();
    const svc = new UpdateService({ ...fake.deps, exec: async () => JSON.stringify([]) });
    await svc.check();
    let result = await svc.apply();
    if (result.ok) await result.done;
    assert.equal((await svc.status()).state, 'failed');

    fake = fakeUpdate();
    fake.world.installPath = path.join(fake.campaignRoot, 'nowhere');
    const second = new UpdateService(fake.deps);
    await second.check();
    result = await second.apply();
    if (result.ok) await result.done;
    assert.equal((await second.status()).state, 'failed');
    assert.equal(fake.restarts.length, 0);
    assert.equal(fake.shutdowns(), 0);
  });

  it('after a failure the next forced check offers the update again', async () => {
    let fail = true;
    const svc = service({
      exec: async (file, args) => {
        fake.execs.push({ file, args });
        if (fail) throw new Error('boom');
        return args[1] === 'list' ? JSON.stringify([{ id: 'yllir@yllir', installPath: fake.installDir }]) : '';
      },
    });
    await svc.check();
    const first = await svc.apply();
    if (first.ok) await first.done;
    assert.deepEqual(await svc.apply(), { ok: false, error: EN.checkFirst });
    fail = false;
    const status = await svc.check();
    assert.equal(status.state, 'available');
    const retry = await svc.apply();
    assert.equal(retry.ok, true);
    if (retry.ok) await retry.done;
    assert.equal(fake.shutdowns(), 1);
  });
});

describe('closeSessions', () => {
  it('calls the cockpit cancel hook, and does nothing extra when the hook is unset', async () => {
    const root = makeCampaign();
    const ctx = createCtx({ campaignRoot: root, frameworkRoot: root, port: 0, log: () => {} });
    let cancelled = 0;
    ctx.cancelCockpitTurns = () => {
      cancelled += 1;
    };
    const svc = createUpdateService(ctx, { findClaude: () => null });
    const deps = (svc as unknown as { deps: { closeSessions(): Promise<void> } }).deps;
    await deps.closeSessions();
    assert.equal(cancelled, 1);

    delete ctx.cancelCockpitTurns;
    await deps.closeSessions();
    assert.equal(cancelled, 1);
  });
});
