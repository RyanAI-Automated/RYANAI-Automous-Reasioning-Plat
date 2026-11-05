/**
 * TwIL-8B evaluation-only adapter.
 *
 * This adapter is intentionally not imported by production orchestration.
 * It can only call an explicitly enabled, local OpenAI-compatible inference
 * server; it never downloads weights, reads provider credentials, persists
 * prompts, or falls back to another model.
 */
export type Twil8bVariant = 'balanced' | 'verbose';

export interface Twil8bEvaluationConfig {
  endpoint: string;
  runtimeModel: string;
  modelRevision: string;
  variant: Twil8bVariant;
  maxOutputTokens: number;
}

export interface Twil8bGeneration {
  text: string;
  model: string;
  modelRevision: string;
  variant: Twil8bVariant;
  finishReason: string | null;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);
const MAX_OUTPUT_TOKENS = 32768;
const LICENSE_ACK = 'non-commercial-evaluation-only';

function requireLocalEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TWIL8B_ENDPOINT must be a valid local HTTP inference URL.');
  }
  if (
    url.protocol !== 'http:'
    || !LOCAL_HOSTS.has(url.hostname.toLowerCase())
    || !['8080', '11434'].includes(url.port)
    || !['', '/', '/v1', '/v1/'].includes(url.pathname)
    || url.username || url.password || url.search || url.hash
  ) {
    throw new Error('TwIL-8B evaluation only permits approved local inference hosts on ports 8080 or 11434.');
  }
  return `${url.origin}/v1`;
}

export function resolveTwil8bEvaluationConfig(
  env: NodeJS.ProcessEnv = process.env,
): Twil8bEvaluationConfig {
  if (env.NODE_ENV === 'production' || env.RYANAI_ENV === 'production') {
    throw new Error('TwIL-8B evaluation adapter is disabled in production.');
  }
  if (env.RYANAI_TWIL8B_EVALUATION !== 'enabled') {
    throw new Error('TwIL-8B evaluation requires RYANAI_TWIL8B_EVALUATION=enabled.');
  }
  if (env.RYANAI_TWIL8B_LICENSE_ACK !== LICENSE_ACK) {
    throw new Error('TwIL-8B requires explicit non-commercial evaluation licence acknowledgement.');
  }

  const revision = env.TWIL8B_MODEL_REVISION?.trim() ?? '';
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64}|sha256:[a-f0-9]{64})$/i.test(revision)) {
    throw new Error('TWIL8B_MODEL_REVISION must pin an exact 40/64-character commit or SHA-256 revision.');
  }

  const variant = env.TWIL8B_VARIANT;
  if (variant !== 'balanced' && variant !== 'verbose') {
    throw new Error('TWIL8B_VARIANT must be explicitly set to balanced or verbose.');
  }

  const endpoint = requireLocalEndpoint(env.TWIL8B_ENDPOINT ?? '');
  const runtimeModel = env.TWIL8B_RUNTIME_MODEL?.trim();
  if (!runtimeModel) {
    throw new Error('TWIL8B_RUNTIME_MODEL must identify the locally loaded model alias.');
  }

  const requestedTokens = Number(env.TWIL8B_MAX_OUTPUT_TOKENS ?? '8192');
  if (!Number.isInteger(requestedTokens) || requestedTokens < 1 || requestedTokens > MAX_OUTPUT_TOKENS) {
    throw new Error(`TWIL8B_MAX_OUTPUT_TOKENS must be an integer between 1 and ${MAX_OUTPUT_TOKENS}.`);
  }

  return { endpoint, runtimeModel, modelRevision: revision, variant, maxOutputTokens: requestedTokens };
}

class Twil8bEvaluationAdapter {
  constructor(
    private readonly config: Twil8bEvaluationConfig,
    private readonly fetchImpl: FetchLike,
  ) {}

  async generate(prompt: string): Promise<Twil8bGeneration> {
    if (process.env.NODE_ENV === 'production' || process.env.RYANAI_ENV === 'production') {
      throw new Error('TwIL-8B evaluation adapter is disabled in production.');
    }
    if (!prompt.trim()) throw new Error('TwIL-8B evaluation prompt must not be empty.');
    const response = await this.fetchImpl(`${this.config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: this.config.runtimeModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: this.config.maxOutputTokens,
        stream: false,
      }),
    });
    if (!response.ok) {
      throw new Error(`Local TwIL-8B inference request failed with HTTP ${response.status}.`);
    }

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') {
      throw new Error('Local TwIL-8B inference returned an invalid response.');
    }
    const choices = (payload as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') {
      throw new Error('Local TwIL-8B inference response did not contain a completion.');
    }
    const choice = choices[0] as { message?: { content?: unknown }; finish_reason?: unknown };
    const content = choice.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Local TwIL-8B inference returned empty content.');
    }

    return {
      text: content,
      model: this.config.runtimeModel,
      modelRevision: this.config.modelRevision,
      variant: this.config.variant,
      finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    };
  }
}

/** Factory is the only construction path; production routing has no import of this module. */
export function createTwil8bEvaluationAdapter(
  fetchImpl: FetchLike = fetch,
): { generate(prompt: string): Promise<Twil8bGeneration> } {
  return new Twil8bEvaluationAdapter(resolveTwil8bEvaluationConfig(), fetchImpl);
}
