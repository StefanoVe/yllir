import { describe, expect, it } from 'vitest';
import type { Turn, TurnStep } from '@shared/types';
import { helpersCountKey, runningHelpers } from './helpers';

const AT = '2026-11-13T10:00:00.000Z';

function step(id: string, patch: Partial<TurnStep> = {}): TurnStep {
  return { id, kind: 'agent', text: `Helper ${id}`, at: AT, state: 'running', ...patch };
}

function turn(state: Turn['state'], steps?: TurnStep[]): Turn {
  return { id: 't1', messageId: 'm1', state, activity: '', startedAt: AT, steps };
}

describe('runningHelpers', () => {
  it('returns the running helper steps of a running turn, in order', () => {
    const steps = [step('a'), step('r', { kind: 'read' }), step('b', { state: 'done' }), step('c')];
    expect(runningHelpers(turn('running', steps)).map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('gives nothing for a done, failed or cancelled turn', () => {
    const steps = [step('a')];
    expect(runningHelpers(turn('done', steps))).toEqual([]);
    expect(runningHelpers(turn('error', steps))).toEqual([]);
    expect(runningHelpers(turn('cancelled', steps))).toEqual([]);
  });

  it('gives nothing for a queued turn, even when its steps say running', () => {
    expect(runningHelpers(turn('queued', [step('a')]))).toEqual([]);
  });

  it('gives nothing when there is no turn or the turn has no steps', () => {
    expect(runningHelpers(null)).toEqual([]);
    expect(runningHelpers(turn('running'))).toEqual([]);
  });

  it('counts a helper nested under another step only when it is a helper itself', () => {
    const steps = [
      step('parent'),
      step('child-read', { kind: 'read', parentId: 'parent' }),
      step('child-helper', { kind: 'agent', parentId: 'parent' }),
    ];
    expect(runningHelpers(turn('running', steps)).map((s) => s.id)).toEqual(['parent', 'child-helper']);
  });

  it('ignores a helper that is already done while another one runs', () => {
    const steps = [step('a', { state: 'failed' }), step('b')];
    expect(runningHelpers(turn('running', steps)).map((s) => s.id)).toEqual(['b']);
  });
});

describe('helpersCountKey', () => {
  it('uses the singular key for exactly one and the other key otherwise', () => {
    expect(helpersCountKey(1)).toBe('helpers.working.one');
    expect(helpersCountKey(2)).toBe('helpers.working.other');
    expect(helpersCountKey(0)).toBe('helpers.working.other');
  });
});
