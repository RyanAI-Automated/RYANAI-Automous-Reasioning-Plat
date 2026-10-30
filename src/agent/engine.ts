import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { gatedCommsTools } from './tools/gatedCommsTools.js';
import { memoryTools } from './tools/memoryTools.js';
import { scheduleTools } from './tools/scheduleTools.js';
import { listWorkspaceFilesTool, readWorkspaceFileTool } from './tools/workspaceTools.js';
import { AUTONOMOUS_REASONING_SKILL } from '../skills/index.js';
import modelCatalog from '../../models/catalog.json' with { type: 'json' };
import { RYANAI_CORE } from '../config/core.js';
import { createChatModel, defaultModel } from '../config/llm.js';

if (!RYANAI_CORE.activeSkills.includes('autonomous-reasoning')) {
  throw new Error(
    'The active autonomous reasoning skill is missing from src/config/core.ts.',
  );
}

const catalogModels = modelCatalog.models.map((model) => model.id);
const allowedModels = new Set(
  (process.env.OPENAI_ALLOWED_MODELS || catalogModels.join(','))
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean),
);
allowedModels.add(defaultModel);
const reasoningAgents = new Map<string, ReturnType<typeof createReactAgent>>();

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

  let reasoningAgent = reasoningAgents.get(model);
  if (!reasoningAgent) {
    reasoningAgent = createReactAgent({
      llm: createChatModel(model),
      tools: [...gatedCommsTools, ...memoryTools, ...scheduleTools, listWorkspaceFilesTool, readWorkspaceFileTool],
      stateModifier: AUTONOMOUS_REASONING_SKILL.systemPrompt,
    });
    reasoningAgents.set(model, reasoningAgent);
  }

  return reasoningAgent;
}