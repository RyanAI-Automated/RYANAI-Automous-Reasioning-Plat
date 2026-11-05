import type { QuantBar } from './alpacaMarketData.js';

export type MarketDataRequest = {
  symbol: string;
  limit?: number;
};

export type MarketDataProvider = {
  readonly id: string;
  readonly capabilities: readonly ['daily_bars'];
  fetchDailyBars(request: MarketDataRequest): Promise<{
    symbol: string;
    bars: QuantBar[];
    provenance: Record<string, unknown>;
  }>;
};

export function createAlpacaMarketDataProvider(options: {
  apiKey?: string;
  apiSecret?: string;
}): MarketDataProvider {
  return {
    id: 'alpaca',
    capabilities: ['daily_bars'],
    async fetchDailyBars(request) {
      const { fetchAlpacaDailyBars } = await import('./alpacaMarketData.js');
      const result = await fetchAlpacaDailyBars({
        symbol: request.symbol,
        limit: request.limit ?? 250,
        apiKey: options.apiKey,
        apiSecret: options.apiSecret,
      });
      return {
        symbol: result.symbol,
        bars: result.bars,
        provenance: {
          provider: result.provider,
          feed: result.feed,
          timeframe: result.timeframe,
          adjustment: result.adjustment,
          fetchedAt: result.fetchedAt,
          firstBarAt: result.firstBarAt,
          lastBarAt: result.lastBarAt,
          coverageNote: result.coverageNote,
        },
      };
    },
  };
}
