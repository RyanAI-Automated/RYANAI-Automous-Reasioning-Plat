import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAgentReasoning } from './api';
import { apiClient } from './apiClient';

const { authenticatedFetch } = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
}));
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch }));
vi.mock('../lib/apiBaseUrl', () => ({
  API_BASE_URL: 'https://api.example.test',
}));

beforeEach(() => {
  authenticatedFetch.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unauthenticated fetch');
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('authenticated API service clients', () => {
  it('sends the prompt through authenticatedFetch and returns the JSON response', async () => {
    const result = { success: true, output: 'answer' };
    authenticatedFetch.mockResolvedValue(Response.json(result));
    await expect(executeAgentReasoning('hello')).resolves.toEqual(result);
    expect(authenticatedFetch).toHaveBeenCalledExactlyOnceWith(
      'https://api.example.test/api/reason',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' }),
      },
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['{"error":"Access denied"}', 'Access denied'],
    ['null', 'Reasoning execution failed with status: 403'],
    ['{}', 'Reasoning execution failed with status: 403'],
    ['<html>Forbidden</html>', 'Reasoning execution failed with status: 403'],
  ])('reports an HTTP error safely for response %s', async (body, message) => {
    authenticatedFetch.mockResolvedValue(new Response(body, { status: 403 }));
    await expect(executeAgentReasoning('hello')).rejects.toThrow(message);
  });

  it('preserves session and extra request fields in authenticated streaming requests', async () => {
    const payload = {
      prompt: 'hello',
      sessionId: 'session-1',
      model: 'fixture-model',
    };
    const chunk = { status: 'complete', result: 'answer' };
    authenticatedFetch.mockResolvedValue(
      new Response(`data: ${JSON.stringify(chunk)}\n\n`),
    );
    const onChunk = vi.fn();
    await apiClient.triggerReasoning(payload, onChunk);
    expect(authenticatedFetch).toHaveBeenCalledExactlyOnceWith(
      'https://api.example.test/api/reasoning',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    expect(onChunk).toHaveBeenCalledExactlyOnceWith(chunk);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates authentication failures from both clients without fetching or emitting chunks', async () => {
    const error = new Error('Please sign in to continue.');
    authenticatedFetch.mockRejectedValue(error);
    const onChunk = vi.fn();
    await expect(executeAgentReasoning('hello')).rejects.toBe(error);
    await expect(
      apiClient.triggerReasoning({ prompt: 'hello', sessionId: 's' }, onChunk),
    ).rejects.toBe(error);
    expect(onChunk).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
