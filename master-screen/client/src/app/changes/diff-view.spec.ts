import { describe, expect, it } from 'vitest';
import type { DiffHunk, FileDiff } from '@shared/types';
import { diffRows, fileDiffRows } from './diff-view';

const hunks: DiffHunk[] = [
  {
    header: '@@ -1,2 +1,2 @@',
    lines: [
      { kind: 'ctx', text: 'Intro' },
      { kind: 'del', text: 'Old line' },
      { kind: 'add', text: 'New line' },
    ],
  },
];

describe('diffRows', () => {
  it('starts each hunk with its header and gives every line a text sign', () => {
    expect(diffRows(hunks)).toEqual([
      { kind: 'hunk', sign: '', text: '@@ -1,2 +1,2 @@' },
      { kind: 'ctx', sign: ' ', text: 'Intro' },
      { kind: 'del', sign: '-', text: 'Old line' },
      { kind: 'add', sign: '+', text: 'New line' },
    ]);
  });

  it('returns nothing for a diff without hunks', () => {
    expect(diffRows([])).toEqual([]);
  });
});

describe('fileDiffRows', () => {
  const files: FileDiff[] = [
    { path: 'characters/alia.md', status: 'modified', hunks },
    { path: 'places/port.md', status: 'added', hunks: [] },
  ];

  it('picks the rows of the named file only', () => {
    expect(fileDiffRows(files, 'characters/alia.md')).toHaveLength(4);
    expect(fileDiffRows(files, 'places/port.md')).toEqual([]);
    expect(fileDiffRows(files, 'missing.md')).toEqual([]);
  });
});
