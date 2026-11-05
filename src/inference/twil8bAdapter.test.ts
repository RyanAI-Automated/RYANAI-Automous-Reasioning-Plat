import { describe, expect, it, vi } from 'vitest';
import {
  createTwil8bEvaluationAdapter,
  resolveTwil8bEvaluationConfig,
  Twil8bEvaluationAdapter,
} from './twil8bAdapter.js';

const revision = 'a'.repeat(40);
const baseEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  RYANAI_ENV: 'test',
  RYANAI_TWIL8B_EVALUATION: 'enabled',
  RYANAI_TWIL8B_LICENSE_ACK: 'non-commercial-evaluation-only',
  TWIL8B_ENDPOINT: 'http://127.0.0.1:8080/v1',
  TWIL8B_RUNTIME_MODEL: 'twil8b-balanced',
  TWIL8B_MODEL_REVISION: revision,
  TWIL8B_VARIANT: 'balanced',
});

describe('TwIL-8B evaluation-only adapter', () => {
  it('requires explicit opt-in, licence acknowledgement, exact revision and variant', () => {
    const env = baseEnv();
    expect(resolveTwil8bEvaluationConfig(env).variant).toBe('balanced');
    expect(() => resolveTwil8bEvaluationConfig({ ...env, RYANAI_TWIL8B_EVALUATION: 'disabled' })).toThrow(/requires RYANAI_TWIL8B_EVALUATION/);
    expect(() => resolveTwil8bEvaluationConfig({ ...env, RYANAI_TWIL8B_LICENSE_ACK: '' })).toThrow(/licence acknowledgement/);
    expect(() => resolveTwil8bEvaluationConfig({ ...env, TWIL8B_MODEL_REVISION: 'main' })).toThrow(/exact/);
    expect(() => resolveTwil8bEvaluationConfig({ ...env, TWIL8B_VARIANT: 'auto' })).toThrow(/balanced or verbose/);
  });

  it('blocks production even when evaluation flags are set', () => {
    const env = baseEnv();
    env.NODE_ENV = 'production';
    expect(() => resolveTwil8bEvaluationConfig(env)).toThrow(/disabled in production/);
    env.NODE_ENV = 'test';
    env.RYANAI_ENV = 'production';
    expect(() => resolveTwil8bEvaluationConfig(env)).toThrow(/disabled in production/);
  });

  it('rejects remote endpoints, credentials in URLs and unsupported ports', () => {
    const env = baseEnv();
    for (const endpoint of [
      'https://api.example.com/v1',
      'http://127.0.0.1:8081/v1',
      'http://user:password@localhost:8080/v1',
      'http://localhost:8080/v1?forward=1',
    ]) {
      expect(() => resolveTwil8bEvaluationConfig({ ...env, TWIL8B_ENDPOINT: endpoint })).toThrow(/local/);
    }
  });

  it('bounds output token budgets', () => {
    const env = baseEnv();
    expect(() => resolveTwil8bEvaluationConfig({ ...env, TWIL8B_MAX_OUTPUT_TOKENS: '32769' })).toThrow(/between 1 and 32768/);
    expect(() => resolveTwil8bEvaluationConfig({ ...env, TWIL8B_MAX_OUTPUT_TOKENS: '1.5' })).toThrow(/integer/);
  });

  it('calls only the local OpenAI-compatible endpoint and returns revision provenance', async () => {
    const env = baseEnv();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '42' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const adapter = createTwil8bEvaluationAdapter(env, fetchMock as typeof fetch);
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
    const env = baseEnv();
    const ok = new Twil8bEvaluationAdapter(resolveTwil8bEvaluationConfig(env), vi.fn());
    await expect(ok.generate('  ')).rejects.toThrow(/must not be empty/);

    const failed = new Twil8bEvaluationAdapter(resolveTwil8bEvaluationConfig(env), vi.fn(async () =>
      new Response('unavailable', { status: 503 })));
    await expect(failed.generate('test')).rejects.toThrow(/HTTP 503/);

    const malformed = new Twil8bEvaluationAdapter(resolveTwil8bEvaluationConfig(env), vi.fn(async () =>
      new Response(JSON.stringify({ choices: [] }), { status: 200 })));
    await expect(malformed.generate('test')).rejects.toThrow(/did not contain a completion/);
  });

  it('supports the verbose variant only when explicitly selected', () => {
    const env = { ...baseEnv(), TWIL8B_VARIANT: 'verbose' };
    expect(resolveTwil8bEvaluationConfig(env).variant).toBe('verbose');
  });
});
