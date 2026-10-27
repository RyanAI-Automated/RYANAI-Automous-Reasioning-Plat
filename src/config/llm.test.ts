import { afterEach, describe, expect, it, vi } from 'vitest';

const chatOpenAI = vi.hoisted(() => vi.fn());
vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    constructor(options: unknown) {
      chatOpenAI(options);
    }
  },
}));

import { createChatModel } from './llm.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('createChatModel', () => {
  it('uses the endpoint and key from the environment', () => {
    vi.stubEnv('OPENAI_BASE_URL', 'http://localhost:8000/v1');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    createChatModel('gpt-4o-mini');
    expect(chatOpenAI).toHaveBeenCalledWith({
      modelName: 'gpt-4o-mini',
      temperature: 0,
      configuration: { baseURL: 'http://localhost:8000/v1', apiKey: 'test-key' },
    });
  });

  it('sends no endpoint or key when the environment sets none', () => {
    vi.stubEnv('OPENAI_BASE_URL', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    createChatModel('gpt-4o');
    expect(chatOpenAI).toHaveBeenCalledWith({
      modelName: 'gpt-4o',
      temperature: 0,
      configuration: {},
    });
  });
});
