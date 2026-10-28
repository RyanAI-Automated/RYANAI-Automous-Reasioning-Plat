import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { analyzeWorkflow } from './analyze.js';

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  RYANAI_API_BASE_URL: process.env.RYANAI_API_BASE_URL,
  API_BASE_URL: process.env.API_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
};
let requests: Array<{ url: string; init?: RequestInit }>;
let defaultFetch: typeof fetch;

beforeEach(() => {
  requests = [];
  process.env.RYANAI_API_BASE_URL = 'https://ryanai-staging.example/';
  delete process.env.API_BASE_URL;
  process.env.OPENAI_MODEL = 'contract-test-model';
  defaultFetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({
      success: true,
      output: 'Staging contract response',
      reasoningTrace: ['request accepted', 'response validated'],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  globalThis.fetch = defaultFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('posts an authenticated-contract-compatible reasoning request to the RyanAI API', async () => {
  const result = await analyzeWorkflow({
    targetId: 'staging-target',
    payload: 'Check the Jarvis bridge health.',
    mode: 'diagnostic',
    metadata: { source: 'workflow-contract-test' },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://ryanai-staging.example/api/reason');
  assert.equal(requests[0].init?.method, 'POST');
  assert.equal(
    new Headers(requests[0].init?.headers).get('content-type'),
    'application/json',
  );
  const body = JSON.parse(String(requests[0].init?.body)) as {
    model: string;
    prompt: string;
  };
  assert.equal(body.model, 'contract-test-model');
  assert.match(body.prompt, /staging-target/);
  assert.match(body.prompt, /Check the Jarvis bridge health/);
  assert.match(body.prompt, /diagnosis, evidence, risks/);
  assert.deepEqual(result, {
    success: true,
    targetId: 'staging-target',
    timestamp: result.timestamp,
    model: 'contract-test-model',
    output: 'Staging contract response',
    reasoningTrace: ['request accepted', 'response validated'],
  });
  assert.ok(Number.isFinite(Date.parse(result.timestamp)));
});

test('rejects missing target input before making a network request', async () => {
  await assert.rejects(
    analyzeWorkflow({ targetId: ' ', payload: 'some work' }),
    /both targetId and payload are required/,
  );
  assert.equal(requests.length, 0);
});

test('surfaces an HTTP error response without treating it as a successful workflow', async () => {
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response('staging API unavailable', { status: 503 });
  };

  await assert.rejects(
    analyzeWorkflow({ targetId: 'staging-target', payload: 'health check' }),
    /RyanAI reasoning request failed \(503\): staging API unavailable/,
  );
  assert.equal(requests.length, 1);
});

test('rejects a response with an unsuccessful or empty result', async () => {
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ success: false, output: '' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  await assert.rejects(
    analyzeWorkflow({ targetId: 'staging-target', payload: 'health check' }),
    /invalid or unsuccessful response/,
  );
  assert.equal(requests.length, 1);
});
