import { getReasoningAgent } from './engine.js';
import { MEMORY_CONTEXT_PREFIX, buildMemoryContext } from './memoryContext.js';

export interface AgentUser {
  id: string;
  role?: string;
}

/**
 * Run the reasoning agent for one request. The user's saved notes go in as a
 * system message, so the agent knows the user without calling a tool. The
 * verified user id and role go in the run config for the tools. The notes
 * message is removed from the returned messages, so API responses keep the
 * same shape as before.
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
  const memory = await buildMemoryContext(user?.id);
  const result = await getReasoningAgent(model).invoke(
    {
      messages: [
        ...(memory ? [{ role: 'system', content: memory }] : []),
        { role: 'user', content: prompt },
      ],
    },
    { configurable: { userId: user?.id, role: user?.role } },
  );
  if (!memory) return result;
  return {
    ...result,
    messages: result.messages.filter(
      (message) =>
        !(typeof message.content === 'string' && message.content.startsWith(MEMORY_CONTEXT_PREFIX)),
    ),
  };
}
