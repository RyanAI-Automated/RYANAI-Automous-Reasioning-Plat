import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { createChatModel } from '../config/llm.js';
import { recallMemoryTool, rememberFactTool } from './tools/memoryTools.js';

const SCHEDULED_PROMPT = `You are RyanAI, running a scheduled task for the user.
No person is watching this run, so do not ask questions. If the task is unclear, say what you could not do and why.
You can read and save the user's notes. You cannot send messages, make calls, change files, or schedule more tasks.
Reply with a short result that the user will read later.`;

let agent: ReturnType<typeof createReactAgent> | undefined;

/**
 * The agent for unattended runs. It has the memory tools that read and save
 * notes. It has no tool that sends a message, writes a file, or schedules
 * another task, because no person can approve those actions during the run.
 */
export function getScheduledAgent() {
  agent ??= createReactAgent({
    llm: createChatModel(),
    tools: [recallMemoryTool, rememberFactTool],
    stateModifier: SCHEDULED_PROMPT,
  });
  return agent;
}
