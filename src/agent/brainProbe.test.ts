import { describe, expect, it } from 'vitest';
import { assertBrainProbeResponse, BRAIN_PROBE_CHALLENGE } from './brainProbe.js';

describe('brain connectivity probe response', () => {
  it('accepts only the exact challenge response', () => {
    expect(() => assertBrainProbeResponse(BRAIN_PROBE_CHALLENGE)).not.toThrow();
    expect(() => assertBrainProbeResponse('  ' + BRAIN_PROBE_CHALLENGE + '\n')).not.toThrow();
  });

  it('rejects empty, unrelated, or embellished responses', () => {
    for (const output of ['', 'OK', 'RYANAI_BRAIN_READY and more', 'I am ready']) {
      expect(() => assertBrainProbeResponse(output)).toThrow(
        'Provider connectivity probe returned an unexpected response.',
      );
    }
  });
});
