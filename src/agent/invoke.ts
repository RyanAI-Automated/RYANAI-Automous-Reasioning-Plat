import { languageInstruction, DEFAULT_LANGUAGE, isRyanLanguage } from '../shared/languages.js';
import { buildMemoryContext } from './memoryContext.js';
import { dispatchAutonomousTask, waitForAutonomousTask } from './operations.js';

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

/** Authenticated reasoning is queued durably, then read back from persisted execution history. */
export async function invokeReasoningAgent({
  prompt,
  model,
  user,
  language,
}: {
  prompt: string;
  model?: string;
  user?: AgentUser | null;
  language?: string;
}) {
  if (!user?.id) {
    throw new Error('An authenticated user is required for traceable three-brain reasoning.');
  }

  // Provider selection is owned by the three independent server-side brain configs.
  void model;
  const memory = await buildMemoryContext(user.id);
  const responseLanguage = language && isRyanLanguage(language) ? language : DEFAULT_LANGUAGE;
  const languagePolicy = '[RYANAI LANGUAGE POLICY] ' + languageInstruction(responseLanguage);
  const objective = [languagePolicy, memory, 'User request:\\n' + prompt].filter(Boolean).join('\\n\\n');
  const queued = await dispatchAutonomousTask(user.id, objective);
  const run = await waitForAutonomousTask(queued.id, user.id);
  const handoffs = run.handoffs as ReasoningHandoff[];
  const specialistMessages = handoffs
    .filter((handoff) => handoff.toAgent === 'primary' || handoff.toAgent === 'secondary')
    .map((handoff) => ({
      content: '[' + handoff.toAgent.toUpperCase() + ' BRAIN]\n' + handoff.output,
    }));
  const synthesis = { content: '[LOGIC BRAIN SYNTHESIS]\n' + run.result };

  return {
    messages: [...specialistMessages, synthesis],
    runId: run.id,
    handoffs,
    engine: 'RyanAI Three-Brain Orchestrator',
  };
}
