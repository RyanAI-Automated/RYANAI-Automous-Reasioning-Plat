import { beforeEach, describe, expect, it, vi } from 'vitest';

const verification = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../utils/verifyPatch.js', () => ({
  runVerificationPipeline: verification.run,
}));

import { RyanAISandbox } from './sandbox.js';

beforeEach(() => vi.clearAllMocks());

describe('RyanAI isolated sandbox', () => {
  it('uses the digest-pinned verification pipeline and never executes on the host', async () => {
    verification.run.mockResolvedValue({ success: true });
    const result = await RyanAISandbox.executeInSandbox('console.log("safe");');
    expect(result.success).toBe(true);
    expect(verification.run).toHaveBeenCalledWith(process.cwd(), 'console.log("safe");');
  });

  it('returns a safe failure when the verifier rejects a candidate', async () => {
    verification.run.mockResolvedValue({ success: false, error: 'Verifier image unavailable.' });
    const result = await RyanAISandbox.executeInSandbox('throw new Error("no");');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Verifier image unavailable.');
  });

  it('rejects oversized scripts before invoking the verifier', async () => {
    const result = await RyanAISandbox.executeInSandbox('x'.repeat(200_001));
    expect(result.success).toBe(false);
    expect(verification.run).not.toHaveBeenCalled();
  });
});
