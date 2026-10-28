export interface AnalyzeWorkflowInput {
  targetId: string;
  payload: string;
  mode?: 'deep' | 'fast' | 'diagnostic';
  metadata?: Record<string, unknown>;
}

export interface AnalyzeWorkflowResult {
  success: true;
  targetId: string;
  timestamp: string;
  model: string;
  output: string;
  reasoningTrace: string[];
}

interface ReasoningResponse {
  success?: boolean;
  output?: string;
  reasoningTrace?: string[];
  engine?: string;
}

const modeInstructions: Record<NonNullable<AnalyzeWorkflowInput['mode']>, string> = {
  deep: 'Analyze carefully and explain the reasoning and relevant uncertainties.',
  fast: 'Analyze efficiently and provide a concise, useful response.',
  diagnostic: 'Focus on diagnosis, evidence, risks, and actionable next steps.',
};

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_ERROR_DETAIL_LENGTH = 500;

export async function analyzeWorkflow(
  input: AnalyzeWorkflowInput,
): Promise<AnalyzeWorkflowResult> {
  if (
    !input ||
    typeof input.targetId !== 'string' ||
    !input.targetId.trim() ||
    typeof input.payload !== 'string' ||
    !input.payload.trim()
  ) {
    throw new Error('Invalid analysis input: both targetId and payload are required.');
  }

  const mode = input.mode ?? 'fast';
  if (!Object.hasOwn(modeInstructions, mode)) {
    throw new Error(`Unsupported analysis mode: ${String(mode)}`);
  }

  const apiBase = (
    process.env.RYANAI_API_BASE_URL ||
    process.env.API_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const configuredTimeout = Number(process.env.RYANAI_WORKFLOW_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 1_000
    ? Math.min(configuredTimeout, 300_000)
    : DEFAULT_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/reason`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        prompt: [
          modeInstructions[mode],
          `Target: ${input.targetId.trim()}`,
          input.payload.trim(),
        ].join('\n\n'),
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`RyanAI reasoning request timed out after ${timeoutMs}ms.`, { cause: error });
    }
    throw error;
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, MAX_ERROR_DETAIL_LENGTH);
    throw new Error(`RyanAI reasoning request failed (${response.status}): ${detail}`);
  }

  let result: ReasoningResponse;
  try {
    result = await response.json() as ReasoningResponse;
  } catch {
    throw new Error('RyanAI reasoning API returned invalid JSON.');
  }

  if (result.success !== true || typeof result.output !== 'string' || !result.output.trim()) {
    throw new Error('RyanAI reasoning API returned an invalid or unsuccessful response.');
  }

  return {
    success: true,
    targetId: input.targetId.trim(),
    timestamp: new Date().toISOString(),
    model: typeof result.engine === 'string' && result.engine.trim() ? result.engine : model,
    output: result.output,
    reasoningTrace: Array.isArray(result.reasoningTrace)
      ? result.reasoningTrace.filter((item): item is string => typeof item === 'string')
      : [],
  };
}
