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

export async function analyzeWorkflow(
  input: AnalyzeWorkflowInput,
): Promise<AnalyzeWorkflowResult> {
  if (!input.targetId?.trim() || !input.payload?.trim()) {
    throw new Error('Invalid analysis input: both targetId and payload are required.');
  }
  const mode = input.mode ?? 'fast';
  if (!(mode in modeInstructions)) {
    throw new Error(`Unsupported analysis mode: ${String(mode)}`);
  }

  const apiBase = (process.env.RYANAI_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:3000')
    .replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const response = await fetch(`${apiBase}/api/reason`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: [
        modeInstructions[mode],
        `Target: ${input.targetId}`,
        input.payload,
      ].join('\n\n'),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`RyanAI reasoning request failed (${response.status}): ${detail}`);
  }

  const result = await response.json() as ReasoningResponse;
  if (result.success !== true || typeof result.output !== 'string' || !result.output.trim()) {
    throw new Error('RyanAI reasoning API returned an invalid or unsuccessful response.');
  }

  return {
    success: true,
    targetId: input.targetId,
    timestamp: new Date().toISOString(),
    model,
    output: result.output,
    reasoningTrace: Array.isArray(result.reasoningTrace) ? result.reasoningTrace : [],
  };
}
