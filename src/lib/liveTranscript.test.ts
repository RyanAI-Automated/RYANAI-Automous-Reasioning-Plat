import { describe, expect, it } from 'vitest';
import { appendLiveTranscript, MAX_LIVE_TRANSCRIPT_CHARS } from './liveTranscript.js';

describe('live voice transcript accumulation', () => {
  it('appends input and output fragments in the exact order received', () => {
    expect(appendLiveTranscript('Good ', 'morning')).toBe('Good morning');
    expect(appendLiveTranscript('Ryan', 'AI')).toBe('RyanAI');
  });

  it('preserves the current transcript when an empty fragment arrives', () => {
    expect(appendLiveTranscript('Existing words', '')).toBe('Existing words');
  });

  it('retains only the newest characters once the session limit is reached', () => {
    const current = 'a'.repeat(MAX_LIVE_TRANSCRIPT_CHARS - 2);
    const expected = 'a'.repeat(MAX_LIVE_TRANSCRIPT_CHARS - 4) + 'bcde';
    expect(appendLiveTranscript(current, 'bcde')).toBe(expected);
    expect(appendLiveTranscript(current, 'bcde')).toHaveLength(MAX_LIVE_TRANSCRIPT_CHARS);
  });

  it('returns an empty transcript when the configured limit is zero', () => {
    expect(appendLiveTranscript('existing', 'new', 0)).toBe('');
  });
});
