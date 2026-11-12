import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';
import { createApp } from '../app.js';
import type { Ctx } from '../context.js';
import { createCtx } from '../context.js';
import { makeRepo, CAMPAIGN_YAML_EN, type TestRepo } from '../history/test-repo.js';
import { request, startServer, type RunningServer } from '../testing.js';

const REAL_FRAMEWORK = fileURLToPath(new URL('../../../../yllir', import.meta.url));

interface Published {
  event: string;
  data: unknown;
}

interface Harness {
  repo: TestRepo;
  port: number;
  events: Published[];
  server: RunningServer;
}

/** Starts the real app on a free port over a repo. Bus events are recorded instead of streamed. */
async function harness(repo: TestRepo): Promise<Harness> {
  const events: Published[] = [];
  let ctx: Ctx | undefined;
  const server = await startServer((port) => {
    ctx = createCtx({ campaignRoot: repo.root, frameworkRoot: REAL_FRAMEWORK, port, log: () => {} });
    const bus = ctx.bus as unknown as { publish: (event: string, data: unknown) => number };
    bus.publish = (event, data) => {
      events.push({ event, data });
      return 0;
    };
    return createApp(ctx);
  });
  return { repo, port: server.port, events, server };
}

function get(h: Harness, route: string) {
  return request(h.port, { path: `/api${route}` });
}

function post(h: Harness, route: string, body: unknown) {
  return request(h.port, {
    method: 'POST',
    path: `/api${route}`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface BaseCommits {
  first: string;
  second: string;
  third: string;
}

/** Three commits: hero created, hero updated, villain added. */
function baseRepo(): { repo: TestRepo; commits: BaseCommits } {
  const repo = makeRepo('ms-changes-');
  repo.write('campaign.yaml', CAMPAIGN_YAML_EN);
  repo.write('sheets/hero.md', 'one\n');
  const first = repo.commit('Created the hero sheet; version 0.1.0');
  repo.write('sheets/hero.md', 'two\n');
  const second = repo.commit('Updated the hero; version 0.2.0');
  repo.write('sheets/villain.md', 'villain\n');
  const third = repo.commit('Added the villain sheet');
  return { repo, commits: { first, second, third } };
}

describe('changes routes', () => {
  let open: Harness | undefined;

  afterEach(async () => {
    await open?.server.close();
    open?.repo.cleanup();
    open = undefined;
  });

  it('lists groups newest first and honours the limit', async () => {
    const { repo } = baseRepo();
    open = await harness(repo);
    const all = await get(open, '/changes');
    assert.equal(all.status, 200);
    const groups = (all.json as { groups: Array<{ summary: string }> }).groups;
    assert.deepEqual(
      groups.map((g) => g.summary),
      ['Added the villain sheet', 'Updated the hero', 'Created the hero sheet'],
    );
    const limited = await get(open, '/changes?limit=2');
    assert.equal((limited.json as { groups: unknown[] }).groups.length, 2);
    const clamped = await get(open, '/changes?limit=500');
    assert.equal(clamped.status, 200);
  });

  it('validates the id and reports unknown commits', async () => {
    const { repo, commits } = baseRepo();
    open = await harness(repo);
    assert.equal((await get(open, '/changes/xyz/diff')).status, 400);
    assert.equal((await get(open, '/changes/abc123/diff')).status, 400);
    assert.equal((await get(open, '/changes/deadbeef/diff')).status, 404);
    const diff = await get(open, `/changes/${commits.second.slice(0, 7)}/diff`);
    assert.equal(diff.status, 200);
    const body = diff.json as { id: string; files: Array<{ path: string; status: string }> };
    assert.equal(body.id, commits.second);
    assert.deepEqual(body.files.map((f) => [f.path, f.status]), [['sheets/hero.md', 'modified']]);
  });

  it('undoes the newest group, adds an Undo commit and publishes the touched files', async () => {
    const { repo } = baseRepo();
    open = await harness(repo);
    const res = await post(open, '/changes/undo', {});
    assert.equal(res.status, 200);
    const body = res.json as { ok: boolean; message: string; groupId: string };
    assert.equal(body.ok, true);
    assert.equal(body.message, 'Undone: Added the villain sheet');
    assert.equal(fs.existsSync(path.join(repo.root, 'sheets/villain.md')), false);
    assert.equal(repo.git('log', '-1', '--format=%s'), 'Undo: Added the villain sheet');
    assert.deepEqual(open.events.map((e) => e.event), ['changes', 'files']);
    assert.deepEqual(open.events[1].data, { changed: [], removed: ['sheets/villain.md'] });
    const groups = (await get(open, '/changes')).json as { groups: Array<{ isUndo: boolean; undone: boolean }> };
    assert.equal(groups.groups[0].isUndo, true);
    assert.equal(groups.groups[1].undone, true);
  });

  it('a second undo targets the next group, and an undo with nothing left is refused', async () => {
    const { repo } = baseRepo();
    open = await harness(repo);
    await post(open, '/changes/undo', {});
    const second = await post(open, '/changes/undo', {});
    assert.equal(second.status, 200);
    assert.equal(fs.readFileSync(path.join(repo.root, 'sheets/hero.md'), 'utf8'), 'one\n');
    assert.equal((second.json as { message: string }).message, 'Undone: Updated the hero');

    const third = await post(open, '/changes/undo', {});
    assert.equal(third.status, 200);
    assert.equal(fs.existsSync(path.join(repo.root, 'sheets/hero.md')), false);

    const none = await post(open, '/changes/undo', {});
    assert.equal(none.status, 409);
    assert.equal((none.json as { ok: boolean }).ok, false);
  });

  it('refuses an explicit undo of an undone group or of an undo entry', async () => {
    const { repo, commits } = baseRepo();
    open = await harness(repo);
    const undone = await post(open, '/changes/undo', {});
    const undoSha = repo.git('rev-parse', 'HEAD');
    assert.equal((undone.json as { ok: boolean }).ok, true);

    const again = await post(open, '/changes/undo', { id: commits.third.slice(0, 7) });
    assert.equal(again.status, 409);
    const ofUndo = await post(open, '/changes/undo', { id: undoSha });
    assert.equal(ofUndo.status, 409);
    assert.equal((await post(open, '/changes/undo', { id: 'not-a-sha' })).status, 400);
  });

  it('refuses to undo with unsaved canon edits and changes nothing', async () => {
    const { repo, commits } = baseRepo();
    open = await harness(repo);
    repo.write('sheets/unsaved.md', 'draft\n');
    const res = await post(open, '/changes/undo', {});
    assert.equal(res.status, 409);
    assert.equal(repo.git('rev-parse', 'HEAD'), commits.third);
    assert.equal(fs.existsSync(path.join(repo.root, 'sheets/villain.md')), true);
    assert.equal(open.events.length, 0);
  });

  it('refuses a conflicting undo, aborts the revert and leaves the tree clean', async () => {
    const repo = makeRepo('ms-changes-conflict-');
    repo.write('campaign.yaml', CAMPAIGN_YAML_EN);
    repo.write('notes/value.md', 'a\n');
    repo.commit('Set the value to a');
    repo.write('notes/value.md', 'b\n');
    const middle = repo.commit('Set the value to b');
    repo.write('notes/value.md', 'c\n');
    const newest = repo.commit('Set the value to c');
    open = await harness(repo);

    const res = await post(open, '/changes/undo', { id: middle.slice(0, 7) });
    assert.equal(res.status, 409);
    assert.equal((res.json as { ok: boolean }).ok, false);
    assert.equal(repo.git('rev-parse', 'HEAD'), newest);
    assert.equal(fs.readFileSync(path.join(repo.root, 'notes/value.md'), 'utf8'), 'c\n');
    assert.equal(repo.git('status', '--porcelain'), '');
    assert.equal(open.events.length, 0);
  });

  it('runs simultaneous undos one at a time, each on its own group', async () => {
    const { repo, commits } = baseRepo();
    open = await harness(repo);
    const [a, b] = await Promise.all([post(open, '/changes/undo', {}), post(open, '/changes/undo', {})]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const ids = [
      (a.json as { groupId: string }).groupId,
      (b.json as { groupId: string }).groupId,
    ].sort();
    assert.deepEqual(ids, [commits.second, commits.third].sort());
    assert.equal(fs.readFileSync(path.join(repo.root, 'sheets/hero.md'), 'utf8'), 'one\n');
  });
});
