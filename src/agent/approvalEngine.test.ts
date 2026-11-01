import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const agent = { kind: 'test-agent' };
  return { agent, createReactAgent: vi.fn(() => agent) };
});
vi.mock('@langchain/openai', () => ({ ChatOpenAI: class {} }));
vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: state.createReactAgent,
}));
vi.mock('./checkpointer.js', () => ({ checkpointer: { kind: 'pre-migrated-checkpointer' } }));
vi.mock('./tools/commsTools.js', () => ({ commsTools: [] }));
vi.mock('./tools/whatsappTool.js', () => ({ sendWhatsAppTool: {} }));

describe('agent checkpointer wiring', () => {
  it('attaches the pre-provisioned checkpointer without running schema setup at import time', async () => {
    const { humanInTheLoopAgent } = await import('./approvalEngine.js');
    expect(humanInTheLoopAgent).toBe(state.agent);
    expect(state.createReactAgent).toHaveBeenCalledOnce();
    expect(state.createReactAgent.mock.calls[0][0]).toMatchObject({
      checkpointSaver: { kind: 'pre-migrated-checkpointer' },
    });
  });
});
