import { describe, expect, it } from 'vitest';
import { assessPaperOrderRisk } from './paperRisk.js';

const base = {
  cashBalance: 100000,
  grossExposure: 0,
  heldQuantity: 0,
  heldMarkPrice: 0,
  orderQuantity: 2,
  referencePrice: 100,
  fee: 0.1,
  startingDailyEquity: 100000,
  lifetimePeakEquity: 100000,
  limits: { maxDailyLoss: 5000, maxDrawdownPct: 10 },
} as const;

describe('paper order risk assessment', () => {
  it('accounts for execution fees in projected daily equity', () => {
    const result = assessPaperOrderRisk({ ...base, side: 'buy' });
    expect(result.projectedEquity).toBeCloseTo(99999.9);
    expect(result.dailyLoss).toBeCloseTo(0.1);
    expect(result.breach).toBeNull();
  });

  it('detects a daily loss breach caused by a repriced held position', () => {
    const result = assessPaperOrderRisk({
      ...base,
      cashBalance: 100000,
      grossExposure: 100000,
      heldQuantity: 1000,
      heldMarkPrice: 100,
      orderQuantity: 1,
      referencePrice: 10,
      side: 'sell',
      startingDailyEquity: 200000,
      lifetimePeakEquity: 200000,
      limits: { maxDailyLoss: 1000, maxDrawdownPct: 50 },
    });
    expect(result.dailyLoss).toBeGreaterThan(1000);
    expect(result.breach).toBe('daily_loss_limit');
  });

  it('detects a lifetime drawdown breach', () => {
    const result = assessPaperOrderRisk({
      ...base,
      cashBalance: 100000,
      grossExposure: 100000,
      heldQuantity: 1000,
      heldMarkPrice: 100,
      orderQuantity: 1,
      referencePrice: 50,
      side: 'sell',
      startingDailyEquity: 200000,
      lifetimePeakEquity: 200000,
      limits: { maxDailyLoss: 100000, maxDrawdownPct: 10 },
    });
    expect(result.breach).toBe('max_drawdown_limit');
  });

  it('rejects sells exceeding the held quantity', () => {
    expect(() => assessPaperOrderRisk({ ...base, side: 'sell' })).toThrow(/exceeds the held position/);
  });

  it('rejects non-finite or negative input values', () => {
    expect(() => assessPaperOrderRisk({ ...base, cashBalance: Number.NaN, side: 'buy' })).toThrow(/finite/);
  });
});
