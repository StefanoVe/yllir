import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Ctx } from '../context.js';
import { createHostPorts } from './index.js';
import { contextFor, copyFixture, removeCampaign } from './test-support.js';

describe('cockpit host ports', () => {
  it('builds every port over the fixture campaign', async () => {
    const root = await copyFixture();
    const ctx: Ctx = contextFor(root);
    try {
      const ports = createHostPorts(ctx);
      await ports.archive.idle();
      assert.ok(ports.archive.docs.size > 0);
      assert.equal(ports.categories.kindOf('Personaggi/Oria Valdes.md'), 'npc');
      const maps = await ports.listMaps(ports.archive.docs.values());
      assert.ok(Array.isArray(maps));
      assert.ok(Array.isArray(await ports.listImages(ports.archive.docs.values(), maps)));
      assert.ok(Array.isArray(ports.buildPlotGraph(ports.archive.docs.values()).nodes));
      assert.equal(ports.archive.search('Morvalle').total > 0, true);
    } finally {
      await ctx.closeAll();
      await removeCampaign(root);
    }
  });
});
