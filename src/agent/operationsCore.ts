export type BrainId = 'primary' | 'secondary' | 'logic';
export interface BrainOutput { brain: BrainId; output: string; latencyMs: number; }

export function verifyThreeBrainResult(outputs: BrainOutput[], synthesis: string) {
  const required: BrainId[] = ['primary', 'secondary', 'logic'];
  const seen = new Set(outputs.map((item) => item.brain));
  const missing = required.filter((brain) => !seen.has(brain));
  if (outputs.length !== required.length || missing.length) {
    return { verified: false, reason: 'Expected exactly one result from each reasoning brain.' };
  }
  if (outputs.some((item) => !item.output.trim())) {
    return { verified: false, reason: 'A reasoning brain returned an empty result.' };
  }
  if (!synthesis.trim()) {
    return { verified: false, reason: 'The logic brain returned an empty synthesis.' };
  }
  return { verified: true, reason: null };
}

export async function executeThreeBrainPlan(objective: string, invoke: (brain: BrainId, prompt: string) => Promise<BrainOutput>) {
  const [primary, secondary] = await Promise.all([invoke('primary', objective), invoke('secondary', objective)]);
  const prompt = [
    'Synthesize both specialist analyses. Identify agreement, disagreement, assumptions, and unresolved risks. Do not claim external actions were taken.',
    'OBJECTIVE:', objective, 'PRIMARY:', primary.output, 'SECONDARY:', secondary.output,
  ].join('\n');
  const logic = await invoke('logic', prompt);
  const outputs = [primary, secondary, logic];
  const verification = verifyThreeBrainResult(outputs, logic.output);
  if (!verification.verified) throw new Error('Three-brain result verification failed: ' + verification.reason);
  return {
    outputs, synthesis: logic.output, verification,
    handoffs: [
      { fromAgent: 'supervisor', toAgent: 'primary', input: objective, output: primary.output },
      { fromAgent: 'supervisor', toAgent: 'secondary', input: objective, output: secondary.output },
      { fromAgent: 'primary', toAgent: 'logic', input: primary.output, output: logic.output },
      { fromAgent: 'secondary', toAgent: 'logic', input: secondary.output, output: logic.output },
    ],
  };
}