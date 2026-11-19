import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MinHeap, aStar } from './pathfind.mjs';

test('the heap pops in ascending order', () => {
  const heap = new MinHeap((a, b) => a - b);
  [5, 3, 8, 1, 9, 2, 7].forEach((x) => heap.push(x));
  const out = [];
  while (heap.size > 0) out.push(heap.pop());
  assert.deepEqual(out, [1, 2, 3, 5, 7, 8, 9]);
});

test('A* finds a straight path on an open grid and never repeats a cell', () => {
  const path = aStar({ gw: 20, gh: 20, cell: 1, passable: () => true, cost: () => 1, start: [1, 1], goal: [10, 1] });
  assert.equal(path[0][0], 1);
  assert.deepEqual(path.at(-1), [10, 1]);
  assert.equal(path.length, 10);
});

test('A* goes around a wall and returns null when the goal is walled off', () => {
  const wall = (i, j) => !(i === 5 && j < 8);
  const around = aStar({ gw: 12, gh: 12, cell: 1, passable: wall, cost: () => 1, start: [1, 1], goal: [9, 1] });
  assert.ok(around.some(([i, j]) => i === 5 && j >= 8));
  const closed = aStar({ gw: 12, gh: 12, cell: 1, passable: (i, j) => !(i === 5), cost: () => 1, start: [1, 1], goal: [9, 1] });
  assert.equal(closed, null);
});

test('A* is deterministic and prefers the cheaper cells', () => {
  const cost = (i) => (i === 5 ? 10 : 1);
  const a = aStar({ gw: 12, gh: 12, cell: 1, passable: () => true, cost, start: [0, 0], goal: [11, 11] });
  const b = aStar({ gw: 12, gh: 12, cell: 1, passable: () => true, cost, start: [0, 0], goal: [11, 11] });
  assert.deepEqual(a, b);
  // Every path crosses column 5 at least once; the cheapest crosses it in one cell.
  assert.equal(a.filter(([i]) => i === 5).length, 1);
});
