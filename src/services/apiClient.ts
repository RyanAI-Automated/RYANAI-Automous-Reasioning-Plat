import { authenticatedFetch } from '@/lib/authenticatedFetch';
// File path: ./src/services/apiClient.ts

import { API_BASE_URL } from '../lib/apiBaseUrl';

export interface ReasoningRequest {
  prompt: string;
  sessionId: string;
  [key: string]: unknown;
}

export interface ReasoningChunk {
  status?: string;
  message?: string;
  result?: string;
  error?: string;
  [key: string]: unknown;
}

export const apiClient = {
  /**
   * Deliver newline-delimited JSON or SSE data lines to onChunk until the stream ends.
   * Malformed JSON and synchronous onChunk errors are ignored. Authentication, HTTP,
   * missing-body, and stream-read failures reject; an unterminated final line is discarded.
   */
  async triggerReasoning(
    payload: ReasoningRequest,
    onChunk: (chunk: ReasoningChunk) => void,
  ): Promise<void> {
    const response = await authenticatedFetch(`${API_BASE_URL}/api/reasoning`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok || !response.body) {
      throw new Error(
        `Reasoning API failed with status ${response.status}: ${response.statusText}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let jsonStr = trimmed;
        if (trimmed.startsWith('data: ')) {
          jsonStr = trimmed.replace('data: ', '').trim();
        }

        if (!jsonStr) continue;

        try {
          const chunk = JSON.parse(jsonStr) as ReasoningChunk;
          onChunk(chunk);
        } catch {
          // Ignore malformed JSON stream chunks
        }
      }
    }
  },
};
