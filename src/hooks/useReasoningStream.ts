import { authenticatedFetch } from '@/lib/authenticatedFetch';
// File path: ./src/hooks/useReasoningStream.ts

import { useState, useCallback } from 'react';
import { API_BASE_URL } from '../lib/apiBaseUrl';

export interface StreamEventData {
  status?: 'processing' | 'complete';
  message?: string;
  result?: string;
  error?: string;
}

/**
 * Expose authenticated reasoning streams and their activity state.
 * The stream action dispatches progress and completion callbacks and propagates errors.
 */
export function useRyanStream() {
  const [isStreaming, setIsStreaming] = useState<boolean>(false);

  const streamReasoning = useCallback(
    async (
      prompt: string,
      onStep: (step: string) => void,
      onToken: (token: string) => void,
      onComplete: () => void,
    ) => {
      setIsStreaming(true);
      try {
        const response = await authenticatedFetch(
          `${API_BASE_URL}/api/reasoning/stream`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
          },
        );

        if (!response.ok) {
          throw new Error(
            `Reasoning request failed with status ${response.status}`,
          );
        }
        if (!response.body) throw new Error('ReadableStream not supported.');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const rawData = line.substring(6).trim();
              if (!rawData) continue;
              try {
                const data = JSON.parse(rawData) as StreamEventData;
                if (data.status === 'processing' && data.message) {
                  onStep(data.message);
                } else if (data.status === 'complete' && data.result) {
                  onToken(data.result);
                  onComplete();
                } else if (data.error) {
                  throw new Error(data.error);
                }
              } catch (parseErr) {
                if (parseErr instanceof Error) throw parseErr;
                console.error('Failed to parse SSE line data:', parseErr);
              }
            }
          }
        }
      } finally {
        setIsStreaming(false);
      }
    },
    [],
  );

  return { streamReasoning, isStreaming };
}
