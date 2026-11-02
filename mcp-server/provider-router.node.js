import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBrain, routeReasoning } from './provider-router.js';

const env = {
  DEEPSEEK_API_ENDPOINT: 'http://127.0.0.1:8888/v1',
  DEEPSEEK_MODEL: 'DeepSeek-V4.1-Flash-1017',
};

function providerResponse(message, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('DeepSeek defaults to the local OpenAI-compatible endpoint and pinned API model id', () => {
  assert.deepEqual(resolveBrain('deepseek', {}), {
    id: 'DeepSeek-V4.1-Flash-1017',
    endpoint: 'http://127.0.0.1:8888/v1',
    key: '',
  });
});

test('JSON response mode is requested and the exact JSON content remains content', async () => {
  let request;
  const result = await routeReasoning('Return a JSON object.', 'deepseek', {
    env,
    responseFormat: 'json_object',
    fetch: async (url, init) => {
      request = { url: String(url), init, body: JSON.parse(init.body) };
      return providerResponse({ role: 'assistant', content: '{"ok":true,"count":2}' });
    },
  });

  assert.equal(request.url, 'http://127.0.0.1:8888/v1/chat/completions');
  assert.deepEqual(request.body.response_format, { type: 'json_object' });
  assert.equal(result.response, '{"ok":true,"count":2}');
  assert.equal(result.responseFormat, 'json_object');
});

test('invalid JSON is rejected when structured JSON output is requested', async () => {
  await assert.rejects(
    routeReasoning('Return JSON.', 'deepseek', {
      env,
      responseFormat: 'json_object',
      fetch: async () => providerResponse({ role: 'assistant', content: 'not json' }),
    }),
    /did not return valid JSON/,
  );
});

test('unauthenticated remote DeepSeek endpoints fail closed', async () => {
  await assert.rejects(
    routeReasoning('Hello', 'deepseek', {
      env: { DEEPSEEK_API_ENDPOINT: 'https://dgx.example.internal:8888/v1' },
      fetch: async () => { throw new Error('fetch must not be called'); },
    }),
    /unauthenticated requests are allowed only to a loopback endpoint/,
  );
});

test('remote DeepSeek endpoints use the configured bearer key', async () => {
  let authorization;
  await routeReasoning('Hello', 'deepseek', {
    env: {
      DEEPSEEK_API_ENDPOINT: 'https://dgx.example.internal:8888/v1',
      DEEPSEEK_API_KEY: 'test-only-key',
    },
    fetch: async (_url, init) => {
      authorization = init.headers.authorization;
      return providerResponse({ role: 'assistant', content: 'ready' });
    },
  });
  assert.equal(authorization, 'Bearer test-only-key');
});

test('tool calls without text are reported explicitly, never guessed into a reply', async () => {
  await assert.rejects(
    routeReasoning('Use tools if required.', 'deepseek', {
      env,
      fetch: async () => providerResponse({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'x', arguments: '{}' } }],
      }),
    }),
    /does not execute provider tool calls/,
  );
});

test('provider HTTP failures remain scoped to the current request', async () => {
  await assert.rejects(
    routeReasoning('first', 'deepseek', {
      env,
      fetch: async () => new Response('unauthorized', { status: 401 }),
    }),
    /HTTP 401/,
  );
  const result = await routeReasoning('second', 'deepseek', {
    env,
    fetch: async () => providerResponse({ role: 'assistant', content: 'second request succeeded' }),
  });
  assert.equal(result.response, 'second request succeeded');
});

test('provider endpoints reject embedded credentials and query parameters', async () => {
  for (const endpoint of [
    'http://user:pass@127.0.0.1:8888/v1',
    'http://127.0.0.1:8888/v1?token=secret',
  ]) {
    await assert.rejects(
      routeReasoning('Hello', 'deepseek', {
        env: { DEEPSEEK_API_ENDPOINT: endpoint },
        fetch: async () => { throw new Error('fetch must not be called'); },
      }),
      /clean HTTP or HTTPS URL/,
    );
  }
});

test('remote provider endpoints require HTTPS even when a key is configured', async () => {
  await assert.rejects(
    routeReasoning('Hello', 'deepseek', {
      env: {
        DEEPSEEK_API_ENDPOINT: 'http://dgx.example.internal:8888/v1',
        DEEPSEEK_API_KEY: 'test-only-key',
      },
      fetch: async () => { throw new Error('fetch must not be called'); },
    }),
    /must use HTTPS/,
  );
});
