import { describe, expect, it } from 'vitest';
import { resolveSelectedReasoningModel } from './modelSelection.js';

describe('optional ChatGPT and Claude model selection', () => {
  it('keeps existing GPT-4o models on the configured Logic provider', () => {
    expect(resolveSelectedReasoningModel('gpt-4o', {})).toBeNull();
    expect(resolveSelectedReasoningModel('gpt-4o-mini', {})).toBeNull();
  });

  it.each(['~openai/gpt-latest', '~anthropic/claude-sonnet-latest'])(
    'resolves the catalogued model through OpenRouter: %s',
    (model) => {
      expect(resolveSelectedReasoningModel(model, { OPENROUTER_API_KEY: 'test-only-key' })).toEqual({
        model,
        endpoint: ['https:', '', 'openrouter.ai', 'api', 'v1'].join('/'),
        apiKey: 'test-only-key',
      });
    },
  );

  it('fails closed when the existing OpenRouter credential is unavailable', () => {
    expect(() => resolveSelectedReasoningModel('~openai/gpt-latest', {})).toThrow(/requires an existing OpenRouter credential/);
  });

  it('rejects arbitrary model IDs rather than allowing client-selected provider routing', () => {
    expect(() => resolveSelectedReasoningModel('https://attacker.example/model', { OPENROUTER_API_KEY: 'test' })).toThrow(/Unsupported reasoning model/);
  });

  it('rejects insecure or credential-bearing gateway endpoints', () => {
    expect(() => resolveSelectedReasoningModel('~openai/gpt-latest', {
      OPENROUTER_API_KEY: 'test',
      OPENROUTER_API_ENDPOINT: ['http:', '', 'gateway.example.test', 'v1'].join('/'),
    })).toThrow(/must use HTTPS/);
    expect(() => resolveSelectedReasoningModel('~openai/gpt-latest', {
      OPENROUTER_API_KEY: 'test',
      OPENROUTER_API_ENDPOINT: ['https:', '', 'user:pass@gateway.example.test', 'v1'].join('/'),
    })).toThrow(/must use HTTPS/);
  });
});
