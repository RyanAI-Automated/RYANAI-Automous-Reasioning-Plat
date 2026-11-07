import { describe, expect, it } from 'vitest';
import { createSmaCrossoverSignal } from './strategySignal.js';
import type { QuantBar } from './alpacaMarketData.js';

function makeBars(closes: number[]): QuantBar[] {
  return closes.map((close, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    open: close,
    high: close + 1,
    low: Math.max(0.01, close - 1),
    close,
    volume: 1000,
  }));
}

describe('SMA crossover signal validation', () => {
  it('emits buy only when fast SMA crosses above slow SMA', () => {
    const closes = [10, 10, 10, 10, 10, 10, 10, 12, 12, 8, 8, 13];
    const signal = createSmaCrossoverSignal(makeBars(closes), 2, 4, new Date('2026-04-01T00:00:00Z'));
    expect(signal.action).toBe('buy');
    expect(signal.strategy).toBe('sma_crossover');
    expect(signal.referencePrice).toBe(13);
  });

  it('emits sell only when fast SMA crosses below slow SMA', () => {
    const closes = [10, 10, 10, 10, 10, 10, 10, 8, 8, 12, 12, 7];
    const signal = createSmaCrossoverSignal(makeBars(closes), 2, 4);
    expect(signal.action).toBe('sell');
  });

  it('emits hold when averages remain on the same side', () => {
    const signal = createSmaCrossoverSignal(makeBars(Array(12).fill(12)), 2, 4);
    expect(signal.action).toBe('hold');
  });

  it('requires a prior observation to validate a genuine cross', () => {
    expect(() => createSmaCrossoverSignal(makeBars([1, 2, 3, 4]), 2, 4)).toThrow(/At least 5/);
  });

  it('rejects invalid and unordered windows', () => {
    const bars = makeBars(Array(20).fill(12));
    expect(() => createSmaCrossoverSignal(bars, 1, 4)).toThrow(/Fast SMA window/);
    expect(() => createSmaCrossoverSignal(bars, 4, 4)).toThrow(/Slow SMA window/);
    expect(() => createSmaCrossoverSignal(bars, 5, 201)).toThrow(/Slow SMA window/);
  });
});
