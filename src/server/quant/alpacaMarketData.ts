export type QuantBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type AlpacaDailyImport = {
  symbol: string;
  provider: 'alpaca';
  feed: 'iex';
  timeframe: '1Day';
  adjustment: 'all';
  fetchedAt: string;
  firstBarAt: string;
  lastBarAt: string;
  bars: QuantBar[];
  coverageNote: string;
};

export class MarketDataError extends Error {
  constructor(
    readonly code: 'not_configured' | 'invalid_symbol' | 'invalid_limit' | 'provider_error' |
      'provider_rate_limited' | 'invalid_payload' | 'insufficient_history' | 'stale_data',
    message: string,
    readonly statusCode: number,
    readonly lastBarAt?: string,
  ) {
    super(message);
    this.name = 'MarketDataError';
  }
}

type AlpacaBar = { t?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown; v?: unknown };
type AlpacaResponse = { bars?: unknown };

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeBars(raw: unknown, now: Date): QuantBar[] {
  if (!Array.isArray(raw)) throw new MarketDataError('invalid_payload', 'Market-data provider returned no bar array.', 502);
  const currentUtcDate = now.toISOString().slice(0, 10);
  const bars: QuantBar[] = [];
  let previousDate = '';

  for (const candidate of raw as AlpacaBar[]) {
    if (!candidate || typeof candidate !== 'object' || typeof candidate.t !== 'string') {
      throw new MarketDataError('invalid_payload', 'Market-data provider returned a malformed bar.', 502);
    }
    const timestamp = new Date(candidate.t);
    if (!Number.isFinite(timestamp.getTime())) {
      throw new MarketDataError('invalid_payload', 'Market-data provider returned an invalid bar timestamp.', 502);
    }
    const date = timestamp.toISOString().slice(0, 10);

    // Daily bars for the current UTC date may still be forming. Keep only completed days.
    if (date === currentUtcDate) continue;
    if (date <= previousDate) {
      throw new MarketDataError('invalid_payload', 'Market-data bars are not strictly chronological.', 502);
    }
    const open = candidate.o;
    const high = candidate.h;
    const low = candidate.l;
    const close = candidate.c;
    if (![open, high, low, close].every(finitePositive)) {
      throw new MarketDataError('invalid_payload', 'Market-data provider returned a non-positive or non-finite OHLC value.', 502);
    }
    const volume = candidate.v === undefined ? 0 : candidate.v;
    if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0) {
      throw new MarketDataError('invalid_payload', 'Market-data provider returned invalid volume.', 502);
    }
    if (
      (high as number) < Math.max(open as number, close as number, low as number) ||
      (low as number) > Math.min(open as number, close as number, high as number)
    ) {
      throw new MarketDataError('invalid_payload', 'Market-data provider returned inconsistent OHLC values.', 502);
    }

    bars.push({
      date,
      open: open as number,
      high: high as number,
      low: low as number,
      close: close as number,
      volume,
    });
    previousDate = date;
  }
  return bars;
}

export async function fetchAlpacaDailyBars(options: {
  symbol: string;
  limit: number;
  apiKey?: string;
  apiSecret?: string;
  now?: Date;
  fetcher?: typeof fetch;
}): Promise<AlpacaDailyImport> {
  const symbol = options.symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,15}$/.test(symbol)) {
    throw new MarketDataError('invalid_symbol', 'Use a valid US equity or ETF ticker symbol.', 400);
  }
  if (!Number.isInteger(options.limit) || options.limit < 30 || options.limit > 1000) {
    throw new MarketDataError('invalid_limit', 'Daily history limit must be between 30 and 1,000 bars.', 400);
  }

  const apiKey = options.apiKey?.trim();
  const apiSecret = options.apiSecret?.trim();
  if (!apiKey || !apiSecret) {
    throw new MarketDataError(
      'not_configured',
      'Alpaca market data is not configured. Add the paper-account API key and secret to the server environment.',
      503,
    );
  }

  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const start = new Date(now.getTime() - options.limit * 3 * 24 * 60 * 60 * 1000).toISOString();
  const end = now.toISOString();
  const url = new URL(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars`);
  url.searchParams.set('timeframe', '1Day');
  url.searchParams.set('start', start);
  url.searchParams.set('end', end);
  url.searchParams.set('limit', String(options.limit));
  url.searchParams.set('adjustment', 'all');
  url.searchParams.set('feed', 'iex');
  url.searchParams.set('sort', 'asc');

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url, {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new MarketDataError('provider_error', 'Alpaca market-data request failed or timed out.', 502);
  }

  if (response.status === 429) {
    throw new MarketDataError('provider_rate_limited', 'Alpaca market-data rate limit was reached. Retry later.', 503);
  }
  if (!response.ok) {
    throw new MarketDataError('provider_error', `Alpaca market-data provider returned HTTP ${response.status}.`, 502);
  }

  let payload: AlpacaResponse;
  try {
    payload = await response.json() as AlpacaResponse;
  } catch {
    throw new MarketDataError('invalid_payload', 'Alpaca returned invalid JSON.', 502);
  }
  const bars = normalizeBars(payload.bars, now).slice(-options.limit);
  if (bars.length < 30) {
    throw new MarketDataError('insufficient_history', 'The selected symbol returned fewer than 30 completed daily bars.', 422);
  }

  const firstBarAt = new Date(`${bars[0].date}T00:00:00.000Z`).toISOString();
  const lastBarAt = new Date(`${bars[bars.length - 1].date}T23:59:59.999Z`).toISOString();
  const ageMs = now.getTime() - new Date(lastBarAt).getTime();
  if (ageMs > 5 * 24 * 60 * 60 * 1000) {
    throw new MarketDataError(
      'stale_data',
      'The latest completed IEX daily bar is more than five calendar days old; stale data cannot be used for a new backtest.',
      409,
      lastBarAt,
    );
  }

  return {
    symbol,
    provider: 'alpaca',
    feed: 'iex',
    timeframe: '1Day',
    adjustment: 'all',
    fetchedAt,
    firstBarAt,
    lastBarAt,
    bars,
    coverageNote: 'IEX is a single US equity exchange feed, not consolidated SIP coverage.',
  };
}
