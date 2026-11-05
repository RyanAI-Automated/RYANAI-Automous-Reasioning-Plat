import { describe, expect, it } from 'vitest';
import { reconcilePaperOrder, type PaperOrderLedgerSnapshot } from './paperOrderReconciliation.js';

function snapshot(overrides: Partial<PaperOrderLedgerSnapshot> = {}): PaperOrderLedgerSnapshot {
  return {
    id: 'order-1',
    symbol: 'AAPL',
    side: 'buy',
    status: 'filled',
    quantity: 10,
    storedFilledQuantity: 10,
    storedRemainingQuantity: 0,
    storedAverageFillPrice: 100,
    storedFillPrice: 100,
    storedFee: 0.5,
    fills: [{ id: 'fill-1', clientFillId: 'paper:order-1', quantity: 10, price: 100, fee: 0.5 }],
    ...overrides,
  };
}

describe('paper order fill reconciliation', () => {
  it('accepts a consistent idempotent full-fill ledger', () => {
    const result = reconcilePaperOrder(snapshot());
    expect(result.consistent).toBe(true);
    expect(result.ledgerFilledQuantity).toBe(10);
    expect(result.remainingQuantity).toBe(0);
    expect(result.averageFillPrice).toBe(100);
  });

  it('detects denormalized quantity, average price and fee mismatches', () => {
    const result = reconcilePaperOrder(snapshot({
      storedFilledQuantity: 9,
      storedRemainingQuantity: 1,
      storedAverageFillPrice: 99,
      storedFee: 0.25,
    }));
    expect(result.consistent).toBe(false);
    expect(result.discrepancyReasons).toEqual(expect.arrayContaining([
      'stored_filled_quantity_mismatch',
      'stored_remaining_quantity_mismatch',
      'stored_fee_mismatch',
      'average_fill_price_mismatch',
    ]));
  });

  it('detects duplicate client fill identifiers and overfills', () => {
    const result = reconcilePaperOrder(snapshot({
      quantity: 10,
      storedFilledQuantity: 11,
      storedRemainingQuantity: 0,
      fills: [
        { id: 'fill-1', clientFillId: 'same-fill', quantity: 6, price: 100, fee: 0.3 },
        { id: 'fill-2', clientFillId: 'same-fill', quantity: 5, price: 100, fee: 0.25 },
      ],
    }));
    expect(result.discrepancyReasons).toContain('duplicate_client_fill_id');
    expect(result.discrepancyReasons).toContain('overfilled_quantity');
  });

  it('flags a filled status when the ledger is partial', () => {
    const result = reconcilePaperOrder(snapshot({
      quantity: 10,
      storedFilledQuantity: 5,
      storedRemainingQuantity: 5,
      storedAverageFillPrice: 100,
      storedFee: 0.25,
      fills: [{ id: 'fill-1', clientFillId: 'partial-1', quantity: 5, price: 100, fee: 0.25 }],
    }));
    expect(result.discrepancyReasons).toContain('filled_status_without_full_quantity');
  });

  it('rejects non-finite or negative ledger values', () => {
    expect(() => reconcilePaperOrder(snapshot({
      fills: [{ id: 'fill-1', clientFillId: 'x', quantity: -1, price: 100, fee: 0 }],
    }))).toThrow(/finite and non-negative/);
  });
});
