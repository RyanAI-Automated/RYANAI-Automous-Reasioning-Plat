/** Maximum in-memory transcript retained by one live voice widget session. */
export const MAX_LIVE_TRANSCRIPT_CHARS = 12_000;

/** Append provider transcript fragments in delivery order without unbounded growth. */
export function appendLiveTranscript(
  current: string,
  delta: string,
  maxLength = MAX_LIVE_TRANSCRIPT_CHARS,
): string {
  if (!delta || maxLength <= 0) return maxLength <= 0 ? '' : current;
  const combined = current + delta;
  return combined.length > maxLength ? combined.slice(-maxLength) : combined;
}
