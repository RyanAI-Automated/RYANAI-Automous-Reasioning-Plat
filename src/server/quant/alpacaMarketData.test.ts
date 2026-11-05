import { describe, expect, it, vi } from 'vitest';
import { fetchAlpacaDailyBars, MarketDataError } from './alpacaMarketData.js';

const fixedNow = new Date('2026-11-05T22:00:00.000Z');

function bars(count: number, start = new Date('2026-09-01T00:00:00.000Z')) {
  const result = [];
  const cursor = new Date(start);
  while (result.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      result.push({
        t: cursor.toISOString(),
        o: 100,
        h: 105,
        l: 95,
        c: 101,
        v: 1000,
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

describe('Alpaca daily market data adapter', () => {
  it('fails closed when server-side paper API credentials are absent', async () => {
    await expect(fetchAlpacaDailyBars({
      symbol: 'SPY', limit: 250, now: fixedNow,
    })).rejects.toMatchObject({ code: 'not_configured', statusCode: 503 });
  });

  it('requests the free IEX daily feed and returns normalized completed bars with provenance', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ bars: bars(35, new Date('2026-09-18T00:00:00.000Z')) }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const result = await fetchAlpacaDailyBars({
      symbol: ' spy ', limit: 30, apiKey: 'paper-key', apiSecret: 'paper-secret',
      now: fixedNow, fetcher,
    });
    expect(result).toMatchObject({
      symbol: 'SPY', provider: 'alpaca', feed: 'iex', timeframe: '1Day',
      adjustment: 'all', bars: expect.any(Array),
    });
    expect(result.bars).toHaveLength(30);
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain('feed=iex');
    expect(String(url)).toContain('timeframe=1Day');
    expect(init.headers).toMatchObject({
      'APCA-API-KEY-ID': 'paper-key',
      'APCA-API-SECRET-KEY': 'paper-secret',
    });
  });

  it('rejects stale completed daily data', async () => {
    const stale = bars(35, new Date('2026-09-01T00:00:00.000Z'));
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ bars: stale }), { status: 200 }));
    await expect(fetchAlpacaDailyBars({
      symbol: 'SPY', limit: 250, apiKey: 'paper-key', apiSecret: 'paper-secret',
      now: fixedNow, fetcher,
    })).rejects.toMatchObject({ code: 'stale_data', statusCode: 409 });
  });

  it('rejects malformed OHLC values instead of passing them to the backtester', async () => {
    const malformed = bars(35);
    malformed[4] = { ...malformed[4], h: 90 };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ bars: malformed }), { status: 200 }));
    await expect(fetchAlpacaDailyBars({
      symbol: 'SPY', limit: 30, apiKey: 'paper-key', apiSecret: 'paper-secret',
      now: fixedNow, fetcher,
    })).rejects.toMatchObject({ code: 'invalid_payload', statusCode: 502 });
  });

  it('rejects symbols outside the safe ticker syntax', async () => {
    await expect(fetchAlpacaDailyBars({
      symbol: 'SPY/../../users', limit: 30, apiKey: 'paper-key', apiSecret: 'paper-secret',
      now: fixedNow,
    })).rejects.toBeInstanceOf(MarketDataError);
  });
});
