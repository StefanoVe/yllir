import { describe, expect, it } from 'vitest';
import { KeyValueStore, prefKey } from './prefs.service';

const throwing = (): never => {
  throw new DOMException('blocked', 'SecurityError');
};

describe('KeyValueStore', () => {
  it('survives a storage that throws on every access', () => {
    const store = new KeyValueStore(throwing);
    expect(store.get('yllir:x:theme')).toBeNull();
    expect(store.set('yllir:x:theme', 'dark')).toBe(false);
    expect(store.remove('yllir:x:theme')).toBe(false);
  });

  it('survives a storage whose methods throw', () => {
    const broken = {
      getItem: throwing,
      setItem: throwing,
      removeItem: throwing,
    } as unknown as Storage;
    const store = new KeyValueStore(() => broken);
    expect(store.get('k')).toBeNull();
    expect(store.set('k', 'v')).toBe(false);
  });

  it('works with a plain in-memory storage and no storage at all', () => {
    const data = new Map<string, string>();
    const memory = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    } as unknown as Storage;
    const store = new KeyValueStore(() => memory);
    expect(store.set('a', '1')).toBe(true);
    expect(store.get('a')).toBe('1');
    expect(store.remove('a')).toBe(true);
    expect(store.get('a')).toBeNull();

    const none = new KeyValueStore(() => null);
    expect(none.get('a')).toBeNull();
    expect(none.set('a', '1')).toBe(true);
  });
});

describe('prefKey', () => {
  it('prefixes keys with the campaign slug', () => {
    expect(prefKey('my-campaign', 'theme')).toBe('yllir:my-campaign:theme');
  });
});
