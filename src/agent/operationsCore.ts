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

export async function executeThreeBrainPlan(
  objective: string,
  invoke: (brain: BrainId, prompt: string, signal?: AbortSignal) => Promise<BrainOutput>,
  cancellationSignal?: AbortSignal,
) {
  const specialistIds: BrainId[] = ['primary', 'secondary'];
  const specialistResults = await Promise.allSettled(
    specialistIds.map((brain) => invoke(brain, objective, cancellationSignal)),
  );
  if (cancellationSignal?.aborted) {
    throw cancellationSignal.reason instanceof Error ? cancellationSignal.reason : new Error('Agent run cancelled after worker lease loss.');
  }

  const outputs: BrainOutput[] = [];
  const failures: Array<{ brain: BrainId; reason: string }> = [];
  specialistResults.forEach((result, index) => {
    if (result.status === 'fulfilled') outputs.push(result.value);
    else failures.push({ brain: specialistIds[index], reason: result.reason instanceof Error ? result.reason.message.slice(0, 300) : 'Provider request failed.' });
  });

  const logicPrompt = outputs.length
    ? ['Synthesize only the available specialist analysis. Explicitly identify missing specialists, uncertainty, agreement, disagreement, and unresolved risks. Do not imply missing brains responded or claim external actions.', 'OBJECTIVE:', objective, ...outputs.map((item) => item.brain.toUpperCase() + ': ' + item.output)].join('\n')
    : ['Standalone fallback: both specialist brains are unavailable. Analyze independently and state that no specialist verification or consensus was available. Do not claim external actions.', 'OBJECTIVE:', objective].join('\n');

  let logic: BrainOutput | undefined;
  try {
    logic = await invoke('logic', logicPrompt, cancellationSignal);
    outputs.push(logic);
  } catch (error) {
    if (cancellationSignal?.aborted) {
      throw cancellationSignal.reason instanceof Error ? cancellationSignal.reason : new Error('Agent run cancelled after worker lease loss.');
    }
    failures.push({ brain: 'logic', reason: error instanceof Error ? error.message.slice(0, 300) : 'Provider request failed.' });
  }

  if (outputs.length === 0) {
    throw new Error('All reasoning brains are unavailable. ' + failures.map((item) => item.brain + ': ' + item.reason).join(' | '));
  }

  const specialists = outputs.filter((item) => item.brain !== 'logic');
  const verified = outputs.length === 3 && Boolean(logic) && verifyThreeBrainResult(outputs, logic.output).verified;
  const synthesis = logic
    ? (specialists.length ? logic.output : 'DEGRADED MODE — standalone Logic response; no specialist analyses or three-brain verification were available.\n\n' + logic.output)
    : 'DEGRADED MODE — Logic synthesis unavailable; no consensus was produced.\n\n' + specialists.map((item) => item.brain.toUpperCase() + ':\n' + item.output).join('\n\n');

  const handoffs = specialists.map((item) => ({ fromAgent: 'supervisor', toAgent: item.brain, input: objective, output: item.output }));
  if (logic) {
    const logicOutput = logic.output;
    specialists.forEach((item) => handoffs.push({ fromAgent: item.brain, toAgent: 'logic', input: item.output, output: logicOutput }));
  }

  return {
    outputs, synthesis, degraded: !verified, failures,
    verification: verified ? verifyThreeBrainResult(outputs, synthesis) : { verified: false, reason: 'Degraded execution: one or more reasoning brains did not return a verified result.' },
    handoffs,
  };
}
