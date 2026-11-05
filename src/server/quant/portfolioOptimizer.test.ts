import { describe, expect, it } from 'vitest';
import { optimizeLongOnlyPortfolio, type PortfolioAssetHistory } from './portfolioOptimizer.js';

function history(symbol: string, scale: number, offset = 0): PortfolioAssetHistory {
  let close = 100 + offset;
  const bars = Array.from({ length: 80 }, (_, index) => {
    close *= 1 + Math.sin(index * scale) * 0.01 + 0.0003;
    return { date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10), close };
  });
  return { symbol, bars };
}

describe('constrained long-only portfolio optimizer', () => {
  it('returns long-only weights, cash reserve and risk estimates', () => {
    const result = optimizeLongOnlyPortfolio({
      assets: [history('AAA', 0.17), history('BBB', 0.31), history('CCC', 0.43)],
      investedWeight: 0.9,
      maxWeight: 0.5,
    });
    expect(result.weights.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(0.9, 7);
    expect(result.weights.every((item) => item.weight >= 0 && item.weight <= 0.5)).toBe(true);
    expect(result.cashWeight).toBeCloseTo(0.1, 7);
    expect(result.constraints.longOnly).toBe(true);
    expect(result.constraints.leverage).toBe(false);
    expect(result.ordersCreated).toBe(false);
    expect(result.metrics.annualizedVolatilityPct).toBeGreaterThanOrEqual(0);
  });

  it('respects a one-way turnover cap relative to the supplied portfolio', () => {
    const assets = [history('AAA', 0.17), history('BBB', 0.31), history('CCC', 0.43)];
    const result = optimizeLongOnlyPortfolio({
      assets,
      investedWeight: 0.9,
      maxWeight: 0.5,
      maxTurnoverPct: 2,
      currentWeights: { AAA: 0.3, BBB: 0.3, CCC: 0.3 },
    });
    expect(result.metrics.estimatedOneWayTurnoverPct).toBeLessThanOrEqual(2.0001);
    expect(result.constraints.turnoverConstraintApplied).toBe(true);
  });

  it('rejects mismatched dates, short weights and infeasible concentration caps', () => {
    const first = history('AAA', 0.17);
    const second = history('BBB', 0.31);
    second.bars[20] = { ...second.bars[20], date: '2030-01-01' };
    expect(() => optimizeLongOnlyPortfolio({ assets: [first, second] })).toThrow(/aligned dates/);
    expect(() => optimizeLongOnlyPortfolio({
      assets: [first, history('BBB', 0.31)],
      currentWeights: { AAA: -0.1, BBB: 1.05 },
    })).toThrow(/currentWeights/);
    expect(() => optimizeLongOnlyPortfolio({
      assets: [first, history('BBB', 0.31)],
      investedWeight: 0.95,
      maxWeight: 0.4,
    })).toThrow(/infeasible/);
  });

  it('requires sufficient common daily history and valid unique symbols', () => {
    const first = history('AAA', 0.17);
    const second = history('AAA', 0.31);
    expect(() => optimizeLongOnlyPortfolio({ assets: [first, second] })).toThrow(/unique valid tickers/);
    expect(() => optimizeLongOnlyPortfolio({
      assets: [{ symbol: 'AAA', bars: first.bars.slice(0, 20) }, history('BBB', 0.31)],
    })).toThrow(/between 31 and 2500/);
  });
});
