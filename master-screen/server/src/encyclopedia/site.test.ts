import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { encyclopediaEnabledInYaml } from './config.js';
import { resolveSiteFile, resolveSiteRoot, siteDirOf } from './site.js';

describe('encyclopedia config reader', () => {
  it('reads modules.encyclopedia from the modules block only', () => {
    assert.equal(encyclopediaEnabledInYaml('modules:\n  encyclopedia: true\n'), true);
    assert.equal(encyclopediaEnabledInYaml('modules:\n  encyclopedia: "false"\n'), false);
    assert.equal(encyclopediaEnabledInYaml('modules:\n  music: true\n'), false);
    assert.equal(encyclopediaEnabledInYaml('encyclopedia: true\n'), false);
    assert.equal(encyclopediaEnabledInYaml(''), false);
  });
});

describe('built site path resolution', () => {
  let root: string;
  let site: string;
  let realSite: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-site-'));
    site = siteDirOf(root);
    await fs.mkdir(path.join(site, 'e', 'mappa'), { recursive: true });
    await fs.mkdir(path.join(site, 'empty'), { recursive: true });
    await fs.writeFile(path.join(site, 'index.html'), '<h1>home</h1>');
    await fs.writeFile(path.join(site, 'e', 'mappa', 'index.html'), '<h1>mappa</h1>');
    await fs.writeFile(path.join(site, '.hidden'), 'secret');
    await fs.writeFile(path.join(root, 'outside.txt'), 'outside');
    await fs.symlink(path.join(root, 'outside.txt'), path.join(site, 'leak.txt'));
    realSite = await fs.realpath(site);
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('finds the built root only when index.html exists', async () => {
    assert.equal(await resolveSiteRoot(root), realSite);
    const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-site-bare-'));
    try {
      assert.equal(await resolveSiteRoot(bare), null);
    } finally {
      await fs.rm(bare, { recursive: true, force: true });
    }
  });

  it('serves the root, a folder index and plain files inside the site', async () => {
    assert.equal(await resolveSiteFile(realSite, '/'), path.join(realSite, 'index.html'));
    assert.equal(await resolveSiteFile(realSite, '/e/mappa/'), path.join(realSite, 'e', 'mappa', 'index.html'));
    assert.equal(await resolveSiteFile(realSite, '/index.html'), path.join(realSite, 'index.html'));
  });

  it('refuses dotfiles, traversal, encoded traversal, symlinks out of the site, folders without index', async () => {
    for (const bad of [
      '/.hidden',
      '/../outside.txt',
      '/e/../../outside.txt',
      '/%2e%2e/outside.txt',
      '/%2E%2E%2Foutside.txt',
      '/..%2Foutside.txt',
      '/leak.txt',
      '/empty/',
      '/%E0%A4%A',
      '/bad\\name',
      '/nul%00.txt',
      '/missing.html',
    ]) {
      assert.equal(await resolveSiteFile(realSite, bad), null, bad);
    }
  });
});
