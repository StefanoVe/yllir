import { describe, expect, it } from 'vitest';
import { reconnectDelay } from './live.service';

describe('reconnectDelay', () => {
  it('doubles from 500 ms and caps at 15 s', () => {
    expect(reconnectDelay(0)).toBe(500);
    expect(reconnectDelay(1)).toBe(1000);
    expect(reconnectDelay(2)).toBe(2000);
    expect(reconnectDelay(4)).toBe(8000);
    expect(reconnectDelay(5)).toBe(15000);
    expect(reconnectDelay(50)).toBe(15000);
  });

  it('is safe for negative, fractional and huge attempts', () => {
    expect(reconnectDelay(-3)).toBe(500);
    expect(reconnectDelay(2.7)).toBe(2000);
    expect(Number.isFinite(reconnectDelay(Number.MAX_SAFE_INTEGER))).toBe(true);
  });

  it('accepts custom base and cap', () => {
    expect(reconnectDelay(3, 100, 1000)).toBe(800);
    expect(reconnectDelay(9, 100, 1000)).toBe(1000);
  });
});
