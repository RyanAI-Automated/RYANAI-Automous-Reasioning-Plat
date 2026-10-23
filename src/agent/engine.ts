import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import { commsTools } from './tools/commsTools.js';
import { AUTONOMOUS_REASONING_SKILL } from '../skills/index.js';
import modelCatalog from '../../models/catalog.json' with { type: 'json' };
import { RYANAI_CORE } from '../config/core.js';

if (!RYANAI_CORE.activeSkills.includes('autonomous-reasoning')) {
  throw new Error(
    'The active autonomous reasoning skill is missing from src/config/core.ts.',
  );
}

const catalogModels = modelCatalog.models.map((model) => model.id);
const defaultModel = process.env.OPENAI_MODEL || modelCatalog.defaultModel;
const allowedModels = new Set(
  (process.env.OPENAI_ALLOWED_MODELS || catalogModels.join(','))
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean),
);
allowedModels.add(defaultModel);
const reasoningAgents = new Map<string, ReturnType<typeof createReactAgent>>();

// Local-first resolution: accept OPENAI_API_KEY, LOCAL_LLM_KEY, or fall back for local inference
const activeApiKey = process.env.OPENAI_API_KEY || process.env.LOCAL_LLM_KEY || 'local-fallback';
const hasBaseUrl = Boolean(process.env.OPENAI_BASE_URL);

if (!process.env.OPENAI_API_KEY && !process.env.LOCAL_LLM_KEY && !hasBaseUrl) {
  throw new Error(
    'OpenAI API access or local LLM base URL is not configured. Set OPENAI_API_KEY, LOCAL_LLM_KEY, or OPENAI_BASE_URL in .env and restart the API.'
  );
}

/**
 * Return the cached reasoning agent for a trimmed, enabled model name.
 * Creates and caches an agent on first use. Rejects disabled models and propagates
 * model or agent construction errors.
 */
export function getReasoningAgent(requestedModel = defaultModel) {
  const model = requestedModel.trim();
  if (!allowedModels.has(model)) {
    throw new Error(
      `Model "${model}" is not enabled. Allowed models: ${[...allowedModels].join(', ')}`,
    );
  }

  const configuredApiKey = process.env.OPENAI_API_KEY?.trim() || process.env.LOCAL_LLM_KEY?.trim() || 'local-fallback';
  const hasPlaceholderKey = /your_|placeholder|example|actual|here|\[REDACTED\]/i.test(
    configuredApiKey,
  );

  // Allow placeholder or fallback keys if a local base URL or local key is active
  if ((!configuredApiKey || hasPlaceholderKey) && !hasBaseUrl && !process.env.LOCAL_LLM_KEY) {
    throw new Error(
      'OpenAI API access is not configured. Set a valid OPENAI_API_KEY in .env before sending a reasoning request.',
    );
  }

  let reasoningAgent = reasoningAgents.get(model);
  if (!reasoningAgent) {
    const llm = new ChatOpenAI({
      modelName: model,
      temperature: 0,
      configuration: {
        ...(process.env.OPENAI_BASE_URL
          ? { baseURL: process.env.OPENAI_BASE_URL }
          : {}),
        apiKey: configuredApiKey,
      },
    });

    reasoningAgent = createReactAgent({
      llm,
      tools: commsTools,
      stateModifier: AUTONOMOUS_REASONING_SKILL.systemPrompt,
    });
    reasoningAgents.set(model, reasoningAgent);
  }

  return reasoningAgent;
}