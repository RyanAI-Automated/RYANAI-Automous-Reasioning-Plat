import { describe, expect, it } from 'vitest';
import {
  MAX_DELAY_MINUTES,
  MAX_REPEAT_MINUTES,
  MIN_REPEAT_MINUTES,
  nextRunAfter,
  resolveSchedule,
} from './schedule.js';

const now = new Date('2026-10-27T10:00:00Z');

describe('resolveSchedule', () => {
  it('turns delayMinutes into a run time', () => {
    const result = resolveSchedule({ delayMinutes: 30 }, now);
    expect(result.runAt.toISOString()).toBe('2026-10-27T10:30:00.000Z');
    expect(result.intervalMinutes).toBeNull();
  });

  it('accepts runAt with an offset and a repeat interval', () => {
    const result = resolveSchedule(
      { runAt: '2026-10-28T09:00:00+02:00', repeatEveryMinutes: 1440 },
      now,
    );
    expect(result.runAt.toISOString()).toBe('2026-10-28T07:00:00.000Z');
    expect(result.intervalMinutes).toBe(1440);
  });

  it('rejects runAt without an offset', () => {
    expect(() => resolveSchedule({ runAt: '2026-10-28T09:00:00' }, now)).toThrow(/offset/);
  });

  it('rejects an invalid date', () => {
    expect(() => resolveSchedule({ runAt: '2026-13-45T99:00:00Z' }, now)).toThrow(/valid date/);
  });

  it('needs exactly one of runAt and delayMinutes', () => {
    expect(() => resolveSchedule({}, now)).toThrow(/either runAt or delayMinutes/);
    expect(() =>
      resolveSchedule({ runAt: '2026-10-28T09:00:00Z', delayMinutes: 5 }, now),
    ).toThrow(/either runAt or delayMinutes/);
  });

  it('rejects a time in the past but allows one minute of clock difference', () => {
    expect(() => resolveSchedule({ runAt: '2026-10-27T09:00:00Z' }, now)).toThrow(/past/);
    expect(() => resolveSchedule({ runAt: '2026-10-27T09:59:30Z' }, now)).not.toThrow();
  });

  it('rejects a time more than one year ahead', () => {
    expect(() => resolveSchedule({ runAt: '2028-01-01T00:00:00Z' }, now)).toThrow(/one year/);
    expect(() => resolveSchedule({ delayMinutes: MAX_DELAY_MINUTES + 1 }, now)).toThrow(
      /delayMinutes/,
    );
  });

  it('limits the repeat interval', () => {
    expect(() =>
      resolveSchedule({ delayMinutes: 5, repeatEveryMinutes: MIN_REPEAT_MINUTES - 1 }, now),
    ).toThrow(/repeatEveryMinutes/);
    expect(() =>
      resolveSchedule({ delayMinutes: 5, repeatEveryMinutes: MAX_REPEAT_MINUTES + 1 }, now),
    ).toThrow(/repeatEveryMinutes/);
    expect(() =>
      resolveSchedule({ delayMinutes: 5, repeatEveryMinutes: 20.5 }, now),
    ).toThrow(/whole number/);
  });
});

describe('nextRunAfter', () => {
  it('returns null for a one-time task', () => {
    expect(nextRunAfter(null, now)).toBeNull();
  });

  it('adds the interval for a repeating task', () => {
    expect(nextRunAfter(60, now)?.toISOString()).toBe('2026-10-27T11:00:00.000Z');
  });
});
