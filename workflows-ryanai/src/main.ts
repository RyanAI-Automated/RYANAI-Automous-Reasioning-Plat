import 'dotenv/config';
import { task, type TaskContext } from '@renderinc/sdk/workflows';
import OpenAI from 'openai';

const retry = {
  maxRetries: 3,
  waitDurationMs: 2_000,
  backoffScaling: 2,
};
const allowedModels = new Set(
  (process.env.OPENAI_ALLOWED_MODELS || process.env.OPENAI_MODEL || 'gpt-4o,gpt-4o-mini')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean),
);

interface ReasoningInput {
  prompt: string;
  model?: string;
}

function createOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY must be configured in the workflow environment.');
  }
  return new OpenAI({
    apiKey,
    ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
  });
}

export const analyzeRequest = task(
  { name: 'analyzeRequest', retry },
  async function analyzeRequest(_ctx: TaskContext, input: ReasoningInput) {
    if (!input || typeof input.prompt !== 'string' || !input.prompt.trim()) {
      throw new Error('A non-empty prompt is required.');
    }

    const model = input.model || process.env.OPENAI_MODEL || 'gpt-4o';
    if (!allowedModels.has(model)) {
      throw new Error(`Model "${model}" is not enabled for workflow reasoning.`);
    }
    const result = await createOpenAIClient().chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are RyanAI, an autonomous reasoning assistant. Be accurate, ' +
            'state uncertainty, distinguish evidence from assumptions, and never ' +
            'claim actions or tool results that did not occur.',
        },
        { role: 'user', content: input.prompt.trim() },
      ],
    });

    const output = result.choices[0]?.message.content;
    if (typeof output !== 'string' || !output.trim()) {
      throw new Error('The configured model returned no response content.');
    }

    return {
      success: true as const,
      model: result.model,
      output,
      usage: result.usage
        ? {
            inputTokens: result.usage.prompt_tokens,
            outputTokens: result.usage.completion_tokens,
            totalTokens: result.usage.total_tokens,
          }
        : null,
      completedAt: new Date().toISOString(),
    };
  },
);

export const analyzeConversation = task(
  { name: 'analyzeConversation', retry, timeoutSeconds: 300 },
  async function analyzeConversation(ctx: TaskContext, prompts: string[]) {
    if (!Array.isArray(prompts) || prompts.length === 0 || prompts.some((prompt) => !prompt.trim())) {
      throw new Error('Provide at least one non-empty prompt.');
    }

    const turns = [];
    for (const prompt of prompts) {
      turns.push(await ctx.run(analyzeRequest, { prompt }));
    }
    return { turns, totalTurns: turns.length };
  },
);
