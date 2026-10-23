import { afterEach, describe, expect, it, vi } from 'vitest';

const { setup } = vi.hoisted(() => ({ setup: vi.fn() }));
vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
  PostgresSaver: { fromConnString: () => ({ setup }) },
}));
vi.mock('@langchain/openai', () => ({ ChatOpenAI: class {} }));
vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: () => ({}),
}));
vi.mock('./tools/commsTools.js', () => ({ commsTools: [] }));
vi.mock('./tools/whatsappTool.js', () => ({ sendWhatsAppTool: {} }));

afterEach(() => vi.restoreAllMocks());

describe('checkpointer startup failure logging', () => {
  it('omits raw database credentials while preserving the failure for the caller', async () => {
    const error = Object.assign(
      new Error('postgresql://user:private-password@db/fixture'),
      { code: '28P01' },
    );
    setup.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { initializeAgentDatabase } = await import('./approvalEngine.js');
    await expect(initializeAgentDatabase()).rejects.toBe(error);
    expect(log).toHaveBeenCalledWith(
      '[CRITICAL] Failed to initialize PostgresSaver checkpointer:',
      expect.stringContaining('28P01: Password authentication failed'),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-password');
  });
});
