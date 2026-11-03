import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { commsTools } from './tools/commsTools.js';
import { sendWhatsAppTool } from './tools/whatsappTool.js';
import { createChatModel } from '../config/llm.js';
import { resolveDatabaseConnectionUrl } from '../server/databaseConnection.js';

const llm = createChatModel();

// Initialize PostgresSaver checkpointer using database connection string
const databaseUrl = resolveDatabaseConnectionUrl(
  process.env.NODE_ENV ?? 'development',
  process.env.DATABASE_URL,
);

export const checkpointer = PostgresSaver.fromConnString(databaseUrl);

/** Read-only probe through LangGraph's own pool; it performs no checkpoint writes or DDL. */
export async function verifyCheckpointerConnection(): Promise<void> {
  try {
    await checkpointer.getTuple({
      configurable: { thread_id: 'ryanai-startup-readiness-probe' },
    });
  } catch {
    // Do not propagate driver errors: they may contain connection metadata.
    throw new Error('LangGraph checkpointer connection probe failed.');
  }
}

// Checkpoint tables are provisioned only by the explicit Prisma migration command.
// API startup verifies the schema and never calls PostgresSaver.setup(), which performs DDL.
// Register communication tools alongside WhatsApp integration
const agentTools = [...commsTools, sendWhatsAppTool];

export const humanInTheLoopAgent = createReactAgent({
  llm,
  tools: agentTools,
  checkpointSaver: checkpointer,
  interruptBefore: ['tools'],
});
