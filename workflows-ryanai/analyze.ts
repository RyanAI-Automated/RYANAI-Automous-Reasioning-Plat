export interface AnalyzeInput {
  targetId: string;
  payload: string;
  mode?: 'deep' | 'fast' | 'diagnostic';
}

export interface AnalyzeResult {
  success: true;
  targetId: string;
  timestamp: string;
  model: string;
  output: string;
  reasoningTrace: string[];
}

const instructions = {
  fast: 'Analyze efficiently and provide a concise response.',
  deep: 'Analyze carefully and describe uncertainty and relevant reasoning.',
  diagnostic: 'Focus on diagnosis, evidence, risks, and next steps.',
} satisfies Record<NonNullable<AnalyzeInput['mode']>, string>;

export async function analyzeWorkflow(input: AnalyzeInput): Promise<AnalyzeResult> {
  if (
    !input ||
    typeof input.targetId !== 'string' ||
    !input.targetId.trim() ||
    typeof input.payload !== 'string' ||
    !input.payload.trim()
  ) {
    throw new Error('Invalid analysis input: targetId and payload are required.');
  }

  const mode = input.mode ?? 'fast';
  if (!Object.hasOwn(instructions, mode)) {
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
    : 60_000;

  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/reason`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        prompt: `${instructions[mode]}\n\nTarget: ${input.targetId.trim()}\n\n${input.payload.trim()}`,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`RyanAI reasoning request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`RyanAI reasoning request failed (${response.status}): ${detail}`);
  }

  let result: { success?: boolean; output?: string; reasoningTrace?: unknown; engine?: string };
  try {
    result = await response.json() as typeof result;
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
