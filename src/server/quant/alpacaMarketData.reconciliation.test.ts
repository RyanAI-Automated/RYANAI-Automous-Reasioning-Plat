import { describe, expect, it, vi } from 'vitest';
import { fetchAlpacaDailyBars } from './alpacaMarketData.js';

const now = new Date('2026-11-05T22:00:00.000Z');
const rawBars = (() => {
  const result: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }> = [];
  const cursor = new Date('2026-09-17T00:00:00.000Z');
  while (result.length < 35) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      result.push({ t: cursor.toISOString(), o: 100, h: 105, l: 95, c: 101, v: 1000 });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
})();

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
