import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Board, BoardCard } from '../../../shared/src/types.js';
import { boardFile, emptyBoard, parseBoard, readBoard, saveBoard } from './board.js';
import { makeCampaign } from './test-support.js';

function card(id: string, extra: Partial<BoardCard> = {}): BoardCard {
  return { id, kind: 'note', text: 'hi', x: 0, y: 0, w: 200, h: 120, z: 1, ...extra };
  }

function board(extra: Partial<Board> = {}): Board {
  return { revision: 0, cards: [], frames: [], arrows: [], ...extra };
}

function many(n: number, make: (i: number) => unknown): unknown[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

describe('board validation matrix', () => {
  const accepted: Array<[string, unknown]> = [
    ['empty board', board()],
    ['card at the coordinate limits', board({ cards: [card('a', { x: -20000, y: 20000 })] })],
    ['size at the minimum and maximum', board({ cards: [card('a', { w: 40, h: 4000 })] })],
    ['document card with a campaign path', board({ cards: [card('a', { kind: 'document', ref: 'Mondo/Porto.md' })] })],
    ['frame and an arrow from a card to a frame', board({
      cards: [card('a')],
      frames: [{ id: 'f', title: 'Scena 1', x: 0, y: 0, w: 400, h: 300 }],
      arrows: [{ id: 'r', from: 'a', to: 'f', label: 'poi' }],
    })],
    ['exactly 300 cards', board({ cards: many(300, (i) => card(`c${i}`)) as Board['cards'] })],
    ['exactly 100 frames', board({ frames: many(100, (i) => ({ id: `f${i}`, title: '', x: 0, y: 0, w: 40, h: 40 })) as Board['frames'] })],
  ];

  for (const [name, input] of accepted) {
    it(`accepts ${name}`, () => {
      assert.equal(parseBoard(input).ok, true);
    });
  }

  const rejected: Array<[string, unknown]> = [
    ['301 cards', board({ cards: many(301, (i) => card(`c${i}`)) as Board['cards'] })],
    ['101 frames', board({ frames: many(101, (i) => ({ id: `f${i}`, title: '', x: 0, y: 0, w: 40, h: 40 })) as Board['frames'] })],
    ['301 arrows', board({
      cards: [card('a'), card('b')],
      arrows: many(301, (i) => ({ id: `r${i}`, from: 'a', to: 'b' })) as Board['arrows'],
    })],
    ['x above 20000', board({ cards: [card('a', { x: 20001 })] })],
    ['y below -20000', board({ cards: [card('a', { y: -20001 })] })],
    ['width 39', board({ cards: [card('a', { w: 39 })] })],
    ['height 4001', board({ cards: [card('a', { h: 4001 })] })],
    ['frame width below 40', board({ frames: [{ id: 'f', title: '', x: 0, y: 0, w: 10, h: 40 }] })],
    ['absolute ref', board({ cards: [card('a', { kind: 'document', ref: '/etc/passwd' })] })],
    ['ref with dot-dot', board({ cards: [card('a', { kind: 'document', ref: '../secret.md' })] })],
    ['ref with dot-dot in the middle', board({ cards: [card('a', { kind: 'document', ref: 'a/../b.md' })] })],
    ['ref with a backslash', board({ cards: [card('a', { kind: 'document', ref: 'a\\b.md' })] })],
    ['ref with a NUL', board({ cards: [card('a', { kind: 'document', ref: 'a\u0000b.md' })] })],
    ['ref with a drive letter', board({ cards: [card('a', { kind: 'document', ref: 'C:/x.md' })] })],
    ['empty ref', board({ cards: [card('a', { kind: 'document', ref: '' })] })],
    ['duplicate card ids', board({ cards: [card('a'), card('a')] })],
    ['card id equal to a frame id', board({
      cards: [card('a')],
      frames: [{ id: 'a', title: '', x: 0, y: 0, w: 40, h: 40 }],
    })],
    ['duplicate arrow ids', board({
      cards: [card('a'), card('b')],
      arrows: [{ id: 'r', from: 'a', to: 'b' }, { id: 'r', from: 'b', to: 'a' }],
    })],
    ['arrow to a missing card', board({ cards: [card('a')], arrows: [{ id: 'r', from: 'a', to: 'ghost' }] })],
    ['arrow from a missing frame', board({ cards: [card('a')], arrows: [{ id: 'r', from: 'nope', to: 'a' }] })],
    ['text of 4001 characters', board({ cards: [card('a', { text: 'x'.repeat(4001) })] })],
    ['label of 201 characters', board({ cards: [card('a')], arrows: [{ id: 'r', from: 'a', to: 'a', label: 'x'.repeat(201) }] })],
    ['unknown field on a card', board({ cards: [{ ...card('a'), color: 'red' }] as unknown as Board['cards'] })],
    ['unknown field on the board', { ...board(), extra: true }],
    ['negative revision', board({ revision: -1 })],
    ['fractional revision', board({ revision: 1.5 })],
    ['card kind not known', board({ cards: [{ ...card('a'), kind: 'video' }] as unknown as Board['cards'] })],
    ['missing cards list', { revision: 0, frames: [], arrows: [] }],
    ['not an object', 'board'],
  ];

  for (const [name, input] of rejected) {
    it(`rejects ${name}`, () => {
      assert.equal(parseBoard(input).ok, false);
    });
  }
});

describe('board store', () => {
  it('reads the empty board when there is no file', async () => {
    const root = makeCampaign();
    assert.deepEqual(await readBoard(root, '2026-11-12'), emptyBoard());
  });

  it('writes atomically with mode 0600 and bumps the revision', async () => {
    const root = makeCampaign();
    const saved = await saveBoard(root, '2026-11-12', board({ cards: [card('a')] }));
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.board.revision, 1);
    const file = boardFile(root, '2026-11-12');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const leftovers = fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
    assert.equal((await readBoard(root, '2026-11-12')).cards.length, 1);
  });

  it('refuses a stale revision and returns the stored board', async () => {
    const root = makeCampaign();
    await saveBoard(root, 's1', board({ cards: [card('a')] }));
    const stale = await saveBoard(root, 's1', board({ revision: 0, cards: [card('b')] }));
    assert.equal(stale.ok, false);
    if (stale.ok) return;
    assert.equal(stale.board.revision, 1);
    assert.equal(stale.board.cards[0].id, 'a');
  });

  it('serializes concurrent writes: exactly one of several equal-revision saves wins', async () => {
    const root = makeCampaign();
    const attempts = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => saveBoard(root, 's1', board({ cards: [card(`c${i}`)] }))),
    );
    assert.equal(attempts.filter((a) => a.ok).length, 1);
    const stored = await readBoard(root, 's1');
    assert.equal(stored.revision, 1);
  });

  it('treats an unreadable stored board as empty without throwing', async () => {
    const root = makeCampaign();
    const file = boardFile(root, 's1');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json');
    const lines: string[] = [];
    assert.deepEqual(await readBoard(root, 's1', (m) => lines.push(m)), emptyBoard());
    assert.equal(lines.length, 1);
  });
});
