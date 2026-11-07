import { ChatOpenAI } from '@langchain/openai';
import { resolveBrainProviderConfig } from '../agent/providerConfig.js';
import type { BrainId } from '../agent/operationsCore.js';

function createBrain(brain: BrainId, temperature: number) {
  const config = resolveBrainProviderConfig(brain);
  if (!config.model.trim()) {
    throw new Error('The selected ' + config.adapter + ' adapter for the ' + config.role + ' brain requires a model ID.');
  }
  return new ChatOpenAI({
    model: config.model,
    temperature,
    // Ollama's OpenAI-compatible endpoint does not require a cloud credential.
    apiKey: config.adapter === 'ollama' ? 'ollama' : brain === 'primary' ? (process.env.NVIDIA_API_KEY || (config.endpoint === process.env.LM_STUDIO_URL ? process.env.LM_STUDIO_API_KEY : '') || '') : brain === 'secondary' ? (process.env.QWEN_API_KEY || (config.endpoint === process.env.LM_STUDIO_URL ? process.env.LM_STUDIO_API_KEY : '') || '') : (process.env.LOGIC_API_KEY || process.env.OPENAI_API_KEY || (config.endpoint === process.env.LM_STUDIO_URL ? process.env.LM_STUDIO_API_KEY : '') || ''),
    configuration: { baseURL: config.endpoint },
  });
}

/** Canonical NVIDIA reasoning role; Nemotron is a model implementation. */
export const primaryBrain = createBrain('primary', 0.2);

/** Canonical Qwen reasoning role; provider/model names remain adapter details. */
export const secondaryBrain = createBrain('secondary', 0.4);

/** Canonical Logic verification and synthesis role. */
export const logicBrain = createBrain('logic', 0.1);
