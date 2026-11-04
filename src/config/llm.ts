import { ChatOpenAI } from '@langchain/openai';
import modelCatalog from '../../models/catalog.json' with { type: 'json' };

/** Model used when a caller names none. OPENAI_MODEL overrides the catalog default. */
export const defaultModel = process.env.OPENAI_MODEL || modelCatalog.defaultModel;

const LOCAL_OLLAMA_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'ollama',
  'host.docker.internal',
]);

export interface LocalOllamaConfig {
  baseURL: string;
  model: string;
}

/**
 * Resolve an explicitly local Ollama endpoint. The strict host/port/path checks
 * prevent "local mode" from silently forwarding private prompts to a cloud URL.
 */
export function resolveLocalOllamaConfig(
  env: NodeJS.ProcessEnv = process.env,
): LocalOllamaConfig {
  const endpoint = env.OLLAMA_URL?.trim();
  if (!endpoint) {
    throw new Error('OLLAMA_URL is required when RYANAI_INFERENCE_MODE=local.');
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('OLLAMA_URL must be a valid local Ollama URL.');
  }

  if (
    url.protocol !== 'http:'
    || !LOCAL_OLLAMA_HOSTS.has(url.hostname.toLowerCase())
    || url.port !== '11434'
    || !['', '/', '/v1', '/v1/'].includes(url.pathname)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(
      'Local inference requires an HTTP Ollama endpoint on an approved local host at port 11434 (optionally ending in /v1).',
    );
  }

  const model = env.OLLAMA_MODEL?.trim();
  if (!model) {
    throw new Error('OLLAMA_MODEL is required when RYANAI_INFERENCE_MODE=local.');
  }

  return { baseURL: `${url.origin}/v1`, model };
}

/**
 * Build a chat model for the configured OpenAI-compatible endpoint.
 * Local mode is explicit and fail-closed; it never falls back to a cloud model.
 */
export function createChatModel(model?: string) {
  const inferenceMode = process.env.RYANAI_INFERENCE_MODE?.trim();
  if (inferenceMode && inferenceMode !== 'local' && inferenceMode !== 'cloud') {
    throw new Error('RYANAI_INFERENCE_MODE must be either "local" or "cloud".');
  }

  if (inferenceMode === 'local') {
    const local = resolveLocalOllamaConfig();
    return new ChatOpenAI({
      model: model ?? local.model,
      temperature: 0,
      // Ollama's OpenAI-compatible API requires a non-empty placeholder key.
      // This is not a secret and is never read from provider configuration.
      apiKey: 'ollama',
      configuration: { baseURL: local.baseURL },
    });
  }

  return new ChatOpenAI({
    model: model ?? defaultModel,
    temperature: 0,
    ...(process.env.OPENAI_API_KEY
      ? { apiKey: process.env.OPENAI_API_KEY }
      : {}),
    configuration: {
      ...(process.env.OPENAI_BASE_URL
        ? { baseURL: process.env.OPENAI_BASE_URL }
        : {}),
    },
  });
}
