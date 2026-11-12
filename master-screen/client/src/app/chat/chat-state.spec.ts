import { describe, expect, it } from 'vitest';
import type { ChatMessage, Turn } from '@shared/types';
import {
  EMPTY_CHAT_STATE,
  addMessage,
  applyDelta,
  isActiveTurn,
  isFailedTurn,
  mergeFetched,
  setTurn,
  type ChatState,
} from './chat-state';

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
    state = mergeFetched(state, { messages: [master('m1', 'hello')], turn: turn('running') });
    expect(state.messages.map((m) => m.id)).toEqual(['m1', 'a2']);
    expect(state.turn?.state).toBe('running');
  });

  it('collapses a bubble that the server now lists', () => {
    let state = applyDelta(EMPTY_CHAT_STATE, { messageId: 'a1', text: 'partial' }, AT);
    state = mergeFetched(state, { messages: [agent('a1', 'final text')], turn: null });
    expect(state.messages).toEqual([agent('a1', 'final text')]);
  });

  it('keeps an active turn from an event when the response has none', () => {
    const state = setTurn(EMPTY_CHAT_STATE, turn('running'));
    expect(mergeFetched(state, { messages: [], turn: null }).turn?.state).toBe('running');
    const done = setTurn(EMPTY_CHAT_STATE, turn('done'));
    expect(mergeFetched(done, { messages: [], turn: null }).turn).toBeNull();
  });
});
