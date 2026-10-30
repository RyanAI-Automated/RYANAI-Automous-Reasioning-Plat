import { buildMemoryContext } from './memoryContext.js';
import { dispatchAutonomousTask, waitForAutonomousTask } from './operations.js';

export interface AgentUser {
  id: string;
  role?: string;
  displayName?: string;
  isOwner?: boolean;
  preferredTitle?: string;
  preferredLanguage?: string;
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
}: {
  prompt: string;
  model?: string;
  user?: AgentUser | null;
}) {
  if (!user?.id) {
    throw new Error('An authenticated user is required for traceable three-brain reasoning.');
  }

  // Provider selection is owned by the three independent server-side brain configs.
  void model;
  const memory = await buildMemoryContext(user.id);
  const language = user.preferredLanguage || 'en-ZA';
  const address = user.isOwner ? (user.preferredTitle || 'Sir G') : (user.displayName || 'the user');
  const personalization = [
    'RyanAI response preferences:',
    `Address this user as ${address}.`,
    `Write the answer in locale ${language}, unless the user explicitly asks for another language.`,
    'When translating, preserve meaning, names, technical terms, dates and amounts. If a translation is uncertain, say so rather than inventing wording.',
  ].join(' ');
  const objective = [personalization, memory, 'User request:\n' + prompt].filter(Boolean).join('\n\n');
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
