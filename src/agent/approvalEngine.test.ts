import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConnectionUrls } from '../server/startupConfig.js';

const state = vi.hoisted(() => {
  const setup = vi.fn();
  const getTuple = vi.fn(async () => undefined);
  const saver = { setup, getTuple };
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
vi.mock('./tools/whatsappTool.js', () => ({ sendWhatsAppTool: {} }));

afterEach(() => vi.restoreAllMocks());

describe('agent checkpointer initialization', () => {
  it('constructs the saver without running schema DDL during module initialization', async () => {
    const { checkpointer, humanInTheLoopAgent, verifyCheckpointerConnection } = await import('./approvalEngine.js');

    expect(state.fromConnString).toHaveBeenCalledOnce();
    // The API pool and LangGraph saver must resolve the same configured URL.
    expect(state.fromConnString).toHaveBeenCalledWith(
      resolveConnectionUrls(
        process.env.NODE_ENV ?? 'test',
        process.env.DATABASE_URL,
      ).databaseUrl,
    );
    expect(checkpointer).toBe(state.saver);
    expect(state.setup).not.toHaveBeenCalled();
    await expect(verifyCheckpointerConnection()).resolves.toBeUndefined();
    expect(state.getTuple).toHaveBeenCalledWith({
      configurable: { thread_id: 'ryanai-startup-readiness-probe' },
    });
    expect(state.createReactAgent).toHaveBeenCalledWith(
      expect.objectContaining({ checkpointSaver: state.saver }),
    );
    expect(humanInTheLoopAgent).toBeDefined();
  });
});


describe('LangGraph checkpointer connection probe', () => {
  it('returns a sanitised failure when the saver cannot query PostgreSQL', async () => {
    state.getTuple.mockRejectedValueOnce(
      new Error('connection failed: postgresql://user:secret@db.example/app'),
    );
    const { verifyCheckpointerConnection } = await import('./approvalEngine.js');

    await expect(verifyCheckpointerConnection()).rejects.toThrow(
      'LangGraph checkpointer connection probe failed.',
    );
  });
});
