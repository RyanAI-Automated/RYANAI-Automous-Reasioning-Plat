import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { END, StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { Pool } from "pg";
import { runCppInference } from "../native/bridge.js";

// 1. Setup PostgreSQL connection pool for LangGraph checkpointing
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/ryan_ai_db",
});

// The checkpointer schema is applied by npm run db:migrate before service use.
// Graph creation and requests must never perform schema DDL.
const checkpointer = new PostgresSaver(pool);

export async function createRyanAgentGraph() {

  // 2. Define the agent reasoning node (integrating our C++ bridge for fast tensor/token logic)
  const reasoningNode = async (state: typeof MessagesAnnotation.State) => {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];
    const promptText = typeof lastMessage.content === 'string' ? lastMessage.content : 'Execute task';

    console.log(`[RYAN REACT AGENT] Evaluating prompt via C++ engine: "${promptText}"`);
    
    // Call our compiled C++ native reasoning module
    const nativeResult = runCppInference(promptText);

    const response = new AIMessage({
      content: `[RyanAI ReAct Engine] ${nativeResult}`
    });

    return { messages: [response] };
  };

  // 3. Build the LangGraph State Graph
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent_reasoning", reasoningNode)
    .addEdge("__start__", "agent_reasoning")
    .addEdge("agent_reasoning", END);

  // Compile the graph with PostgreSQL checkpointer persistence
  const app = workflow.compile({ checkpointer });
  
  return app;
}