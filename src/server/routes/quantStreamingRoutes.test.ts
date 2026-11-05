import { describe, expect, it } from 'vitest';
import { normalizeQuantStreamRequest } from './quantStreamingRoutes.js';

describe('normalizeQuantStreamRequest', () => {
  it('normalizes symbols and defaults to IEX', () => {
    expect(normalizeQuantStreamRequest({ symbols: [' aapl ', 'MSFT'] })).toEqual({
      symbols: ['AAPL', 'MSFT'], feed: 'iex',
    });
  });
  it('rejects duplicate symbols and extra properties', () => {
    expect(() => normalizeQuantStreamRequest({ symbols: ['AAPL', 'aapl'] })).toThrow(/Duplicate/);
    expect(() => normalizeQuantStreamRequest({ symbols: ['AAPL'], apiKey: 'secret' })).toThrow(/Only symbols and feed/);
  });
  it('bounds symbols and validates feed', () => {
    expect(() => normalizeQuantStreamRequest({ symbols: [] })).toThrow(/between 1 and 5/);
    expect(() => normalizeQuantStreamRequest({ symbols: ['AAPL'], feed: 'unknown' })).toThrow(/Unsupported/);
  });
});

import { marketBarPayloadHash } from './quantStreamingRoutes.js';

describe('marketBarPayloadHash', () => {
  const bar = {
    symbol: 'AAPL', date: '2026-11-05', timestamp: '2026-11-05T14:30:00.000Z',
    open: 100, high: 102, low: 99, close: 101, volume: 1000,
    provider: 'alpaca' as const, feed: 'iex' as const, receivedAt: '2026-11-05T14:30:01.000Z',
  };

  it('deduplicates the same market event despite a different receipt time', () => {
    expect(marketBarPayloadHash(bar)).toBe(
      marketBarPayloadHash({ ...bar, receivedAt: '2026-11-05T14:30:05.000Z' }),
    );
  });

  it('distinguishes corrected bar payloads at the same event timestamp', () => {
    expect(marketBarPayloadHash(bar)).not.toBe(
      marketBarPayloadHash({ ...bar, close: 101.25 }),
    );
  });
});
