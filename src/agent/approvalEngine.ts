import { MemorySaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { commsTools } from './tools/commsTools.js';
import { createChatModel } from '../config/llm.js';

const llm = createChatModel();

// PostgreSQL remains the default and authoritative checkpointer. An explicitly
// selected in-memory saver is available only for disposable, non-production
// sandbox/test work; its checkpoints are lost when this process exits.
const memoryMode = (process.env.RYANAI_AGENT_MEMORY_MODE ?? 'postgres').trim().toLowerCase();

function createCheckpointer() {
  if (memoryMode === 'ephemeral') {
    if ((process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
      throw new Error(
        'RYANAI_AGENT_MEMORY_MODE=ephemeral is disabled when NODE_ENV=production; configure PostgreSQL for production agent memory.',
      );
    }

    return new MemorySaver();
  }

  if (memoryMode !== 'postgres') {
    throw new Error(
      'RYANAI_AGENT_MEMORY_MODE must be either "postgres" or "ephemeral".',
    );
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required for persistent RyanAI agent memory; refusing to use a local fallback.',
    );
  }

  return PostgresSaver.fromConnString(databaseUrl);
}

export const checkpointer = createCheckpointer();

// Checkpoint tables are provisioned only by the explicit Prisma migration command.
// API startup verifies the schema and never calls PostgresSaver.setup(), which performs DDL.
// Agent tools are restricted to policy lookup and draft preparation. Provider sends
// remain in the owner-authenticated communications gateway and require owner action.
export const humanInTheLoopAgent = createReactAgent({
  llm,
  tools: commsTools,
  checkpointSaver: checkpointer,
  interruptBefore: ['tools'],
});
