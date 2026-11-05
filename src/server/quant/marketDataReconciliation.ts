export type ReconciliationBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type StreamBarEvent = {
  id: string;
  eventTimestamp: string | Date;
  bar: unknown;
};

export type DailyReconciliation = {
  date: string;
  status: 'no_stream_data' | 'incomplete_stream_coverage' | 'candidate_match' | 'candidate_mismatch';
  historical: ReconciliationBar;
  streamed: ReconciliationBar | null;
  minuteCount: number;
  firstMinuteAt: string | null;
  lastMinuteAt: string | null;
  differences: {
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
  };
  note: string;
};

const SESSION_OPEN_MINUTE = 9 * 60 + 30;
const SESSION_CLOSE_MINUTE = 16 * 60;
const EXPECTED_REGULAR_MINUTES = SESSION_CLOSE_MINUTE - SESSION_OPEN_MINUTE;
const newYorkClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseStreamBar(event: StreamBarEvent): ReconciliationBar | null {
  if (!event.bar || typeof event.bar !== 'object' || Array.isArray(event.bar)) return null;
  const value = event.bar as Record<string, unknown>;
  if (![value.open, value.high, value.low, value.close, value.volume].every(finite)) return null;
  const { open, high, low, close, volume } = value as {
    open: number; high: number; low: number; close: number; volume: number;
  };
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0 ||
      high < Math.max(open, high, low, close) || low > Math.min(open, high, low, close)) return null;
  return { date: '', open, high, low, close, volume };
}

function localSessionMinute(timestamp: string | Date): { date: string; minute: number } | null {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(newYorkClock.formatToParts(date).map((part) => [part.type, part.value]));
  const year = parts.year, month = parts.month, day = parts.day;
  const hour = Number(parts.hour), minute = Number(parts.minute);
  if (!year || !month || !day || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return { date: `${year}-${month}-${day}`, minute: hour * 60 + minute };
}

function relativeDifference(actual: number, expected: number): number {
  if (expected === 0) return actual === 0 ? 0 : actual;
  return ((actual - expected) / Math.abs(expected)) * 100;
}

function matches(historical: ReconciliationBar, streamed: ReconciliationBar): boolean {
  const priceKeys: Array<'open' | 'high' | 'low' | 'close'> = ['open', 'high', 'low', 'close'];
  const pricesMatch = priceKeys.every((key) => {
    const expected = historical[key], actual = streamed[key];
    return Math.abs(actual - expected) <= Math.max(0.000001, Math.abs(expected) * 0.000001);
  });
  return pricesMatch && historical.volume === streamed.volume;
}

/**
 * Compare completed daily history with regular-session aggregates from minute
 * stream events. A match is only a candidate: the source bars are never mutated.
 */
export function reconcileDailyBarsWithMinuteEvents(
  historicalBars: ReconciliationBar[],
  events: StreamBarEvent[],
  options: { eventsTruncated?: boolean } = {},
): DailyReconciliation[] {
  const historical = new Map<string, ReconciliationBar>();
  for (const bar of historicalBars) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date) ||
        ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(finite) ||
        bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0 || bar.volume < 0) {
      throw new Error('Historical bars contain invalid values.');
    }
    historical.set(bar.date, bar);
  }

  // A later event ID is a correction to the same provider minute; replay retains
  // all versions, while reconciliation uses the latest persisted version.
  const latestByTimestamp = new Map<string, { id: string; bar: ReconciliationBar; local: { date: string; minute: number } }>();
  for (const event of events) {
    const timestamp = new Date(event.eventTimestamp instanceof Date ? event.eventTimestamp.getTime() : event.eventTimestamp);
    if (!Number.isFinite(timestamp.getTime())) continue;
    const iso = timestamp.toISOString();
    const local = localSessionMinute(timestamp);
    if (!local || local.minute < SESSION_OPEN_MINUTE || local.minute >= SESSION_CLOSE_MINUTE) continue;
    const bar = parseStreamBar(event);
    if (!bar) continue;
    if (!/^\d{1,19}$/.test(event.id)) continue;
    const prior = latestByTimestamp.get(iso);
    if (!prior || BigInt(event.id) > BigInt(prior.id)) latestByTimestamp.set(iso, { id: event.id, bar, local });
  }

  const grouped = new Map<string, Array<{ timestamp: string; minute: number; bar: ReconciliationBar }>>();
  for (const [timestamp, item] of latestByTimestamp) {
    const group = grouped.get(item.local.date) ?? [];
    group.push({ timestamp, minute: item.local.minute, bar: item.bar });
    grouped.set(item.local.date, group);
  }

  return [...historical.values()].sort((a, b) => a.date.localeCompare(b.date)).map<DailyReconciliation>((daily) => {
    const minutes = (grouped.get(daily.date) ?? []).sort((a, b) => a.minute - b.minute);
    if (!minutes.length) {
      return {
        date: daily.date, status: 'no_stream_data', historical: daily, streamed: null,
        minuteCount: 0, firstMinuteAt: null, lastMinuteAt: null,
        differences: { open: null, high: null, low: null, close: null, volume: null },
        note: 'No regular-session minute events were persisted for this date.',
      };
    }
    const first = minutes[0], last = minutes[minutes.length - 1];
    const aggregate: ReconciliationBar = {
      date: daily.date,
      open: first.bar.open,
      high: minutes.reduce((value, item) => Math.max(value, item.bar.high), Number.NEGATIVE_INFINITY),
      low: minutes.reduce((value, item) => Math.min(value, item.bar.low), Number.POSITIVE_INFINITY),
      close: last.bar.close,
      volume: minutes.reduce((sum, item) => sum + item.bar.volume, 0),
    };
    const complete = !options.eventsTruncated &&
      minutes.length === EXPECTED_REGULAR_MINUTES &&
      first.minute === SESSION_OPEN_MINUTE &&
      last.minute === SESSION_CLOSE_MINUTE - 1;
    const differences = {
      open: relativeDifference(aggregate.open, daily.open),
      high: relativeDifference(aggregate.high, daily.high),
      low: relativeDifference(aggregate.low, daily.low),
      close: relativeDifference(aggregate.close, daily.close),
      volume: relativeDifference(aggregate.volume, daily.volume),
    };
    const equal = matches(daily, aggregate);
    return {
      date: daily.date,
      status: !complete ? 'incomplete_stream_coverage' : equal ? 'candidate_match' : 'candidate_mismatch',
      historical: daily,
      streamed: aggregate,
      minuteCount: minutes.length,
      firstMinuteAt: first.timestamp,
      lastMinuteAt: last.timestamp,
      differences,
      note: complete
        ? 'Full regular-session minute coverage detected; this is a comparison candidate, not an authoritative replacement.'
        : 'Stream coverage is partial or truncated. Historical data remains authoritative; no bar was overwritten.',
    };
  });
}
