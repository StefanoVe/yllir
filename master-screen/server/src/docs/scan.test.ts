import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { listCampaignDocuments } from './scan.js';

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
