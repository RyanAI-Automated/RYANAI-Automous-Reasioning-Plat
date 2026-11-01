import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  setup: vi.fn(),
  compile: vi.fn(),
  app: {},
}));

vi.mock('pg', () => ({ Pool: class {} }));
vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
  PostgresSaver: class {
    setup = state.setup;
  },
}));
vi.mock('@langchain/langgraph', () => ({
  END: 'END',
  MessagesAnnotation: { State: {} },
  StateGraph: class {
    addNode() { return this; }
    addEdge() { return this; }
    compile(options: unknown) {
      state.compile(options);
      return state.app;
    }
  },
}));
vi.mock('../native/bridge.js', () => ({ runCppInference: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe('legacy ReAct graph schema lifecycle', () => {
  it('reuses the migrated checkpointer without running DDL during graph creation', async () => {
    const { createRyanAgentGraph } = await import('./reactWorkflow.js');
    await expect(createRyanAgentGraph()).resolves.toBe(state.app);
    expect(state.setup).not.toHaveBeenCalled();
    expect(state.compile).toHaveBeenCalledWith(
      expect.objectContaining({ checkpointer: expect.anything() }),
    );
  });
});
