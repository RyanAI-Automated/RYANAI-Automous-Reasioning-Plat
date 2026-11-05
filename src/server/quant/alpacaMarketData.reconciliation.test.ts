import { describe, expect, it, vi } from 'vitest';
import { fetchAlpacaDailyBars } from './alpacaMarketData.js';

const now = new Date('2026-11-05T22:00:00.000Z');
const rawBars = Array.from({ length: 35 }, (_, index) => ({
  t: new Date(Date.UTC(2026, 8, 18 + index)).toISOString(),
  o: 100, h: 105, l: 95, c: 101, v: 1000,
}));

describe('raw historical bars for stream reconciliation', () => {
  it('requests raw adjustment and preserves it in provenance', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ bars: rawBars }), { status: 200 }));
    const result = await fetchAlpacaDailyBars({
      symbol: 'SPY', limit: 30, adjustment: 'raw',
      apiKey: 'paper-key', apiSecret: 'paper-secret', now, fetcher,
    });
    expect(result.adjustment).toBe('raw');
    const [url] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get('adjustment')).toBe('raw');
  });
});
