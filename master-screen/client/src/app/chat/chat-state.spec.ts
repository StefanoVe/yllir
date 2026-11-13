import { describe, expect, it } from 'vitest';
import type { ChatMessage, Turn, TurnStep } from '@shared/types';
import {
  EMPTY_CHAT_STATE,
  addMessage,
  applyDelta,
  concernsShown,
  emptyStateFor,
  isActiveTurn,
  isFailedTurn,
  mergeFetched,
  setTurn,
  type ChatState,
} from './chat-state';

const step = (id: string, extra: Partial<TurnStep> = {}): TurnStep => ({
  id,
  kind: 'read',
  text: id,
  at: AT,
  state: 'running',
  ...extra,
});

const AT = '2026-11-12T10:00:00.000Z';
const master = (id: string, text: string): ChatMessage => ({ id, role: 'master', text, at: AT });
const agent = (id: string, text: string): ChatMessage => ({ id, role: 'agent', text, at: AT });
const turn = (state: Turn['state'], extra: Partial<Turn> = {}): Turn => ({
  id: 't1',
  messageId: 'm1',
  state,
  activity: '',
  startedAt: AT,
  ...extra,
});

describe('addMessage', () => {
  it('appends a new message', () => {
    const state = addMessage(EMPTY_CHAT_STATE, master('m1', 'hello'));
    expect(state.messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('dedupes by id, keeping one copy in place', () => {
    let state = addMessage(EMPTY_CHAT_STATE, master('m1', 'hello'));
    state = addMessage(state, master('m2', 'second'));
    state = addMessage(state, master('m1', 'hello'));
    expect(state.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('replaces a pending agent bubble with the final message', () => {
    let state = applyDelta(EMPTY_CHAT_STATE, { messageId: 'a1', text: 'Par' }, AT);
    state = addMessage(state, agent('a1', 'Partito.'));
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].text).toBe('Partito.');
    expect(state.messages[0].pending).toBeUndefined();
  });
});

describe('applyDelta', () => {
  it('creates a pending agent bubble when none is shown', () => {
    const state = applyDelta(EMPTY_CHAT_STATE, { messageId: 'a1', text: 'Ciao' }, AT);
    expect(state.messages).toEqual([{ id: 'a1', role: 'agent', text: 'Ciao', at: AT, pending: true }]);
  });

  it('appends text in order to the agent message with that id', () => {
    let state = applyDelta(EMPTY_CHAT_STATE, { messageId: 'a1', text: 'Ciao' }, AT);
    state = applyDelta(state, { messageId: 'a1', text: ', ' }, AT);
    state = applyDelta(state, { messageId: 'a1', text: 'mondo' }, AT);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].text).toBe('Ciao, mondo');
  });

  it('never appends text to a master message', () => {
    const start = addMessage(EMPTY_CHAT_STATE, master('m1', 'mine'));
    expect(applyDelta(start, { messageId: 'm1', text: ' extra' }, AT)).toBe(start);
  });

  it('keeps the other messages untouched', () => {
    let state = addMessage(EMPTY_CHAT_STATE, master('m1', 'mine'));
    state = applyDelta(state, { messageId: 'a1', text: 'x' }, AT);
    expect(state.messages.map((m) => m.text)).toEqual(['mine', 'x']);
  });
});

describe('turns', () => {
  it('stores the turn and reports active and failed states', () => {
    const running: ChatState = setTurn(EMPTY_CHAT_STATE, turn('running'));
    expect(isActiveTurn(running.turn)).toBe(true);
    expect(isFailedTurn(running.turn)).toBe(false);
    expect(isActiveTurn(setTurn(EMPTY_CHAT_STATE, turn('queued')).turn)).toBe(true);
    expect(isActiveTurn(setTurn(EMPTY_CHAT_STATE, turn('done')).turn)).toBe(false);
    expect(isFailedTurn(setTurn(EMPTY_CHAT_STATE, turn('error', { error: 'x' })).turn)).toBe(true);
    expect(isActiveTurn(null)).toBe(false);
  });
});

describe('mergeFetched', () => {
  it('takes the server history and keeps a pending bubble the server does not list yet', () => {
    let state = applyDelta(EMPTY_CHAT_STATE, { messageId: 'a2', text: 'In corso' }, AT);
    state = mergeFetched(state, { conversationId: 'c1', messages: [master('m1', 'hello')], turn: turn('running') });
    expect(state.messages.map((m) => m.id)).toEqual(['m1', 'a2']);
    expect(state.turn?.state).toBe('running');
  });

  it('collapses a bubble that the server now lists', () => {
    let state = applyDelta(EMPTY_CHAT_STATE, { messageId: 'a1', text: 'partial' }, AT);
    state = mergeFetched(state, { conversationId: 'c1', messages: [agent('a1', 'final text')], turn: null });
    expect(state.messages).toEqual([agent('a1', 'final text')]);
  });

  it('keeps an active turn from an event when the response has none', () => {
    const state = setTurn(EMPTY_CHAT_STATE, turn('running'));
    expect(mergeFetched(state, { conversationId: 'c1', messages: [], turn: null }).turn?.state).toBe('running');
    const done = setTurn(EMPTY_CHAT_STATE, turn('done'));
    expect(mergeFetched(done, { conversationId: 'c1', messages: [], turn: null }).turn).toBeNull();
  });
});

describe('steps', () => {
  it('keeps the steps of a turn event', () => {
    const state = setTurn(EMPTY_CHAT_STATE, turn('running', { steps: [step('s1')] }));
    expect(state.turn?.steps?.map((s) => s.id)).toEqual(['s1']);
  });

  it('does not lose shown steps when a later event for the same turn has fewer', () => {
    let state = setTurn(EMPTY_CHAT_STATE, turn('running', { steps: [step('s1'), step('s2')] }));
    state = setTurn(state, turn('running', { activity: 'x', steps: [step('s2')] }));
    expect(state.turn?.steps?.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(state.turn?.activity).toBe('x');
  });

  it('takes the newer state of a step from a later event', () => {
    let state = setTurn(EMPTY_CHAT_STATE, turn('running', { steps: [step('s1')] }));
    state = setTurn(state, turn('running', { steps: [step('s1', { state: 'done', endedAt: AT })] }));
    expect(state.turn?.steps?.[0].state).toBe('done');
  });

  it('starts from the new list when the turn id changes', () => {
    let state = setTurn(EMPTY_CHAT_STATE, turn('done', { steps: [step('old', { state: 'done' })] }));
    state = setTurn(state, { ...turn('running'), id: 't2', steps: [step('new')] });
    expect(state.turn?.steps?.map((s) => s.id)).toEqual(['new']);
  });

  it('drops the steps key when the turn has none', () => {
    const state = setTurn(EMPTY_CHAT_STATE, turn('running'));
    expect(state.turn && 'steps' in state.turn).toBe(false);
  });

  it('keeps steps on a finished agent message, also when it replaces a bubble', () => {
    let state = applyDelta(EMPTY_CHAT_STATE, { messageId: 'a1', text: 'Par' }, AT);
    state = addMessage(state, { ...agent('a1', 'Partito.'), steps: [step('s1', { state: 'done', endedAt: AT })] });
    expect(state.messages[0].steps?.map((s) => s.id)).toEqual(['s1']);
  });

  it('keeps the steps of the active turn through a refetch', () => {
    const shown = setTurn(EMPTY_CHAT_STATE, turn('running', { steps: [step('s1'), step('s2')] }));
    const state = mergeFetched(shown, { conversationId: 'c1', messages: [], turn: turn('running', { steps: [step('s2')] }) });
    expect(state.turn?.steps?.map((s) => s.id)).toEqual(['s1', 's2']);
  });
});

describe('conversations', () => {
  const shownC1: ChatState = emptyStateFor('c1');

  it('shows nothing until a conversation is picked, then only that conversation', () => {
    expect(EMPTY_CHAT_STATE.conversationId).toBeNull();
    expect(concernsShown(EMPTY_CHAT_STATE, 'c1')).toBe(false);
    expect(concernsShown(shownC1, 'c1')).toBe(true);
    expect(concernsShown(shownC1, 'c2')).toBe(false);
  });

  it('treats an event without a conversation id as belonging to the shown one', () => {
    expect(concernsShown(shownC1, undefined)).toBe(true);
    expect(concernsShown(EMPTY_CHAT_STATE, undefined)).toBe(true);
  });

  it('ignores a message of another conversation and keeps the shown one', () => {
    let state = addMessage(shownC1, { ...master('m1', 'mine'), conversationId: 'c1' });
    state = addMessage(state, { ...master('m2', 'elsewhere'), conversationId: 'c2' });
    expect(state.messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('stores a message of the shown conversation without the routing field', () => {
    const state = addMessage(shownC1, { ...agent('a1', 'hi'), conversationId: 'c1' });
    expect(state.messages).toEqual([agent('a1', 'hi')]);
    expect('conversationId' in state.messages[0]).toBe(false);
  });

  it('ignores a delta of another conversation', () => {
    const start = shownC1;
    expect(applyDelta(start, { messageId: 'a1', text: 'x', conversationId: 'c2' }, AT)).toBe(start);
    expect(applyDelta(start, { messageId: 'a1', text: 'x', conversationId: 'c1' }, AT).messages).toHaveLength(1);
  });

  it('ignores a turn of another conversation and takes one of the shown conversation', () => {
    const start = shownC1;
    expect(setTurn(start, { ...turn('running'), conversationId: 'c2' }).turn).toBeNull();
    expect(setTurn(start, { ...turn('running'), conversationId: 'c1' }).turn?.state).toBe('running');
    expect(setTurn(start, turn('queued')).turn?.state).toBe('queued');
  });

  it('drops a fetched response that is for another conversation than the shown one', () => {
    const state = shownC1;
    const stale = mergeFetched(state, { conversationId: 'c2', messages: [master('m9', 'old')], turn: null });
    expect(stale).toBe(state);
  });

  it('starts an empty state for a newly picked conversation', () => {
    const state = emptyStateFor('c2');
    expect(state).toEqual({ conversationId: 'c2', messages: [], turn: null });
  });
});
