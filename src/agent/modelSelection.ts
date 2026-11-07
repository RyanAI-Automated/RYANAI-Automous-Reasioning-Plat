const OPENROUTER_MODEL_IDS = new Set([
  '~openai/gpt-latest',
  '~anthropic/claude-sonnet-latest',
]);

export interface SelectedReasoningModel {
  model: string;
  endpoint: string;
  apiKey: string;
}

/**
 * Resolve only the explicitly catalogued OpenRouter models.
 * The OpenRouter key is optional and is never read from client input.
 * Missing credentials fail before a durable task is queued or a network call is made.
 */
export function resolveSelectedReasoningModel(
  model: string | undefined,
  env: Record<string, string | undefined> = process.env,
): SelectedReasoningModel | null {
  if (!model || model === 'gpt-4o' || model === 'gpt-4o-mini') return null;
  if (!OPENROUTER_MODEL_IDS.has(model)) {
    throw new Error('Unsupported reasoning model selection.');
  }

  const apiKey = env.OPENROUTER_API_KEY?.trim() ?? '';
  if (!apiKey) {
    throw new Error('The selected model requires an existing OpenRouter credential. No provider request was made.');
  }

  const endpoint = (env.OPENROUTER_API_ENDPOINT || 'https://openrouter.ai/api/v1').trim();
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('Invalid OpenRouter API endpoint.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('The OpenRouter API endpoint must use HTTPS without embedded credentials or query strings.');
  }

  return { model, endpoint: endpoint.replace(/\/$/, ''), apiKey };
}
