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
