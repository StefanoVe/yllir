import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_CHOICE, loadChatChoice, saveChatChoice } from './chat-choice';

describe('chat choice storage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('saves and loads the choice', () => {
    saveChatChoice({ model: 'opus', effort: 'low' });
    expect(loadChatChoice()).toEqual({ model: 'opus', effort: 'low' });
  });

  it('keeps the default when nothing is saved', () => {
    expect(loadChatChoice()).toEqual(DEFAULT_CHAT_CHOICE);
  });

  it('keeps the default for a broken saved value', () => {
    localStorage.setItem('yllir:chat-choice', 'not json');
    expect(loadChatChoice()).toEqual(DEFAULT_CHAT_CHOICE);
  });

  it('keeps working when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadChatChoice()).toEqual(DEFAULT_CHAT_CHOICE);
    expect(() => saveChatChoice({ model: 'haiku', effort: 'max' })).not.toThrow();
  });
});
