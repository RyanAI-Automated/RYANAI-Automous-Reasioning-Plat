// File path: ./src/services/inference.ts

import { streamReasoning } from '@/lib/reasoning';

export async function dispatchInference(prompt: string): Promise<string> {
  let response = '';

  await streamReasoning(prompt, 'claude-sonnet-4.6', {
    onToken: (token: string): void => { 
      response += token; 
    },
    onStep: (): void => undefined,
    onTitle: (): void => undefined,
    onDone: (): void => undefined,
    onError: (message: string): never => { 
      throw new Error(message); 
    },
  });

  return response;
}