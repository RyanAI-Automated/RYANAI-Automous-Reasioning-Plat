import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const setup = vi.fn();
  const saver = { setup };
  const fromConnString = vi.fn(() => saver);
  const createReactAgent = vi.fn(() => ({}));
  return { setup, saver, fromConnString, createReactAgent };
});

vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
  PostgresSaver: { fromConnString: state.fromConnString },
}));
vi.mock('@langchain/openai', () => ({ ChatOpenAI: class {} }));
vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: state.createReactAgent,
}));
vi.mock('./tools/commsTools.js', () => ({ commsTools: [] }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('agent checkpointer initialization', () => {
  it('constructs the saver from DATABASE_URL without running schema DDL', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@127.0.0.1:5432/ryanai_test');
    const { checkpointer, humanInTheLoopAgent } = await import('./approvalEngine.js');

    expect(state.fromConnString).toHaveBeenCalledExactlyOnceWith(
      'postgresql://test:test@127.0.0.1:5432/ryanai_test',
    );
    expect(checkpointer).toBe(state.saver);
    expect(state.setup).not.toHaveBeenCalled();
    expect(state.createReactAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointSaver: state.saver,
        tools: [],
        interruptBefore: ['tools'],
      }),
    );
    expect(humanInTheLoopAgent).toBeDefined();
  });

  it('refuses to initialize without PostgreSQL configuration', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', '');
    await expect(import('./approvalEngine.js')).rejects.toThrow(
      'DATABASE_URL is required for persistent RyanAI agent memory',
    );
  });
});
