import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { listCampaignDocuments, resolveCampaignFile } from './scan.js';
import { externalFolders, setExternalFrameworkRoot } from './external.js';
import { REAL_FRAMEWORK, worldFixture } from './test-support.js';

const roots: string[] = [];

async function campaign(files: string[]): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yllir-scan-'));
  roots.push(root);
  for (const rel of files) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), '# doc\n');
  }
  return root;
}

after(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
});

describe('listCampaignDocuments', () => {
  it('leaves out CLAUDE.md and AGENTS.md at the campaign root only', async () => {
    const root = await campaign([
      'CLAUDE.md',
      'AGENTS.md',
      'README.md',
      'places/CLAUDE.md',
      'places/AGENTS.md',
      'places/harbor.md',
    ]);
    const rels = (await listCampaignDocuments(root)).map((doc) => doc.rel);
    assert.deepEqual(rels, ['README.md', 'places/AGENTS.md', 'places/CLAUDE.md', 'places/harbor.md']);
  });

  it('is case-sensitive about the excluded root names', async () => {
    const root = await campaign(['claude.md', 'agents.md']);
    const rels = (await listCampaignDocuments(root)).map((doc) => doc.rel);
    assert.deepEqual(rels, ['agents.md', 'claude.md']);
  });
});

describe('external categories', () => {
  let fixture: Awaited<ReturnType<typeof worldFixture>>;

  before(async () => {
    setExternalFrameworkRoot(REAL_FRAMEWORK);
    fixture = await worldFixture();
    roots.push(fixture.base);
  });

  after(() => setExternalFrameworkRoot(null));

  it('reads the external folders from campaign.yaml and gives [] when the file is invalid', async () => {
    assert.deepEqual(await externalFolders(fixture.campaign), ['shared']);
    const broken = await campaign(['campaign.yaml']);
    await fs.writeFile(path.join(broken, 'campaign.yaml'), 'structure: [\n');
    assert.deepEqual(await externalFolders(broken), []);
  });

  it('lists the documents of a linked external folder through the link, and nothing else of the links', async () => {
    const rels = (await listCampaignDocuments(fixture.campaign)).map((doc) => doc.rel);
    assert.deepEqual(rels, ['characters/mara.md', 'shared/Luoghi/Raatnagar.md']);
  });

  it('resolves a document of an external folder, and reports its real location', async () => {
    const resolved = await resolveCampaignFile(fixture.campaign, 'shared/Luoghi/Raatnagar.md');
    assert.deepEqual(resolved, {
      abs: await fs.realpath(path.join(fixture.world, 'Luoghi', 'Raatnagar.md')),
      rel: 'shared/Luoghi/Raatnagar.md',
    });
  });

  it('refuses links and paths that leave the campaign or the external folder', async () => {
    for (const rel of [
      'linked.md',
      'linkdir/secret.md',
      'shared/Luoghi/alias-secret.md',
      'shared/../outside/secret.md',
      '../outside/secret.md',
    ]) {
      assert.equal(await resolveCampaignFile(fixture.campaign, rel), null, rel);
    }
    const rels = (await listCampaignDocuments(fixture.campaign)).map((doc) => doc.rel);
    assert.ok(!rels.some((rel) => rel.includes('secret') || rel.startsWith('linkdir') || rel.startsWith('linked')));
  });
});
