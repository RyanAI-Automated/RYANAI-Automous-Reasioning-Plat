import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTwil8bEvaluationAdapter,
  resolveTwil8bEvaluationConfig,
} from './twil8bAdapter.js';

const revision = 'a'.repeat(40);

function enableEvaluation(variant: 'balanced' | 'verbose' = 'balanced') {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('RYANAI_ENV', 'test');
  vi.stubEnv('RYANAI_TWIL8B_EVALUATION', 'enabled');
  vi.stubEnv('RYANAI_TWIL8B_LICENSE_ACK', 'non-commercial-evaluation-only');
  vi.stubEnv('TWIL8B_ENDPOINT', 'http://127.0.0.1:8080/v1');
  vi.stubEnv('TWIL8B_RUNTIME_MODEL', `twil8b-${variant}`);
  vi.stubEnv('TWIL8B_MODEL_REVISION', revision);
  vi.stubEnv('TWIL8B_VARIANT', variant);
  vi.stubEnv('TWIL8B_MAX_OUTPUT_TOKENS', '8192');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('TwIL-8B evaluation-only adapter', () => {
  it('requires explicit opt-in, licence acknowledgement, exact revision and variant', () => {
    enableEvaluation();
    expect(resolveTwil8bEvaluationConfig().variant).toBe('balanced');
    vi.stubEnv('RYANAI_TWIL8B_EVALUATION', 'disabled');
    expect(() => resolveTwil8bEvaluationConfig()).toThrow(/requires RYANAI_TWIL8B_EVALUATION/);
    vi.stubEnv('RYANAI_TWIL8B_EVALUATION', 'enabled');
    vi.stubEnv('RYANAI_TWIL8B_LICENSE_ACK', '');
    expect(() => resolveTwil8bEvaluationConfig()).toThrow(/licence acknowledgement/);
    vi.stubEnv('RYANAI_TWIL8B_LICENSE_ACK', 'non-commercial-evaluation-only');
    vi.stubEnv('TWIL8B_MODEL_REVISION', 'main');
    expect(() => resolveTwil8bEvaluationConfig()).toThrow(/exact/);
    vi.stubEnv('TWIL8B_MODEL_REVISION', revision);
    vi.stubEnv('TWIL8B_VARIANT', 'auto');
    expect(() => resolveTwil8bEvaluationConfig()).toThrow(/balanced or verbose/);
  });

  it('blocks production even when evaluation flags are set', () => {
    enableEvaluation();
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => resolveTwil8bEvaluationConfig()).toThrow(/disabled in production/);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RYANAI_ENV', 'production');
    expect(() => resolveTwil8bEvaluationConfig()).toThrow(/disabled in production/);
  });

  it('rejects remote endpoints, credentials in URLs and unsupported ports', () => {
    enableEvaluation();
    for (const endpoint of [
      'https://api.example.com/v1',
      'http://127.0.0.1:8081/v1',
      'http://user:password@localhost:8080/v1',
      'http://localhost:8080/v1?forward=1',
    ]) {
      vi.stubEnv('TWIL8B_ENDPOINT', endpoint);
      expect(() => resolveTwil8bEvaluationConfig()).toThrow(/local/);
    }
  });

  it('bounds output token budgets', () => {
    enableEvaluation();
    vi.stubEnv('TWIL8B_MAX_OUTPUT_TOKENS', '32769');
    expect(() => resolveTwil8bEvaluationConfig()).toThrow(/between 1 and 32768/);
    vi.stubEnv('TWIL8B_MAX_OUTPUT_TOKENS', '1.5');
    expect(() => resolveTwil8bEvaluationConfig()).toThrow(/integer/);
  });

  it('calls only the local OpenAI-compatible endpoint and returns revision provenance', async () => {
    enableEvaluation();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '42' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const adapter = createTwil8bEvaluationAdapter(fetchMock as typeof fetch);
    const result = await adapter.generate('What is 6 times 7?');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8080/v1/chat/completions');
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: 'twil8b-balanced',
      temperature: 0,
      max_tokens: 8192,
      stream: false,
    });
    expect(result).toMatchObject({ text: '42', modelRevision: revision, variant: 'balanced' });
  });

  it('does not send empty prompts and fails closed on provider errors or malformed responses', async () => {
    enableEvaluation();
    const ok = createTwil8bEvaluationAdapter(vi.fn());
    await expect(ok.generate('  ')).rejects.toThrow(/must not be empty/);

    const failed = createTwil8bEvaluationAdapter(vi.fn(async () =>
      new Response('unavailable', { status: 503 })));
    await expect(failed.generate('test')).rejects.toThrow(/HTTP 503/);

    const malformed = createTwil8bEvaluationAdapter(vi.fn(async () =>
      new Response(JSON.stringify({ choices: [] }), { status: 200 })));
    await expect(malformed.generate('test')).rejects.toThrow(/did not contain a completion/);
  });

  it('supports the verbose variant only when explicitly selected', () => {
    enableEvaluation('verbose');
    expect(resolveTwil8bEvaluationConfig().variant).toBe('verbose');
  });
});
