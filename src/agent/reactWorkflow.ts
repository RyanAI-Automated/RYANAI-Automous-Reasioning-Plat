import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { END, StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { Pool } from "pg";
import { runCppInference } from "../native/bridge.js";

// 1. Setup PostgreSQL connection pool for LangGraph checkpointing
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/ryan_ai_db",
});

export async function createRyanAgentGraph() {
  // Initialize and setup checkpointer tables if not exists
  const checkpointer = new PostgresSaver(pool);
  await checkpointer.setup();

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