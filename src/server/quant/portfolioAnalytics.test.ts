import { describe, expect, it } from 'vitest';
import { calculatePortfolioAnalytics } from './portfolioAnalytics.js';

describe('portfolio analytics', () => {
  it('calculates gross, net, cash and concentration exposure', () => {
    const result = calculatePortfolioAnalytics({
      cash: 6000,
      positions: [{ marketValue: 3000 }, { marketValue: -1000 }],
    });
    expect(result.equity).toBe(8000);
    expect(result.grossExposure).toBe(4000);
    expect(result.netExposure).toBe(2000);
    expect(result.cashPct).toBe(75);
    expect(result.grossExposurePct).toBe(50);
    expect(result.largestPositionPct).toBe(37.5);
  });
});
