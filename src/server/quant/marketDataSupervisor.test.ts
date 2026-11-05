import { describe, expect, it, vi } from 'vitest';
import { createMarketDataFanout, createMarketDataStreamSupervisor } from './marketDataSupervisor.js';
import type { MarketDataStream, StreamedMarketBar } from './marketDataStream.js';

const bar = (overrides: Partial<StreamedMarketBar> = {}): StreamedMarketBar => ({
  symbol: 'AAPL', date: '2026-11-05', timestamp: '2026-11-05T14:30:00.000Z',
  open: 100, high: 102, low: 99, close: 101, volume: 1000,
  provider: 'alpaca', feed: 'iex', receivedAt: '2026-11-05T14:30:01.000Z', ...overrides,
});

describe('market-data fan-out', () => {
  it('bounds subscriptions and rejects stale, duplicate and unknown-symbol bars', () => {
    const now = () => new Date('2026-11-05T14:31:00.000Z');
    const fanout = createMarketDataFanout({ maxSubscribers: 1, maxSymbols: 1, now, maxAgeMs: 120_000 });
    const listener = vi.fn();
    const subscription = fanout.subscribe('aapl', listener);
    expect(fanout.subscriberCount).toBe(1);
    expect(() => fanout.subscribe('MSFT', vi.fn())).toThrow(/symbol subscription limit/);
    expect(() => fanout.subscribe('AAPL', vi.fn())).toThrow(/subscriber limit/);
    expect(fanout.publish(bar())).toBe(true);
    expect(fanout.publish(bar())).toBe(false);
    expect(fanout.publish(bar({ timestamp: '2026-11-05T14:00:00Z' }))).toBe(false);
    expect(fanout.publish(bar({ symbol: 'MSFT' }))).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
    subscription.unsubscribe();
    expect(fanout.subscriberCount).toBe(0);
  });
  it('isolates subscriber exceptions and closes subscriptions', () => {
    const fanout = createMarketDataFanout({ now: () => new Date('2026-11-05T14:31:00Z') });
    const healthy = vi.fn();
    fanout.subscribe('AAPL', () => { throw new Error('consumer failure'); });
    fanout.subscribe('AAPL', healthy);
    expect(fanout.publish(bar())).toBe(true);
    expect(healthy).toHaveBeenCalledOnce();
    fanout.close();
    expect(fanout.subscriberCount).toBe(0);
    expect(() => fanout.subscribe('AAPL', vi.fn())).toThrow(/closed/);
  });
});

describe('market-data stream supervisor', () => {
  it('reconnects with capped backoff after a stream error and stops cleanly', async () => {
    let callback: (() => void) | undefined;
    let delay = 0;
    const timerApi = {
      set: vi.fn((fn: () => void, ms: number) => { callback = fn; delay = ms; return 1; }),
      clear: vi.fn(),
    };
    let created = 0;
    const createStream = vi.fn((handlers: { onBar: (bar: StreamedMarketBar) => void; onError: (error: Error) => void }): MarketDataStream => {
      created += 1;
      return {
        provider: 'alpaca', feed: 'iex',
        connect: async () => { if (created === 1) handlers.onError(new Error('socket dropped')); },
        close: vi.fn(),
      };
    });
    const states = vi.fn();
    const supervisor = createMarketDataStreamSupervisor({
      createStream, onBar: vi.fn(), onState: states, timers: timerApi, random: () => 0,
      baseDelayMs: 100, maxDelayMs: 500, maxAttempts: 3,
    });
    supervisor.start();
    await Promise.resolve();
    expect(supervisor.state.status).toBe('backoff');
    expect(delay).toBe(50);
    callback?.();
    await Promise.resolve();
    expect(created).toBe(2);
    expect(supervisor.state.status).toBe('connected');
    supervisor.stop();
    expect(supervisor.state.status).toBe('stopped');
    expect(states).toHaveBeenCalled();
  });
  it('rejects invalid retry policies', () => {
    expect(() => createMarketDataStreamSupervisor({
      createStream: () => ({ provider: 'alpaca', feed: 'iex', connect: async () => {}, close: () => {} }),
      onBar: vi.fn(), baseDelayMs: 0,
    })).toThrow(/retry policy/);
  });
});
