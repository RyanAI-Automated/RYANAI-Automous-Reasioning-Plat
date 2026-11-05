import { describe, expect, it } from 'vitest';
import { analyzeQuantCore, assessRiskGuardian } from './quantCore.js';
import type { QuantBar } from './alpacaMarketData.js';

function bars(count = 60): QuantBar[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.4 + Math.sin(index / 3);
    return {
      date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      open: close - 0.2,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1000 + index,
    };
  });
}

describe('QuantCore', () => {
  it('produces independent model signals and a consensus from completed bars', () => {
    const result = analyzeQuantCore({
      bars: bars(),
      portfolio: { cash: 8000, positions: [{ symbol: 'TEST', marketValue: 2000 }] },
    });
    expect(result.signals).toHaveLength(4);
    expect(result.consensus.action).toMatch(/buy|sell|hold/);
    expect(result.portfolio.equity).toBe(10000);
    expect(result.portfolio.grossExposurePct).toBe(20);
    expect(result.regime.name).not.toBe('insufficient_data');
  });

  it('rejects insufficient or invalid market data', () => {
    expect(() => analyzeQuantCore({ bars: bars(20) })).toThrow(/35/);
    const invalid = bars();
    invalid[10].close = Number.NaN;
    expect(() => analyzeQuantCore({ bars: invalid })).toThrow(/finite positive/);
  });
});

describe('Risk Guardian', () => {
  const base = {
    equity: 10000,
    currentGrossExposure: 1000,
    projectedOrderNotional: 500,
    projectedDailyLoss: 100,
    maxOrderNotional: 2000,
    maxGrossExposure: 5000,
    maxDailyLoss: 1000,
    emergencyStop: false,
    tradingEnabled: true,
  };

  it('allows an order inside every configured boundary', () => {
    expect(assessRiskGuardian(base).decision).toBe('allow');
  });

  it('blocks when any hard boundary is crossed', () => {
    const result = assessRiskGuardian({ ...base, projectedOrderNotional: 2500 });
    expect(result.decision).toBe('block');
    expect(result.reasons).toContain('order notional exceeds limit');
  });

  it('blocks when emergency stop or trading disablement is active', () => {
    const result = assessRiskGuardian({ ...base, emergencyStop: true, tradingEnabled: false });
    expect(result.decision).toBe('block');
    expect(result.reasons).toEqual(expect.arrayContaining(['emergency stop is active', 'paper trading is disabled']));
  });
});
