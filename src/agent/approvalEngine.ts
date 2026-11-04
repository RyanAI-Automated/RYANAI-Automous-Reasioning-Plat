import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { commsTools } from './tools/commsTools.js';
import { createChatModel } from '../config/llm.js';

const llm = createChatModel();

// Conversation memory is durable only when backed by the configured PostgreSQL
// database. Never silently create a local/default database connection.
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for persistent RyanAI agent memory; refusing to use a local fallback.',
  );
}

export const checkpointer = PostgresSaver.fromConnString(databaseUrl);

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
