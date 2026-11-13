import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { SettingsResponse } from '../../../shared/src/types.js';
import { DEFAULT_SETTINGS } from '../settings/schema.js';
import { get, makeCampaign, send, startApp, type Harness } from '../live/test-support.js';

const REAL_FRAMEWORK = fileURLToPath(new URL('../../../../yllir', import.meta.url));
const SETTINGS_PATH = '.campaign/master-screen.yaml';

const harnesses: Harness[] = [];
after(async () => {
  for (const h of harnesses) {
    await h.server.close();
    await h.ctx.closeAll();
  }
});

/** A campaign folder that is a git repository with campaign.yaml committed. */
function gitCampaign(): string {
  const root = makeCampaign();
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test Author');
  git('config', 'user.email', 'author@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return root;
}

async function harnessFor(root: string): Promise<Harness> {
  const h = await startApp(root, REAL_FRAMEWORK);
  harnesses.push(h);
  return h;
}

describe('GET and PUT /api/settings', () => {
  it('GET with no file answers the defaults, nothing explicit, canSave true', async () => {
    const h = await harnessFor(gitCampaign());
    const res = await get(h, '/settings');
    assert.equal(res.status, 200, res.text);
    const body = res.json as SettingsResponse;
    assert.deepEqual(body.settings, DEFAULT_SETTINGS);
    assert.deepEqual(body.defaults, DEFAULT_SETTINGS);
    assert.deepEqual(body.explicit, []);
    assert.equal(body.canSave, true);
  });

  it('PUT merges the patch, writes only the explicit keys, makes one commit and leaves the tree clean', async () => {
    const root = gitCampaign();
    const h = await harnessFor(root);
    const res = await send(h, 'PUT', '/settings', { combat: { autoHideSeconds: 7 }, ui: { rail: { print: false } } });
    assert.equal(res.status, 200, res.text);
    const body = res.json as SettingsResponse;
    assert.equal(body.settings.combat.autoHideSeconds, 7);
    assert.equal(body.settings.ui.rail.print, false);
    assert.equal(body.settings.ui.rail.plot, true);
    assert.deepEqual(body.explicit.sort(), ['combat.autoHideSeconds', 'ui.rail.print']);
    assert.ok(h.events.some((e) => e.event === 'settings'));

    const file = fs.readFileSync(path.join(root, SETTINGS_PATH), 'utf8');
    assert.ok(file.includes('auto_hide_seconds: 7'), file);
    const log = execFileSync('git', ['-C', root, 'log', '--oneline', '--', SETTINGS_PATH], { encoding: 'utf8' });
    assert.equal(log.trim().split('\n').length, 1, log);
    const status = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
    assert.equal(status, '');
  });

  it('PUT with invalid bodies answers 400 and leaves the file unchanged', async () => {
    const root = gitCampaign();
    const h = await harnessFor(root);
    const ok = await send(h, 'PUT', '/settings', { music: { volume: 20 } });
    assert.equal(ok.status, 200, ok.text);
    const before = fs.readFileSync(path.join(root, SETTINGS_PATH), 'utf8');

    for (const body of [{ combat: { autoHideSeconds: 99 } }, { foo: 1 }, ['list']]) {
      const res = await send(h, 'PUT', '/settings', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(res.json, { error: 'Invalid settings' });
    }
    assert.equal(fs.readFileSync(path.join(root, SETTINGS_PATH), 'utf8'), before);
  });

  it('a campaign folder without git reports canSave false and PUT answers 409 without writing', async () => {
    const root = makeCampaign();
    const h = await harnessFor(root);
    const got = await get(h, '/settings');
    assert.equal(got.status, 200, got.text);
    assert.equal((got.json as SettingsResponse).canSave, false);

    const res = await send(h, 'PUT', '/settings', { combat: { autoHideSeconds: 7 } });
    assert.equal(res.status, 409, res.text);
    assert.deepEqual(res.json, {
      error: 'This campaign folder has no saved history, so settings cannot be saved.',
    });
    assert.equal(fs.existsSync(path.join(root, SETTINGS_PATH)), false);
  });

  it('a second PUT keeps the keys the first one set', async () => {
    const root = gitCampaign();
    const h = await harnessFor(root);
    assert.equal((await send(h, 'PUT', '/settings', { combat: { autoHideSeconds: 7 } })).status, 200);
    const res = await send(h, 'PUT', '/settings', { ui: { rail: { print: false } } });
    assert.equal(res.status, 200, res.text);
    const body = res.json as SettingsResponse;
    assert.equal(body.settings.combat.autoHideSeconds, 7);
    assert.equal(body.settings.ui.rail.print, false);
    assert.deepEqual(body.explicit.sort(), ['combat.autoHideSeconds', 'ui.rail.print']);

    const again = await get(h, '/settings');
    assert.deepEqual((again.json as SettingsResponse).explicit.sort(), ['combat.autoHideSeconds', 'ui.rail.print']);
  });
});
