import { MEMORY_CONTEXT_PREFIX, buildMemoryContext } from './memoryContext.js';
import { dispatchAutonomousTask } from './operations.js';

export interface AgentUser {
  id: string;
  role?: string;
}

export interface ReasoningHandoff {
  fromAgent: string;
  toAgent: string;
  input: string;
  output: string;
}

/**
 * Production reasoning is a coordinated three-provider run:
 * NVIDIA/primary and Qwen/secondary execute concurrently, then the
 * independent logic brain synthesizes both outputs. dispatchAutonomousTask
 * persists the run and each handoff before this result reaches the API.
 */
export async function invokeReasoningAgent({
  prompt,
  model,
  user,
}: {
  prompt: string;
  model?: string;
  user?: AgentUser | null;
}) {
  if (!user?.id) {
    throw new Error('An authenticated user is required for traceable three-brain reasoning.');
  }

  // The UI model selector is retained for API compatibility. Provider selection
  // is intentionally owned by the three independent server-side brain configs.
  void model;

  const memory = await buildMemoryContext(user.id);
  const objective = memory
    ? `${MEMORY_CONTEXT_PREFIX}\n${memory}\n\nUser request:\n${prompt}`
    : prompt;

  const run = await dispatchAutonomousTask(user.id, objective);
  const handoffs = run.handoffs as ReasoningHandoff[];
  const specialistMessages = handoffs
    .filter((handoff) => handoff.toAgent === 'primary' || handoff.toAgent === 'secondary')
    .map((handoff) => ({
      content: `[${handoff.toAgent.toUpperCase()} BRAIN]\n${handoff.output}`,
    }));
  const synthesis = {
    content: `[LOGIC BRAIN SYNTHESIS]\n${run.result}`,
  };

  return {
    messages: [...specialistMessages, synthesis],
    runId: run.id,
    handoffs,
    engine: 'RyanAI Three-Brain Orchestrator',
  };
}
