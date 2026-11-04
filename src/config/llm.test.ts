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
      model: 'gpt-4o-mini',
      temperature: 0,
      apiKey: 'test-key',
      configuration: { baseURL: 'http://localhost:8000/v1' },
    });
  });

  it('sends no endpoint or key when the environment sets none', () => {
    vi.stubEnv('OPENAI_BASE_URL', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    createChatModel('gpt-4o');
    expect(chatOpenAI).toHaveBeenCalledWith({
      model: 'gpt-4o',
      temperature: 0,
      configuration: {},
    });
  });

  it('uses only the configured local Ollama endpoint in explicit local mode', () => {
    vi.stubEnv('RYANAI_INFERENCE_MODE', 'local');
    vi.stubEnv('OLLAMA_URL', 'http://ollama:11434/v1');
    vi.stubEnv('OLLAMA_MODEL', 'qwen2.5:7b');
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.example.com/v1');
    vi.stubEnv('OPENAI_API_KEY', 'must-not-be-used');

    createChatModel();

    expect(chatOpenAI).toHaveBeenCalledWith({
      model: 'qwen2.5:7b',
      temperature: 0,
      apiKey: 'ollama',
      configuration: { baseURL: 'http://ollama:11434/v1' },
    });
  });

  it('allows a caller-selected model while retaining the local endpoint', () => {
    vi.stubEnv('RYANAI_INFERENCE_MODE', 'local');
    vi.stubEnv('OLLAMA_URL', 'http://127.0.0.1:11434');
    vi.stubEnv('OLLAMA_MODEL', 'qwen2.5:7b');

    createChatModel('llama3.2:3b');

    expect(chatOpenAI).toHaveBeenCalledWith({
      model: 'llama3.2:3b',
      temperature: 0,
      apiKey: 'ollama',
      configuration: { baseURL: 'http://127.0.0.1:11434/v1' },
    });
  });

  it('fails closed instead of sending local-mode prompts to a remote endpoint', () => {
    vi.stubEnv('RYANAI_INFERENCE_MODE', 'local');
    vi.stubEnv('OLLAMA_URL', 'https://api.example.com/v1');
    vi.stubEnv('OLLAMA_MODEL', 'qwen2.5:7b');

    expect(() => createChatModel()).toThrow(/approved local host/);
    expect(chatOpenAI).not.toHaveBeenCalled();
  });

  it('requires an explicitly selected local model', () => {
    vi.stubEnv('RYANAI_INFERENCE_MODE', 'local');
    vi.stubEnv('OLLAMA_URL', 'http://localhost:11434/v1');
    vi.stubEnv('OLLAMA_MODEL', '');

    expect(() => createChatModel()).toThrow('OLLAMA_MODEL is required');
    expect(chatOpenAI).not.toHaveBeenCalled();
  });

  it('rejects unsupported inference modes', () => {
    vi.stubEnv('RYANAI_INFERENCE_MODE', 'automatic');

    expect(() => createChatModel()).toThrow('RYANAI_INFERENCE_MODE must be either');
    expect(chatOpenAI).not.toHaveBeenCalled();
  });
});
