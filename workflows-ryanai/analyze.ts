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

export async function analyzeWorkflow(input: AnalyzeInput): Promise<AnalyzeResult> {
  if (!input.targetId?.trim() || !input.payload?.trim()) {
    throw new Error('Invalid analysis input: targetId and payload are required.');
  }
  const mode = input.mode ?? 'fast';
  const instructions = {
    fast: 'Analyze efficiently and provide a concise response.',
    deep: 'Analyze carefully and describe uncertainty and relevant reasoning.',
    diagnostic: 'Focus on diagnosis, evidence, risks, and next steps.',
  } satisfies Record<NonNullable<AnalyzeInput['mode']>, string>;
  if (!Object.hasOwn(instructions, mode)) {
    throw new Error(`Unsupported analysis mode: ${String(mode)}`);
  }

  const apiBase = (
    process.env.RYANAI_API_BASE_URL ||
    process.env.API_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const response = await fetch(`${apiBase}/api/reason`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: `${instructions[mode]}\n\nTarget: ${input.targetId}\n\n${input.payload}`,
    }),
  });
  if (!response.ok) {
    throw new Error(`RyanAI reasoning request failed (${response.status}): ${await response.text()}`);
  }

  const result = await response.json() as {
    success?: boolean;
    output?: string;
    reasoningTrace?: string[];
  };
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
