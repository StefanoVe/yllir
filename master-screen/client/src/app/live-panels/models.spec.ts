import { describe, expect, it } from 'vitest';
import type { CombatState, Combatant, LogEntry } from '@shared/types';
import { combatRows, conditionOptions, hpView, parseAmount, parseOptionalInt, CONDITION_IDS } from './combat-model';
import { groupByKind, isOpenThread, openThreads, sceneLabel, timelineEntries } from './log-model';
import { PendingControls } from './pending';
import { CARD_DRAG_TYPE, readCardDrag } from './drag';
import { parseRecents, pushRecent } from './lookup-model';
import { DocSearch } from './doc-search';
import { panelText } from './strings';
import type { SearchHit } from '@shared/types';

function entry(id: string, kind: LogEntry['kind'], extra: Partial<LogEntry> = {}): LogEntry {
  return { id, at: '2026-11-12T20:00:00.000Z', kind, text: `text ${id}`, by: 'master', ...extra };
}

function combatant(id: string, extra: Partial<Combatant> = {}): Combatant {
  return { id, name: id.toUpperCase(), side: 'enemy', initiative: null, conditions: [], resources: {}, ...extra };
}

function combat(extra: Partial<CombatState> = {}): CombatState {
  return {
    active: true,
    round: 1,
    turn: 0,
    order: ['c-1', 'c-2', 'c-3'],
    combatants: [combatant('c-1'), combatant('c-2'), combatant('c-3')],
    events: [],
    revision: 1,
    ...extra,
  };
}

describe('log model', () => {
  it('groups consecutive entries of the same kind, keeping their order', () => {
    const runs = groupByKind([entry('e-1', 'fact'), entry('e-2', 'fact'), entry('e-3', 'decision'), entry('e-4', 'fact')]);
    expect(runs.map((run) => [run.kind, run.entries.map((e) => e.id)])).toEqual([
      ['fact', ['e-1', 'e-2']],
      ['decision', ['e-3']],
      ['fact', ['e-4']],
    ]);
  });

  it('pins open threads apart from the timeline, and keeps resolved threads in the timeline', () => {
    const log = [entry('e-1', 'thread'), entry('e-2', 'thread', { resolved: true }), entry('e-3', 'fact')];
    expect(isOpenThread(log[0])).toBe(true);
    expect(openThreads(log).map((e) => e.id)).toEqual(['e-1']);
    expect(timelineEntries(log).map((e) => e.id)).toEqual(['e-2', 'e-3']);
  });

  it('shows a scene by its file name', () => {
    expect(sceneLabel('scenes/harbour/arrival.md')).toBe('arrival');
  });
});

describe('combat model', () => {
  it('lists rows in initiative order, marks the current turn and moves defeated rows last', () => {
    const state = combat({
      turn: 1,
      combatants: [combatant('c-1', { defeated: true }), combatant('c-2'), combatant('c-3')],
    });
    const rows = combatRows(state);
    expect(rows.map((row) => row.combatant.id)).toEqual(['c-2', 'c-3', 'c-1']);
    expect(rows.filter((row) => row.current).map((row) => row.combatant.id)).toEqual(['c-2']);
  });

  it('has no current turn while the combat is not active', () => {
    expect(combatRows(combat({ active: false })).some((row) => row.current)).toBe(false);
  });

  it('computes the hp bar, clamped, and no bar without a maximum', () => {
    expect(hpView({ hp: 5, hpMax: 20 })).toMatchObject({ hasHp: true, hp: 5, max: 20, percent: 25, temp: 0 });
    expect(hpView({ hp: 30, hpMax: 20, tempHp: 4 })).toMatchObject({ percent: 100, temp: 4 });
    expect(hpView({ hp: 3 }).percent).toBeNull();
    expect(hpView({}).hasHp).toBe(false);
  });

  it('offers the 2024 conditions first, then the other ids the combat already uses, once each', () => {
    const state = combat({
      combatants: [
        combatant('c-1', { conditions: [{ id: 'hungry', duration: 'until_removed' }, { id: 'prone', duration: 'end_of_turn' }] }),
        combatant('c-2', { conditions: [{ id: 'hungry', duration: 'rounds', rounds: 2 }] }),
      ],
    });
    const options = conditionOptions(state);
    expect(options.slice(0, CONDITION_IDS.length)).toEqual([...CONDITION_IDS]);
    expect(options.slice(CONDITION_IDS.length)).toEqual(['hungry']);
    expect(conditionOptions(null)).toEqual([...CONDITION_IDS]);
  });

  it('parses optional whole numbers and positive amounts', () => {
    expect(parseOptionalInt('')).toEqual({ ok: true, value: undefined });
    expect(parseOptionalInt(' 12 ')).toEqual({ ok: true, value: 12 });
    expect(parseOptionalInt('1.5').ok).toBe(false);
    expect(parseOptionalInt('abc').ok).toBe(false);
    expect(parseAmount('3')).toBe(3);
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('-2')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('drag payload', () => {
  it('accepts a campaign-relative document or image path', () => {
    expect(readCardDrag('{"kind":"document","path":"characters/alia.md"}')).toEqual({ kind: 'document', path: 'characters/alia.md' });
    expect(readCardDrag('{"kind":"image","path":"maps/harbour.png"}')).toEqual({ kind: 'image', path: 'maps/harbour.png' });
    expect(CARD_DRAG_TYPE).toBe('application/x-yllir-card');
  });

  it('rejects anything else', () => {
    expect(readCardDrag('not json')).toBeNull();
    expect(readCardDrag('{"kind":"note","path":"a.md"}')).toBeNull();
    expect(readCardDrag('{"kind":"document","path":"../secret.md"}')).toBeNull();
    expect(readCardDrag('{"kind":"document","path":"/etc/passwd"}')).toBeNull();
    expect(readCardDrag('{"kind":"document"}')).toBeNull();
  });
});

describe('recent documents', () => {
  it('reads a stored list and drops malformed entries and duplicates', () => {
    const raw = JSON.stringify([{ path: 'a.md', title: 'A' }, { path: 'a.md', title: 'again' }, 7, { path: '' }, { path: 'b.md' }]);
    expect(parseRecents(raw)).toEqual([
      { path: 'a.md', title: 'A' },
      { path: 'b.md', title: 'b.md' },
    ]);
    expect(parseRecents('{broken')).toEqual([]);
    expect(parseRecents(null)).toEqual([]);
  });

  it('puts the opened document first and keeps one entry per path', () => {
    const list = [{ path: 'a.md', title: 'A' }, { path: 'b.md', title: 'B' }];
    expect(pushRecent(list, { path: 'b.md', title: 'B2' }).map((e) => e.path)).toEqual(['b.md', 'a.md']);
  });
});

describe('pending controls', () => {
  it('keeps a control busy until settle, and shows a failure next to it', () => {
    const pending = new PendingControls();
    expect(pending.start('row:c-1:init')).toBe(true);
    expect(pending.start('row:c-1:init')).toBe(false);
    expect(pending.isBusy('row:c-1:init')).toBe(true);

    pending.fail('row:c-1:init', 'That is not a number.');
    expect(pending.isBusy('row:c-1:init')).toBe(false);
    expect(pending.errorFor('row:c-1:init')).toBe('That is not a number.');
    expect(pending.errorWithPrefix('row:c-1:')).toBe('That is not a number.');

    pending.start('row:c-2:note');
    pending.settle();
    expect(pending.isBusy('row:c-2:note')).toBe(false);
    pending.dispose();
  });
});

describe('document search', () => {
  it('lets only the newest request change the hits', async () => {
    const pending = new Map<string, (hits: SearchHit[]) => void>();
    const search = (query: string) =>
      new Promise<SearchHit[]>((resolve) => pending.set(query, resolve));
    const docs = new DocSearch(search, 0);
    const first = docs.run('old');
    const second = docs.run('new');
    pending.get('new')?.([{ path: 'new.md', title: 'New', snippet: '', masterOnly: false }]);
    await second;
    pending.get('old')?.([{ path: 'old.md', title: 'Old', snippet: '', masterOnly: false }]);
    await first;
    expect(docs.hits().map((hit) => hit.path)).toEqual(['new.md']);
    expect(docs.status()).toBe('done');
  });
});

describe('panel strings', () => {
  it('reads the active language and falls back to English, then to the key', () => {
    expect(panelText('it', 'panels.log.kind.fact')).toBe('Fatto');
    expect(panelText('en', 'panels.log.kind.fact')).toBe('Fact');
    expect(panelText('it', 'panels.combat.round', { round: 3 })).toBe('Round 3');
    expect(panelText('it', 'panels.unknown.key')).toBe('panels.unknown.key');
  });
});
