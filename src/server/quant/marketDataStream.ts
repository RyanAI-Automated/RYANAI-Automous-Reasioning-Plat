import type { QuantBar } from './alpacaMarketData.js';

export type StreamedMarketBar = QuantBar & {
  symbol: string; timestamp: string; provider: 'alpaca';
  feed: 'iex' | 'sip' | 'delayed_sip'; receivedAt: string;
};
export type MarketDataSocket = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void; close(): void;
};
export type MarketDataStream = {
  readonly provider: 'alpaca'; readonly feed: StreamedMarketBar['feed'];
  connect(): Promise<void>; close(): void;
};
type AlpacaStreamMessage = {
  T?: unknown; msg?: unknown; S?: unknown; t?: unknown;
  o?: unknown; h?: unknown; l?: unknown; c?: unknown; v?: unknown; bars?: unknown;
};
function validPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function parseBar(message: AlpacaStreamMessage, feed: StreamedMarketBar['feed'], receivedAt: Date): StreamedMarketBar {
  const symbol = message.S, time = message.t, open = message.o, high = message.h;
  const low = message.l, close = message.c, volume = message.v;
  if (typeof symbol !== 'string' || !/^[A-Z0-9.-]{1,15}$/.test(symbol) ||
      typeof time !== 'string' || !Number.isFinite(Date.parse(time)) ||
      !validPrice(open) || !validPrice(high) || !validPrice(low) || !validPrice(close) ||
      typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0) {
    throw new Error('Alpaca stream returned a malformed bar.');
  }
  const timestamp = new Date(time);
  if (timestamp.getTime() > receivedAt.getTime() + 30_000) throw new Error('Alpaca stream returned a future-dated bar.');
  if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
    throw new Error('Alpaca stream returned inconsistent OHLC values.');
  }
  return {
    symbol, timestamp: timestamp.toISOString(), date: timestamp.toISOString().slice(0, 10),
    open, high, low, close, volume, provider: 'alpaca', feed, receivedAt: receivedAt.toISOString(),
  };
}

/** Testable Alpaca stock-bars WebSocket adapter. It does not persist data, reconnect,
 * generate signals, or place orders. Credentials must be supplied server-side. */
export function createAlpacaStockStream(options: {
  apiKey?: string; apiSecret?: string; symbols: string[]; feed?: StreamedMarketBar['feed'];
  socketFactory: (url: string) => MarketDataSocket;
  onBar: (bar: StreamedMarketBar) => void; onError?: (error: Error) => void; now?: () => Date;
}): MarketDataStream {
  const apiKey = options.apiKey?.trim(), apiSecret = options.apiSecret?.trim();
  const symbols = [...new Set(options.symbols.map((symbol) => symbol.trim().toUpperCase()))];
  const feed = options.feed ?? 'iex';
  if (!apiKey || !apiSecret) throw new Error('Alpaca streaming credentials are not configured.');
  if (!symbols.length || symbols.some((symbol) => !/^[A-Z0-9.-]{1,15}$/.test(symbol))) {
    throw new Error('At least one valid stock symbol is required for streaming.');
  }
  if (!['iex', 'sip', 'delayed_sip'].includes(feed)) throw new Error('Unsupported Alpaca market-data feed.');
  let socket: MarketDataSocket | undefined, closed = false, authenticated = false, settled = false;
  const lastTimestamp = new Map<string, number>();
  let resolveConnect: (() => void) | undefined, rejectConnect: ((error: Error) => void) | undefined;
  const reportError = (error: Error) => {
    options.onError?.(error);
    if (!settled) { settled = true; rejectConnect?.(error); }
  };
  return {
    provider: 'alpaca', feed,
    connect() {
      if (socket) return Promise.reject(new Error('Alpaca stream is already connected or connecting.'));
      if (closed) return Promise.reject(new Error('Alpaca stream has been closed.'));
      return new Promise<void>((resolve, reject) => {
        resolveConnect = resolve; rejectConnect = reject;
        try { socket = options.socketFactory(`wss://stream.data.alpaca.markets/v2/${feed}`); }
        catch { reportError(new Error('Unable to create the Alpaca market-data socket.')); return; }
        socket.onopen = () => socket?.send(JSON.stringify({ action: 'auth', key: apiKey, secret: apiSecret }));
        socket.onmessage = (event) => {
          try {
            const payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (!Array.isArray(payload)) throw new Error('Alpaca stream returned an invalid message envelope.');
            for (const item of payload as AlpacaStreamMessage[]) {
              if (item?.T === 'error') throw new Error('Alpaca rejected the streaming session.');
              if (item?.T === 'success' && item.msg === 'authenticated') {
                authenticated = true;
                socket?.send(JSON.stringify({ action: 'subscribe', bars: symbols }));
                continue;
              }
              if (item?.T === 'subscription') {
                const subscribed = Array.isArray(item.bars) ? item.bars : [];
                if (!authenticated || !symbols.every((symbol) => subscribed.includes(symbol))) {
                  throw new Error('Alpaca stream subscription acknowledgement did not match requested symbols.');
                }
                if (!settled) { settled = true; resolveConnect?.(); }
                continue;
              }
              if (item?.T === 'b') {
                if (!authenticated) throw new Error('Alpaca sent market data before authentication.');
                const bar = parseBar(item, feed, (options.now ?? (() => new Date()))());
                if (!symbols.includes(bar.symbol)) throw new Error('Alpaca stream sent an unsubscribed symbol.');
                const current = Date.parse(bar.timestamp), previous = lastTimestamp.get(bar.symbol) ?? 0;
                if (current <= previous) throw new Error('Alpaca stream sent a duplicate or out-of-order bar.');
                lastTimestamp.set(bar.symbol, current); options.onBar(bar);
              }
            }
          } catch (error) {
            reportError(error instanceof Error ? error : new Error('Alpaca stream message processing failed.'));
            socket?.close();
          }
        };
        socket.onerror = () => reportError(new Error('Alpaca market-data stream connection failed.'));
        socket.onclose = () => { if (!closed) reportError(new Error('Alpaca market-data stream disconnected.')); };
      });
    },
    close() {
      closed = true;
      if (!settled) reportError(new Error('Alpaca market-data stream closed before subscription completed.'));
      socket?.close(); socket = undefined;
    },
  };
}
