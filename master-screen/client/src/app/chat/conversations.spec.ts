import { describe, expect, it } from 'vitest';
import type { Turn } from '@shared/types';
import { displayTitle, nextCampaignTurn, pickSelectedId } from './conversations';

describe('displayTitle', () => {
  it('shows the title as it is', () => {
    expect(displayTitle('La locanda', 'New conversation')).toBe('La locanda');
  });

  it('falls back to the default name when the title is empty or only spaces', () => {
    expect(displayTitle('', 'New conversation')).toBe('New conversation');
    expect(displayTitle('   ', 'New conversation')).toBe('New conversation');
    expect(displayTitle(undefined, 'New conversation')).toBe('New conversation');
    expect(displayTitle(null, 'New conversation')).toBe('New conversation');
  });
});

describe('pickSelectedId', () => {
  const list = [{ id: 'c2' }, { id: 'c1' }];

  it('uses the saved conversation when it is still in the list', () => {
    expect(pickSelectedId(list, 'c1', 'c2')).toBe('c1');
  });

  it('falls back to the server current conversation when the saved one is gone', () => {
    expect(pickSelectedId(list, 'deleted', 'c2')).toBe('c2');
  });

  it('falls back to the current conversation when nothing is saved', () => {
    expect(pickSelectedId(list, null, 'c1')).toBe('c1');
  });
});

describe('nextCampaignTurn', () => {
  const turn = (id: string, state: Turn['state']): Turn => ({
    id,
    messageId: 'm',
    state,
    activity: '',
    startedAt: '2026-11-12T10:00:00.000Z',
  });

  it('takes any event when nothing is running', () => {
    expect(nextCampaignTurn(null, turn('t1', 'queued'))).toEqual(turn('t1', 'queued'));
    expect(nextCampaignTurn(turn('t0', 'done'), turn('t1', 'running'))).toEqual(turn('t1', 'running'));
  });

  it('keeps the running turn when a different turn is queued', () => {
    const running = turn('t1', 'running');
    expect(nextCampaignTurn(running, turn('t2', 'queued'))).toBe(running);
  });

  it('replaces the running turn when its own event ends it', () => {
    expect(nextCampaignTurn(turn('t1', 'running'), turn('t1', 'done'))).toEqual(turn('t1', 'done'));
  });
});
