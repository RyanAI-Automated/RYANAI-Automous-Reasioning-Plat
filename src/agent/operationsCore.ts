export type BrainId = 'primary' | 'secondary' | 'logic';
export interface BrainOutput { brain: BrainId; output: string; latencyMs: number; }
export async function executeThreeBrainPlan(objective: string, invoke: (brain: BrainId, prompt: string) => Promise<BrainOutput>) {
  const [primary, secondary] = await Promise.all([invoke('primary', objective), invoke('secondary', objective)]);
  const prompt = ['Synthesize both specialist analyses. Identify agreement, disagreement, assumptions, and unresolved risks. Do not claim external actions were taken.', 'OBJECTIVE:', objective, 'PRIMARY:', primary.output, 'SECONDARY:', secondary.output].join('\n');
  const logic = await invoke('logic', prompt);
  return {
    outputs: [primary, secondary, logic],
    synthesis: logic.output,
    handoffs: [
      { fromAgent: 'supervisor', toAgent: 'primary', input: objective, output: primary.output },
      { fromAgent: 'supervisor', toAgent: 'secondary', input: objective, output: secondary.output },
      { fromAgent: 'primary', toAgent: 'logic', input: primary.output, output: logic.output },
      { fromAgent: 'secondary', toAgent: 'logic', input: secondary.output, output: logic.output },
    ],
  };
}
