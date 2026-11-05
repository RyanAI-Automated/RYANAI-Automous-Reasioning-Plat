import { describe, expect, it, vi } from 'vitest';
import { createAlpacaStockStream, type MarketDataSocket } from './marketDataStream.js';
class FakeSocket implements MarketDataSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = []; closed = false;
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const bar = (overrides: Record<string, unknown> = {}) => ({
  T: 'b', S: 'AAPL', t: '2026-11-05T14:30:00Z', o: 100, h: 102, l: 99, c: 101, v: 1200, ...overrides,
});
describe('Alpaca streaming market-data adapter', () => {
  it('authenticates, subscribes, and emits timestamped bars with provenance', async () => {
    const socket = new FakeSocket(), onBar = vi.fn();
    const stream = createAlpacaStockStream({
      apiKey: 'test-key', apiSecret: 'test-secret', symbols: ['aapl', 'AAPL'],
      socketFactory: vi.fn(() => socket), onBar, now: () => new Date('2026-11-05T14:31:00Z'),
    });
    const connected = stream.connect();
    expect(stream.feed).toBe('iex'); expect(socket.sent).toHaveLength(0);
    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({ action: 'auth', key: 'test-key', secret: 'test-secret' });
    socket.message([{ T: 'success', msg: 'authenticated' }]);
    expect(JSON.parse(socket.sent[1])).toEqual({ action: 'subscribe', bars: ['AAPL'] });
    socket.message([{ T: 'subscription', bars: ['AAPL'] }]); await connected;
    socket.message([bar()]);
    expect(onBar).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'AAPL', provider: 'alpaca', feed: 'iex', timestamp: '2026-11-05T14:30:00.000Z', close: 101,
    }));
    stream.close(); expect(socket.closed).toBe(true);
  });
  it('rejects missing credentials and malformed bars', async () => {
    expect(() => createAlpacaStockStream({ symbols: ['AAPL'], socketFactory: () => new FakeSocket(), onBar: vi.fn() })).toThrow(/credentials/);
    const socket = new FakeSocket(), onError = vi.fn();
    const stream = createAlpacaStockStream({
      apiKey: 'k', apiSecret: 's', symbols: ['AAPL'], socketFactory: () => socket,
      onBar: vi.fn(), onError, now: () => new Date('2026-11-05T14:31:00Z'),
    });
    const connected = stream.connect(); socket.open();
    socket.message([{ T: 'success', msg: 'authenticated' }]);
    socket.message([{ T: 'subscription', bars: ['AAPL'] }]); await connected;
    socket.message([bar({ c: null })]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/malformed/) }));
    expect(socket.closed).toBe(true);
  });
  it('rejects duplicate and out-of-order bars', async () => {
    const socket = new FakeSocket(), onError = vi.fn();
    const stream = createAlpacaStockStream({
      apiKey: 'k', apiSecret: 's', symbols: ['AAPL'], socketFactory: () => socket,
      onBar: vi.fn(), onError, now: () => new Date('2026-11-05T14:31:00Z'),
    });
    const connected = stream.connect(); socket.open();
    socket.message([{ T: 'success', msg: 'authenticated' }]);
    socket.message([{ T: 'subscription', bars: ['AAPL'] }]); await connected;
    socket.message([bar()]); socket.message([bar()]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/duplicate or out-of-order/) }));
  });
});


  it('rejects future-dated bars', async () => {
    const socket = new FakeSocket(), onError = vi.fn(), onBar = vi.fn();
    const stream = createAlpacaStockStream({
      apiKey: 'k', apiSecret: 's', symbols: ['AAPL'], socketFactory: () => socket,
      onBar, onError, now: () => new Date('2026-11-05T14:31:00Z'),
    });
    const connected = stream.connect(); socket.open();
    socket.message([{ T: 'success', msg: 'authenticated' }]);
    socket.message([{ T: 'subscription', bars: ['AAPL'] }]); await connected;
    socket.message([bar({ t: '2026-11-05T14:32:00Z' })]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/future-dated/) }));
    expect(onBar).not.toHaveBeenCalled();
    expect(socket.closed).toBe(true);
  });

  it('rejects bars for symbols outside the requested subscription', async () => {
    const socket = new FakeSocket(), onError = vi.fn(), onBar = vi.fn();
    const stream = createAlpacaStockStream({
      apiKey: 'k', apiSecret: 's', symbols: ['AAPL'], socketFactory: () => socket,
      onBar, onError, now: () => new Date('2026-11-05T14:31:00Z'),
    });
    const connected = stream.connect(); socket.open();
    socket.message([{ T: 'success', msg: 'authenticated' }]);
    socket.message([{ T: 'subscription', bars: ['AAPL'] }]); await connected;
    socket.message([bar({ S: 'MSFT' })]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/unsubscribed symbol/) }));
    expect(onBar).not.toHaveBeenCalled();
    expect(socket.closed).toBe(true);
  });
