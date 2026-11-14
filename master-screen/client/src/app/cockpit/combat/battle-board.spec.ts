import { describe, expect, it } from 'vitest';
import { gridLinesOf } from './battle-board';

describe('gridLinesOf', () => {
  it('draws the inner lines only, in cell units', () => {
    expect(gridLinesOf({ cols: 3, rows: 2 })).toEqual({
      viewBox: '0 0 3 2',
      d: 'M1 0V2 M2 0V2 M0 1H3',
    });
  });

  it('draws nothing for a single cell', () => {
    expect(gridLinesOf({ cols: 1, rows: 1 }).d).toBe('');
  });
});
