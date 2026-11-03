import { describe, expect, it } from 'vitest';
import { reconnectDelay } from './client';

describe('bridge reconnect backoff', () => {
  it('grows exponentially and respects the maximum', () => {
    expect(reconnectDelay(0, () => 1, 500, 8000)).toBe(500);
    expect(reconnectDelay(1, () => 1, 500, 8000)).toBe(1000);
    expect(reconnectDelay(20, () => 1, 500, 8000)).toBe(8000);
  });
  it('adds bounded jitter without exceeding the ceiling', () => {
    expect(reconnectDelay(2, () => 0, 500, 8000)).toBe(1000);
    expect(reconnectDelay(2, () => 1, 500, 8000)).toBe(2000);
  });
});
