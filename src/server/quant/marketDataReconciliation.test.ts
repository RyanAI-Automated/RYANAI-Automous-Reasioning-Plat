import { describe, expect, it } from 'vitest';
import { reconcileDailyBarsWithMinuteEvents } from './marketDataReconciliation.js';

const historical = {
  date: '2026-11-05', open: 100, high: 102, low: 99, close: 101, volume: 3900,
};

function fullSessionEvents() {
  return Array.from({ length: 390 }, (_, index) => {
    const timestamp = new Date(Date.UTC(2026, 10, 5, 14, 30 + index)).toISOString();
    return {
      id: String(index + 1),
      eventTimestamp: timestamp,
      bar: { open: 100, high: 102, low: 99, close: 101, volume: 10 },
    };
  });
}

describe('reconcileDailyBarsWithMinuteEvents', () => {
  it('aggregates a complete New York regular session and reports a candidate match', () => {
    const result = reconcileDailyBarsWithMinuteEvents([historical], fullSessionEvents());
    expect(result[0].status).toBe('candidate_match');
    expect(result[0].minuteCount).toBe(390);
    expect(result[0].streamed).toMatchObject({ open: 100, high: 102, low: 99, close: 101, volume: 3900 });
  });

  it('does not call partial stream coverage a match', () => {
    const result = reconcileDailyBarsWithMinuteEvents([historical], fullSessionEvents().slice(0, 100));
    expect(result[0].status).toBe('incomplete_stream_coverage');
    expect(result[0].note).toMatch(/Historical data remains authoritative/);
  });

  it('uses the latest persisted correction for a minute timestamp', () => {
    const events = fullSessionEvents();
    events.push({
      id: '9999',
      eventTimestamp: events[0].eventTimestamp,
      bar: { open: 100, high: 103, low: 99, close: 101, volume: 10 },
    });
    const result = reconcileDailyBarsWithMinuteEvents([historical], events);
    expect(result[0].streamed?.high).toBe(103);
    expect(result[0].status).toBe('candidate_mismatch');
  });

  it('reports missing stream days and rejects invalid historical bars', () => {
    const result = reconcileDailyBarsWithMinuteEvents([historical], []);
    expect(result[0].status).toBe('no_stream_data');
    expect(() => reconcileDailyBarsWithMinuteEvents([{ ...historical, close: Number.NaN }], [])).toThrow(/invalid/);
  });

  it('marks truncated event queries as incomplete even if they appear to cover a full session', () => {
    const result = reconcileDailyBarsWithMinuteEvents([historical], fullSessionEvents(), { eventsTruncated: true });
    expect(result[0].status).toBe('incomplete_stream_coverage');
  });
});
