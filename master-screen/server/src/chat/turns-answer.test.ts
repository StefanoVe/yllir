import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createFakeProvider } from '../agent/fake-provider.js';
import { createChatService } from './index.js';
import { makeCampaign, waitFor, type TestCampaign } from './test-support.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('stored agent message', () => {
  it('is exactly the answer, even when narration reached the delta stream', async () => {
    const campaign: TestCampaign = makeCampaign();
    cleanups.push(campaign.cleanup);
    const provider = createFakeProvider([
      { type: 'activity', text: 'Looking in the documents…' },
      { type: 'delta', text: 'Pending migration: read post-update.md.\n\nThe answer.' },
      { type: 'done' },
    ]);
    const service = createChatService(campaign.ctx, provider);
    const sub = await service.runner.submit('ciao');
    assert.ok(sub);
    await waitFor(() => service.store.messages().some((m) => m.role === 'agent'), 'agent message stored');
    const agent = service.store.messages().filter((m) => m.role === 'agent');
    assert.deepEqual(agent.map((m) => m.text), ['The answer.']);
    await service.runner.close();
  });
});
