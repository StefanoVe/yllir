import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { siteDirOf } from '../encyclopedia/site.js';
import { openFixture, yamlWithModules, type Fixture } from './fixture.js';
import { SITE_CSP } from './encyclopedia.js';

const report = (ok: boolean, checks: Array<{ id: string; status: 'pass' | 'fail' | 'skipped'; message: string }>) => ({
  ok,
  entries: 3,
  excluded: [],
  warnings: [],
  checks,
  baseUrl: 'http://localhost/',
  generatedAt: '2026-11-12T10:00:00Z',
  previewUrl: null,
});

const OFF = { enabled: false, built: false, report: null, publishing: 'not-configured' };

describe('encyclopedia routes with the module off', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await openFixture(yamlWithModules({ encyclopedia: false, print: false }));
  });
  afterEach(async () => {
    await f.close();
  });

  it('answers the disabled status without running anything', async () => {
    const res = await f.call('GET', '/api/encyclopedia');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, OFF);
    assert.deepEqual(await f.fake.calls(), []);
  });

  it('refuses a build without running it', async () => {
    const res = await f.call('POST', '/api/encyclopedia/build');
    assert.equal(res.status, 409);
    assert.equal((res.json as { error: string }).error, 'The encyclopedia is not turned on for this campaign.');
    assert.deepEqual(await f.fake.calls(), []);
  });

  it('serves no site, even when a build folder is there', async () => {
    const site = siteDirOf(f.root);
    await fs.mkdir(site, { recursive: true });
    await fs.writeFile(path.join(site, 'index.html'), '<h1>old</h1>');
    const res = await f.call('GET', '/enc/');
    assert.equal(res.status, 404);
    assert.notEqual(res.headers['content-security-policy'], SITE_CSP);
    assert.deepEqual(await f.fake.calls(), []);
  });
});

describe('encyclopedia status and build', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await openFixture(yamlWithModules({ encyclopedia: true, print: false }));
  });
  afterEach(async () => {
    await f.close();
  });

  it('runs the CLI status and answers with it', async () => {
    await f.fake.respond('status', { code: 0, json: { built: false, report: null } });
    const res = await f.call('GET', '/api/encyclopedia');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { enabled: true, built: false, report: null, publishing: 'not-configured' });
    assert.deepEqual((await f.fake.calls()).map((c) => c.args), [['status', f.root]]);
  });

  it('answers 500 plainly when the status cannot be read', async () => {
    await f.fake.respond('status', { code: 0, raw: 'garbage' });
    const res = await f.call('GET', '/api/encyclopedia');
    assert.equal(res.status, 500);
    assert.equal((res.json as { error: string }).error, 'The encyclopedia status could not be read. Try again.');
    assert.doesNotMatch(res.text, /garbage/);
  });

  it('returns the report after a successful build, with the preview link only when a build exists', async () => {
    await f.fake.respond('build', { code: 0, json: report(true, [{ id: 'links', status: 'pass', message: 'All links work.' }]) });
    const res = await f.call('POST', '/api/encyclopedia/build');
    assert.equal(res.status, 200);
    const body = res.json as { ok: boolean; previewUrl: string | null; checks: unknown[] };
    assert.equal(body.ok, true);
    assert.equal(body.previewUrl, null);
    assert.deepEqual((await f.fake.calls()).map((c) => c.args), [['build', f.root]]);
  });

  it('answers 409 with the report and the first failed check as the plain error', async () => {
    await f.fake.respond('build', {
      code: 1,
      json: report(false, [
        { id: 'ids', status: 'pass', message: 'Ids are unique.' },
        { id: 'names', status: 'fail', message: 'Two entries share the same name.' },
        { id: 'links', status: 'fail', message: 'Broken link in places/mappa.md' },
      ]),
    });
    const res = await f.call('POST', '/api/encyclopedia/build');
    assert.equal(res.status, 409);
    const body = res.json as { error: string; ok: boolean; checks: Array<{ id: string }> };
    assert.equal(body.error, 'The site was not built because a check did not pass: Two entries share the same name.');
    assert.equal(body.ok, false);
    assert.equal(body.checks.length, 3);
  });

  it('uses the generic sentence when the failed check message is not safe to show', async () => {
    await f.fake.respond('build', {
      code: 1,
      json: report(false, [{ id: 'links', status: 'fail', message: 'Broken link in /Users/x/places/mappa.md' }]),
    });
    const res = await f.call('POST', '/api/encyclopedia/build');
    assert.equal(res.status, 409);
    assert.equal(
      (res.json as { error: string }).error,
      'The site was not built because a check did not pass: one of the checks did not pass',
    );
    assert.doesNotMatch(res.text, /Users/);
  });

  it('answers 500 plainly when the build output cannot be read', async () => {
    await f.fake.respond('build', { code: 0, raw: 'not json /Users/x/secret' });
    const res = await f.call('POST', '/api/encyclopedia/build');
    assert.equal(res.status, 500);
    assert.equal((res.json as { error: string }).error, 'The encyclopedia could not be built. Try again.');
    assert.doesNotMatch(res.text, /secret|Users/);
  });

  it('refuses a second build while one runs, and a sheet job too (one job per campaign)', async () => {
    await f.fake.respond('build', { code: 0, json: report(true, []), sleepMs: 900 });
    await f.fake.respond('sheets', { code: 0, json: { ok: true } });
    const first = f.call('POST', '/api/encyclopedia/build');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const second = await f.call('POST', '/api/encyclopedia/build');
    assert.equal(second.status, 409);
    assert.match((second.json as { error: string }).error, /Another build or sheet job is running/);
    const firstAnswer = await first;
    assert.equal(firstAnswer.status, 200);
  });
});

describe('the built site at /enc', () => {
  let f: Fixture;
  let site: string;
  let outside: string;

  beforeEach(async () => {
    f = await openFixture(yamlWithModules({ encyclopedia: true, print: false }));
    site = siteDirOf(f.root);
    await fs.mkdir(path.join(site, 'e', 'mappa'), { recursive: true });
    await fs.mkdir(path.join(site, 'empty'), { recursive: true });
    await fs.writeFile(path.join(site, 'index.html'), '<h1>home</h1>');
    await fs.writeFile(path.join(site, 'e', 'mappa', 'index.html'), '<h1>mappa</h1>');
    await fs.writeFile(path.join(site, '.env'), 'TOKEN=1');
    outside = path.join(f.root, 'secret.txt');
    await fs.writeFile(outside, 'campaign secret');
    await fs.symlink(outside, path.join(site, 'leak.txt'));
  });
  afterEach(async () => {
    await f.close();
  });

  it('serves the site read-only with its own strict CSP and nosniff', async () => {
    const res = await f.call('GET', '/enc/');
    assert.equal(res.status, 200);
    assert.match(res.text, /home/);
    assert.equal(res.headers['content-security-policy'], SITE_CSP);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(
      SITE_CSP,
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    );
  });

  it('serves an entry folder index', async () => {
    const res = await f.call('GET', '/enc/e/mappa/');
    assert.equal(res.status, 200);
    assert.match(res.text, /mappa/);
  });

  it('refuses writes', async () => {
    const res = await f.call('POST', '/enc/');
    assert.equal(res.status, 404);
  });

  it('refuses dotfiles, folders without index, symlinks out of the site and traversal', async () => {
    for (const bad of [
      '/enc/.env',
      '/enc/empty/',
      '/enc/leak.txt',
      '/enc/%2e%2e/secret.txt',
      '/enc/..%2Fsecret.txt',
      '/enc/%2E%2E%2F%2E%2E%2Fsecret.txt',
      '/enc/../secret.txt',
      '/enc/missing.html',
    ]) {
      const res = await f.call('GET', bad);
      assert.equal(res.status, 404, bad);
      assert.doesNotMatch(res.text, /campaign secret|TOKEN/, bad);
    }
  });

  it('keeps the main app CSP unchanged for the other paths and adds frame-src self', async () => {
    const res = await f.call('GET', '/api/status');
    const csp = String(res.headers['content-security-policy']);
    assert.match(csp, /frame-src 'self'/);
    assert.doesNotMatch(csp, /youtube/);
    assert.doesNotMatch(csp, /SAMEORIGIN/);
    assert.notEqual(res.headers['content-security-policy'], SITE_CSP);
  });
});

describe('the site with the module on but no build yet', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await openFixture(yamlWithModules({ encyclopedia: true, print: false }));
  });
  afterEach(async () => {
    await f.close();
  });

  it('answers 404 in plain words and does not run the framework', async () => {
    const res = await f.call('GET', '/enc/');
    assert.equal(res.status, 404);
    assert.equal((res.json as { error: string }).error, 'The encyclopedia has not been built yet. Build it first.');
    assert.notEqual(res.headers['content-security-policy'], SITE_CSP);
    assert.deepEqual(await f.fake.calls(), []);
  });
});
