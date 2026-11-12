import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '@shared/types';
import { BoardSync, type SaveStatus } from './board-sync';

const board = (revision: number, extra: Partial<Board> = {}): Board => ({ revision, cards: [], frames: [], arrows: [], ...extra });

/** A fake server: each accepted save bumps the revision; a stale revision gets 409 with the current board. */
function fakeServer(start = 0) {
  let current = start;
  const put = vi.fn(async (sent: Board): Promise<Board> => {
    if (sent.revision !== current) {
      throw { error: 'stale', status: 409, board: board(current, { cards: [] }) };
    }
    current += 1;
    return board(current, { cards: sent.cards });
  });
  return { put, get current() { return current; }, bump: () => (current += 1) };
}

describe('BoardSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits for the debounce and sends one save for a burst of edits', async () => {
    const server = fakeServer(0);
    const onServer = vi.fn();
    const sync = new BoardSync({ put: server.put, onServer }, 0);
    sync.schedule(board(0));
    sync.schedule(board(0, { cards: [] }));
    await vi.advanceTimersByTimeAsync(399);
    expect(server.put).not.toHaveBeenCalled();
    expect(sync.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.put).toHaveBeenCalledTimes(1);
    expect(sync.dirty).toBe(false);
    expect(sync.status).toBe('saved');
    expect(onServer).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }), 'saved');
  });

  it('sends the last revision the server confirmed', async () => {
    const server = fakeServer(0);
    const sync = new BoardSync({ put: server.put, onServer: () => {} }, 0);
    sync.schedule(board(0));
    await vi.advanceTimersByTimeAsync(400);
    sync.schedule(board(1));
    await vi.advanceTimersByTimeAsync(400);
    expect(server.put.mock.calls[1][0].revision).toBe(1);
    expect(sync.revision).toBe(2);
  });

  it('sends edits made during a save after it, from the new revision', async () => {
    let release: (value: Board) => void = () => {};
    const put = vi
      .fn<(b: Board) => Promise<Board>>()
      .mockImplementationOnce(() => new Promise<Board>((resolve) => (release = resolve)))
      .mockImplementationOnce(async (b) => ({ ...b, revision: b.revision + 1 }));
    const onServer = vi.fn();
    const sync = new BoardSync({ put, onServer }, 0);
    sync.schedule(board(0));
    await vi.advanceTimersByTimeAsync(400);
    expect(sync.status).toBe('saving');
    sync.schedule(board(0, { cards: [] }));
    release(board(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(onServer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1][0].revision).toBe(1);
    expect(onServer).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }), 'saved');
  });

  it('adopts the server board on a 409 and drops the stale local edit', async () => {
    const server = fakeServer(5);
    const onServer = vi.fn();
    const statuses: SaveStatus[] = [];
    const sync = new BoardSync({ put: server.put, onServer, onStatus: (s) => statuses.push(s) }, 2);
    sync.schedule(board(2, { cards: [] }));
    await vi.advanceTimersByTimeAsync(400);
    expect(onServer).toHaveBeenCalledWith(expect.objectContaining({ revision: 5 }), 'conflict');
    expect(sync.status).toBe('conflict');
    expect(sync.dirty).toBe(false);
    expect(sync.revision).toBe(5);
    expect(statuses).toEqual(['pending', 'saving', 'conflict']);
  });

  it('keeps the edit after a failure so a retry sends it again', async () => {
    const put = vi
      .fn<(b: Board) => Promise<Board>>()
      .mockRejectedValueOnce({ error: 'Network down', status: 0 })
      .mockImplementationOnce(async (b) => ({ ...b, revision: 1 }));
    const onServer = vi.fn();
    const sync = new BoardSync({ put, onServer }, 0);
    sync.schedule(board(0));
    await vi.advanceTimersByTimeAsync(400);
    expect(sync.status).toBe('error');
    expect(sync.dirty).toBe(true);
    await sync.flush();
    expect(put).toHaveBeenCalledTimes(2);
    expect(sync.status).toBe('saved');
    expect(onServer).toHaveBeenCalledTimes(1);
  });

  it('does not let a server board replace local edits that are still waiting', () => {
    const sync = new BoardSync({ put: vi.fn(), onServer: () => {} }, 0);
    sync.schedule(board(0));
    sync.rebase(9);
    expect(sync.revision).toBe(0);
  });

  it('adopts a server revision when nothing is waiting', () => {
    const sync = new BoardSync({ put: vi.fn(), onServer: () => {} }, 0);
    sync.rebase(4);
    expect(sync.revision).toBe(4);
  });
});
