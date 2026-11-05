export type SnapshotFreshness = 'fresh' | 'stale' | 'unknown';

/**
 * Classify a timestamped health snapshot without treating missing, malformed,
 * or future-dated timestamps as current telemetry.
 */
export function getSnapshotFreshness(
  timestamp: string | null | undefined,
  nowMs = Date.now(),
  staleAfterMs = 90_000,
): SnapshotFreshness {
  if (
    typeof timestamp !== 'string' ||
    timestamp.trim().length === 0 ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(staleAfterMs) ||
    staleAfterMs < 0
  ) {
    return 'unknown';
  }

  const reportedAt = Date.parse(timestamp);
  if (!Number.isFinite(reportedAt) || reportedAt > nowMs) return 'unknown';

  return nowMs - reportedAt > staleAfterMs ? 'stale' : 'fresh';
}
