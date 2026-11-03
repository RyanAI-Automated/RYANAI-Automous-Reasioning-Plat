import { describe, expect, it } from 'vitest';
import { reconnectDelay } from './connectivityBridge';

describe('connectivity bridge recovery policy', () => {
  it('uses exponential delay ceilings and caps long outages', () => {
    expect(reconnectDelay(0, 30000, () => 1)).toBe(500);
    expect(reconnectDelay(1, 30000, () => 1)).toBe(1000);
    expect(reconnectDelay(20, 8000, () => 1)).toBe(8000);
  });
  it('adds bounded jitter at both ends of the delay window', () => {
    expect(reconnectDelay(3, 30000, () => 0)).toBe(2000);
    expect(reconnectDelay(3, 30000, () => 1)).toBe(4000);
  });
  it('never returns a negative delay for invalid random samples', () => {
    expect(reconnectDelay(2, 30000, () => -1)).toBe(1000);
    expect(reconnectDelay(2, 30000, () => 2)).toBe(2000);
  });
});
