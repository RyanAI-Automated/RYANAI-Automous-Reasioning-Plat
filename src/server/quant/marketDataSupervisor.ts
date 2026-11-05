import type { MarketDataStream, StreamedMarketBar } from './marketDataStream.js';

export type StreamSupervisorState =
  | { status: 'stopped' }
  | { status: 'connecting'; attempt: number }
  | { status: 'connected'; attempt: number; connectedAt: string }
  | { status: 'backoff'; attempt: number; retryInMs: number; reason: string };

export type StreamSupervisor = {
  start(): void;
  stop(): void;
  readonly state: StreamSupervisorState;
};

type TimerApi = {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
};

/**
 * Reconnect supervisor for a single provider stream. It deliberately does not
 * persist bars or place orders. Retry delays use capped exponential backoff.
 */
export function createMarketDataStreamSupervisor(options: {
  createStream: (handlers: {
    onBar: (bar: StreamedMarketBar) => void;
    onError: (error: Error) => void;
  }) => MarketDataStream;
  onBar: (bar: StreamedMarketBar) => void;
  onState?: (state: StreamSupervisorState) => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  random?: () => number;
  timers?: TimerApi;
}): StreamSupervisor {
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const maxAttempts = options.maxAttempts ?? 8;
  const random = options.random ?? Math.random;
  const timers = options.timers ?? {
    set: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  if (!Number.isInteger(baseDelayMs) || baseDelayMs < 1 ||
      !Number.isInteger(maxDelayMs) || maxDelayMs < baseDelayMs ||
      !Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('Invalid market-data reconnect policy.');
  }

  let currentState: StreamSupervisorState = { status: 'stopped' };
  let stream: MarketDataStream | undefined;
  let timer: unknown;
  let generation = 0;
  let attempt = 0;
  let stopped = true;
  const setState = (state: StreamSupervisorState) => {
    currentState = state;
    options.onState?.(state);
  };
  const closeCurrent = () => {
    const current = stream;
    stream = undefined;
    try { current?.close(); } catch { /* close is best-effort; supervisor owns recovery */ }
  };
  const scheduleRetry = (reason: string, run: number) => {
    if (stopped || run !== generation) return;
    closeCurrent();
    if (attempt >= maxAttempts) {
      stopped = true;
      setState({ status: 'stopped' });
      return;
    }
    const exponent = Math.min(attempt, 20);
    const ceiling = Math.min(maxDelayMs, baseDelayMs * (2 ** exponent));
    const jitter = 0.5 + Math.min(1, Math.max(0, random()));
    const retryInMs = Math.min(maxDelayMs, Math.round(ceiling * jitter));
    attempt += 1;
    setState({ status: 'backoff', attempt, retryInMs, reason });
    timer = timers.set(() => {
      timer = undefined;
      void connect(run);
    }, retryInMs);
  };
  const connect = async (run: number) => {
    if (stopped || run !== generation) return;
    setState({ status: 'connecting', attempt: attempt + 1 });
    try {
      const next = options.createStream({
        onBar: (bar) => {
          if (!stopped && run === generation) options.onBar(bar);
        },
        onError: (error) => scheduleRetry(error.message, run),
      });
      stream = next;
      await next.connect();
      if (stopped || run !== generation) {
        if (stream === next) closeCurrent();
        return;
      }
      attempt = 0;
      setState({ status: 'connected', attempt: 0, connectedAt: new Date().toISOString() });
    } catch (error) {
      scheduleRetry(error instanceof Error ? error.message : 'Market-data stream connection failed.', run);
    }
  };
  return {
    get state() { return currentState; },
    start() {
      if (!stopped) return;
      stopped = false;
      attempt = 0;
      generation += 1;
      void connect(generation);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      generation += 1;
      if (timer !== undefined) timers.clear(timer);
      timer = undefined;
      closeCurrent();
      setState({ status: 'stopped' });
    },
  };
}

export type MarketDataSubscription = {
  unsubscribe(): void;
};

export type MarketDataFanout = {
  subscribe(symbol: string, listener: (bar: StreamedMarketBar) => void): MarketDataSubscription;
  publish(bar: StreamedMarketBar): boolean;
  close(): void;
  readonly subscriberCount: number;
};

/**
 * Bounded in-process fan-out for live subscribers. This is intentionally
 * ephemeral; durable event storage/replay is a separate database-backed layer.
 */
export function createMarketDataFanout(options: {
  maxSubscribers?: number;
  maxSymbols?: number;
  now?: () => Date;
  maxAgeMs?: number;
} = {}): MarketDataFanout {
  const maxSubscribers = options.maxSubscribers ?? 100;
  const maxSymbols = options.maxSymbols ?? 50;
  const maxAgeMs = options.maxAgeMs ?? 120_000;
  const now = options.now ?? (() => new Date());
  if (!Number.isInteger(maxSubscribers) || maxSubscribers < 1 ||
      !Number.isInteger(maxSymbols) || maxSymbols < 1 ||
      !Number.isFinite(maxAgeMs) || maxAgeMs < 1) {
    throw new Error('Invalid market-data fan-out limits.');
  }
  const listeners = new Map<string, Set<(bar: StreamedMarketBar) => void>>();
  const lastTimestamp = new Map<string, number>();
  let subscriberCount = 0;
  let closed = false;
  return {
    get subscriberCount() { return subscriberCount; },
    subscribe(symbol, listener) {
      if (closed) throw new Error('Market-data fan-out is closed.');
      const normalized = symbol.trim().toUpperCase();
      if (!/^[A-Z0-9.-]{1,15}$/.test(normalized)) throw new Error('Invalid market-data symbol.');
      if (typeof listener !== 'function') throw new Error('A market-data listener is required.');
      let group = listeners.get(normalized);
      if (!group) {
        if (listeners.size >= maxSymbols) throw new Error('Market-data symbol subscription limit reached.');
        group = new Set();
        listeners.set(normalized, group);
      }
      if (subscriberCount >= maxSubscribers) throw new Error('Market-data subscriber limit reached.');
      group.add(listener);
      subscriberCount += 1;
      let active = true;
      return {
        unsubscribe() {
          if (!active) return;
          active = false;
          group!.delete(listener);
          subscriberCount -= 1;
          if (group!.size === 0) {
            listeners.delete(normalized);
            lastTimestamp.delete(normalized);
          }
        },
      };
    },
    publish(bar) {
      if (closed) return false;
      const symbol = bar.symbol.trim().toUpperCase();
      const timestamp = Date.parse(bar.timestamp);
      const receivedAt = Date.parse(bar.receivedAt);
      const current = now().getTime();
      if (!listeners.has(symbol) || !Number.isFinite(timestamp) || !Number.isFinite(receivedAt) ||
          timestamp > current + 30_000 || receivedAt > current + 30_000 ||
          current - timestamp > maxAgeMs || current - receivedAt > maxAgeMs) return false;
      const previous = lastTimestamp.get(symbol) ?? 0;
      if (timestamp <= previous) return false;
      lastTimestamp.set(symbol, timestamp);
      for (const listener of listeners.get(symbol) ?? []) {
        try { listener(bar); } catch { /* isolate individual subscribers */ }
      }
      return true;
    },
    close() {
      closed = true;
      listeners.clear();
      lastTimestamp.clear();
      subscriberCount = 0;
    },
  };
}
