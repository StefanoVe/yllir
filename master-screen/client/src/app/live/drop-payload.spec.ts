import { describe, expect, it } from 'vitest';
import { DRAG_MIME, hasDragPayload, readDragPayload, setDragPayload } from './drop-payload';

/** Minimal DataTransfer stand-in: only what the helpers use. */
function fakeEvent(store: Map<string, string> = new Map()): DragEvent {
  const transfer = {
    effectAllowed: 'none',
    dropEffect: 'none',
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
  };
  return { dataTransfer: transfer } as unknown as DragEvent;
}

describe('drag payload', () => {
  it('round-trips a document and an image', () => {
    const store = new Map<string, string>();
    setDragPayload(fakeEvent(store), { kind: 'document', path: 'characters/alia.md' });
    expect(store.has(DRAG_MIME)).toBe(true);
    expect(readDragPayload(fakeEvent(store))).toEqual({ kind: 'document', path: 'characters/alia.md' });
    expect(hasDragPayload(fakeEvent(store))).toBe(true);
  });

  it('rejects anything that is not a campaign-relative payload', () => {
    const cases = [
      '{"kind":"note","path":"x.md"}',
      '{"kind":"image","path":"../secret.png"}',
      '{"kind":"image","path":"/abs.png"}',
      '{"kind":"document"}',
      'not json',
    ];
    for (const raw of cases) {
      expect(readDragPayload(fakeEvent(new Map([[DRAG_MIME, raw]])))).toBeNull();
    }
  });

  it('does not treat a plain text drag as a card', () => {
    expect(hasDragPayload(fakeEvent(new Map([['text/plain', 'hi']])))).toBe(false);
  });
});
