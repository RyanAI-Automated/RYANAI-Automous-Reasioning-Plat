import { authenticatedFetch } from '@/lib/authenticatedFetch';
// src/lib/reasoning.ts
// Autonomous reasoning engine integration

import type { ModelId, ReasoningCallbacks } from './types.js';
import { API_BASE_URL } from './apiBaseUrl';
import { API_ROUTES } from '@/config/core';

/**
 * Deliver reasoning progress and completed results through callbacks until the stream ends.
 * Malformed JSON data lines are forwarded verbatim (trimmed) to onToken. onDone runs
 * only after a completion result and end of stream. Request, stream, and callback
 * failures go to onError; an error thrown by onError itself propagates.
 */
export async function streamReasoning(
  prompt: string,
  model: ModelId,
  callbacks: ReasoningCallbacks,
): Promise<void> {
  try {
    const response = await authenticatedFetch(
      `${API_BASE_URL}${API_ROUTES.streamPath}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          model,
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      let message = response.statusText;
      try {
        const errorPayload = JSON.parse(errorBody) as { error?: string };
        message = errorPayload.error || message;
      } catch {
        if (errorBody) message = errorBody.slice(0, 300);
      }
      throw new Error(`API error (${response.status}): ${message}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(line.slice(6)) as Record<string, unknown>;
          } catch {
            if (line.trim()) {
              callbacks.onToken?.(line.trim());
            }
            continue;
          }

          if (typeof data.error === 'string') {
            throw new Error(data.error);
          }
          if (
            data.status === 'processing' &&
            typeof data.message === 'string'
          ) {
            callbacks.onStep?.({
              type: 'reasoning',
              name: 'process',
              result: data.message,
            });
          } else if (
            data.status === 'complete' &&
            typeof data.result === 'string'
          ) {
            callbacks.onToken?.(data.result);
            completed = true;
          }
        }
      }
    }

    if (!completed) {
      throw new Error('Reasoning stream ended before completion');
    }
    callbacks.onDone?.();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    callbacks.onError?.(message);
  }
}

/**
 * Return output (or the legacy response field) from an authenticated reasoning request.
 * Rejects unsuccessful or empty responses and propagates authentication, fetch, and
 * JSON parsing errors.
 */
export async function quickReason(
  prompt: string,
  model: ModelId,
): Promise<string> {
  const response = await authenticatedFetch(
    `${API_BASE_URL}${API_ROUTES.reasonPath}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model }),
    },
  );
  const data = (await response.json()) as {
    success?: boolean;
    output?: string;
    response?: string;
    error?: string;
  };
  if (!response.ok || !data.success) {
    throw new Error(
      data.error || `Reasoning request failed (HTTP ${response.status}).`,
    );
  }
  const output = data.output || data.response;
  if (!output) throw new Error('Reasoning API returned an empty response.');
  return output;
}
