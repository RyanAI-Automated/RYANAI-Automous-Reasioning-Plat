import { describe, expect, it } from 'vitest';
import { getSnapshotFreshness } from './healthFreshness.js';

const NOW = Date.parse('2026-11-05T10:00:00.000Z');

describe('getSnapshotFreshness', () => {
  it('accepts a recent timestamp within the freshness window', () => {
    expect(getSnapshotFreshness('2026-11-05T09:59:30.000Z', NOW, 60_000)).toBe('fresh');
  });

  it('marks an old timestamp as stale', () => {
    expect(getSnapshotFreshness('2026-11-05T09:58:59.000Z', NOW, 60_000)).toBe('stale');
  });

  it('does not mark a future timestamp as fresh', () => {
    expect(getSnapshotFreshness('2026-11-05T10:00:01.000Z', NOW, 60_000)).toBe('unknown');
  });

  it.each([undefined, null, '', 'not-a-date'])('treats missing or invalid timestamp %s as unknown', (timestamp) => {
    expect(getSnapshotFreshness(timestamp, NOW)).toBe('unknown');
  });

  it('treats an invalid clock or freshness window as unknown', () => {
    expect(getSnapshotFreshness('2026-11-05T09:59:30.000Z', Number.NaN)).toBe('unknown');
    expect(getSnapshotFreshness('2026-11-05T09:59:30.000Z', NOW, -1)).toBe('unknown');
  });
});
