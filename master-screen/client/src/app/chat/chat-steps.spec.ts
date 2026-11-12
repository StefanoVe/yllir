import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TurnStep } from '@shared/types';
import {
  formatDuration,
  isSlowImage,
  loadStepsExpanded,
  mergeSteps,
  nestSteps,
  saveStepsExpanded,
  stepElapsedMs,
  stepIcon,
} from './chat-steps';

const AT = '2026-11-12T10:00:00.000Z';
const step = (id: string, extra: Partial<TurnStep> = {}): TurnStep => ({
  id,
  kind: 'read',
  text: id,
  at: AT,
  state: 'done',
  ...extra,
});

describe('formatDuration', () => {
  it('shows whole seconds under a minute', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(999)).toBe('0 s');
    expect(formatDuration(12_000)).toBe('12 s');
  });

  it('shows minutes with zero-padded seconds', () => {
    expect(formatDuration(60_000)).toBe('1 min 00 s');
    expect(formatDuration(65_900)).toBe('1 min 05 s');
  });

  it('reads negative or invalid input as zero', () => {
    expect(formatDuration(-5_000)).toBe('0 s');
    expect(formatDuration(Number.NaN)).toBe('0 s');
  });
});

describe('stepElapsedMs and isSlowImage', () => {
  it('uses endedAt for finished steps and now for running ones', () => {
    const start = Date.parse(AT);
    expect(stepElapsedMs(step('a', { endedAt: new Date(start + 3000).toISOString() }), start + 99_000)).toBe(3000);
    expect(stepElapsedMs(step('b', { state: 'running' }), start + 7000)).toBe(7000);
  });

  it('never returns a negative duration', () => {
    expect(stepElapsedMs(step('a', { state: 'running' }), Date.parse(AT) - 5000)).toBe(0);
  });

  it('flags only running image steps older than 20 seconds', () => {
    const start = Date.parse(AT);
    const running = step('img', { kind: 'image', state: 'running' });
    expect(isSlowImage(running, start + 20_000)).toBe(false);
    expect(isSlowImage(running, start + 21_000)).toBe(true);
    expect(isSlowImage({ ...running, kind: 'read' }, start + 60_000)).toBe(false);
    expect(isSlowImage({ ...running, state: 'done' }, start + 60_000)).toBe(false);
  });
});

describe('nestSteps', () => {
  it('keeps the order of top-level steps and puts children right after their parent', () => {
    const rows = nestSteps([
      step('a'),
      step('b'),
      step('b1', { parentId: 'b' }),
      step('c'),
      step('b2', { parentId: 'b' }),
    ]);
    expect(rows.map((r) => [r.step.id, r.depth])).toEqual([
      ['a', 0],
      ['b', 0],
      ['b1', 1],
      ['b2', 1],
      ['c', 0],
    ]);
  });

  it('treats a child with a missing parent as top level', () => {
    const rows = nestSteps([step('x', { parentId: 'gone' })]);
    expect(rows).toEqual([{ step: expect.objectContaining({ id: 'x' }), depth: 0 }]);
  });

  it('nests grandchildren deeper and caps the depth', () => {
    const rows = nestSteps([step('p'), step('c', { parentId: 'p' }), step('g', { parentId: 'c' }), step('h', { parentId: 'g' })]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 2]);
  });

  it('terminates on a parent cycle and lists each step once', () => {
    const rows = nestSteps([step('a', { parentId: 'b' }), step('b', { parentId: 'a' })]);
    expect(rows.map((r) => r.step.id).sort()).toEqual(['a', 'b']);
  });
});

describe('stepIcon', () => {
  it('maps every kind to its icon', () => {
    expect(stepIcon('read')).toBe('FileText');
    expect(stepIcon('search')).toBe('Search');
    expect(stepIcon('write')).toBe('PencilLine');
    expect(stepIcon('skill')).toBe('Sparkles');
    expect(stepIcon('image')).toBe('Image');
    expect(stepIcon('check')).toBe('ListChecks');
    expect(stepIcon('save')).toBe('Save');
    expect(stepIcon('agent')).toBe('Users');
    expect(stepIcon('music')).toBe('Music');
    expect(stepIcon('open')).toBe('ExternalLink');
    expect(stepIcon('other')).toBe('Circle');
  });

  it('falls back to the generic icon for an unknown kind', () => {
    expect(stepIcon('mystery' as TurnStep['kind'])).toBe('Circle');
  });
});

describe('mergeSteps', () => {
  it('keeps shown steps when the fresh list is shorter', () => {
    const shown = [step('a', { state: 'done' }), step('b', { state: 'running' })];
    const merged = mergeSteps(shown, [step('b', { state: 'running' })]);
    expect(merged.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('takes the newer state for a step', () => {
    const merged = mergeSteps([step('a', { state: 'running' })], [step('a', { state: 'done', endedAt: AT })]);
    expect(merged[0].state).toBe('done');
  });

  it('never moves a finished step back to running', () => {
    const merged = mergeSteps([step('a', { state: 'failed' })], [step('a', { state: 'running' })]);
    expect(merged[0].state).toBe('failed');
  });

  it('appends new steps after the shown ones', () => {
    const merged = mergeSteps([step('a')], [step('b'), step('a')]);
    expect(merged.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('returns the fresh list when nothing was shown', () => {
    expect(mergeSteps(undefined, [step('a')]).map((s) => s.id)).toEqual(['a']);
  });
});

describe('expansion memory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('is collapsed by default and remembers the choice', () => {
    expect(loadStepsExpanded()).toBe(false);
    saveStepsExpanded(true);
    expect(loadStepsExpanded()).toBe(true);
    saveStepsExpanded(false);
    expect(loadStepsExpanded()).toBe(false);
  });

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadStepsExpanded()).toBe(false);
    expect(() => saveStepsExpanded(true)).not.toThrow();
  });
});
