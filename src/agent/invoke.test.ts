import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  buildMemoryContext: vi.fn(),
}));

vi.mock('./engine.js', () => ({
  getReasoningAgent: () => ({ invoke: state.invoke }),
}));
vi.mock('./memoryContext.js', () => ({
  MEMORY_CONTEXT_PREFIX: 'Saved notes about the user',
  buildMemoryContext: state.buildMemoryContext,
}));

import { invokeReasoningAgent } from './invoke.js';

beforeEach(() => vi.clearAllMocks());

describe('invokeReasoningAgent', () => {
  it('sends only the prompt when there are no saved notes', async () => {
    state.buildMemoryContext.mockResolvedValue(null);
    const result = { messages: [{ content: 'hi' }, { content: 'answer' }] };
    state.invoke.mockResolvedValue(result);

    const returned = await invokeReasoningAgent({ prompt: 'hello', user: null });

    expect(state.buildMemoryContext).toHaveBeenCalledWith(undefined);
    expect(state.invoke).toHaveBeenCalledWith(
      { messages: [{ role: 'user', content: 'hello' }] },
      { configurable: { userId: undefined, role: undefined } },
    );
    expect(returned).toBe(result);
  });

  it('adds the saved notes first, passes the user to the tools, and removes the notes from the result', async () => {
    state.buildMemoryContext.mockResolvedValue('Saved notes about the user. data\n- [a] b: c\n');
    state.invoke.mockResolvedValue({
      messages: [
        { content: 'Saved notes about the user. data\n- [a] b: c\n' },
        { content: 'hello' },
        { content: 'answer' },
      ],
    });

    const returned = await invokeReasoningAgent({
      prompt: 'hello',
      user: { id: 'user-1', role: 'admin' },
    });

    expect(state.buildMemoryContext).toHaveBeenCalledWith('user-1');
    expect(state.invoke).toHaveBeenCalledWith(
      {
        messages: [
          { role: 'system', content: 'Saved notes about the user. data\n- [a] b: c\n' },
          { role: 'user', content: 'hello' },
        ],
      },
      { configurable: { userId: 'user-1', role: 'admin' } },
    );
    expect(returned.messages).toEqual([{ content: 'hello' }, { content: 'answer' }]);
  });
});
