export const BRAIN_PROBE_CHALLENGE = 'RYANAI_BRAIN_READY';

/** A brain is healthy only when it completes the exact challenge response. */
export function assertBrainProbeResponse(output: string): void {
  if (output.trim() !== BRAIN_PROBE_CHALLENGE) {
    throw new Error('Provider connectivity probe returned an unexpected response.');
  }
}
