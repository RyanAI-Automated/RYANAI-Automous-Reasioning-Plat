import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { HumanMessage, BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { tool, DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { SelfPatchSkill } from "./selfPatchSkill.js";
import { systemDiagnosticsTool } from "../tools/systemTools.js";
import { queryStackOverflow } from "../tools/stackoverflow.js";

// Define LangGraph State Annotation
const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
});

type State = typeof GraphState.State;

// Define Tools
const selfPatchTool = tool(
  async ({ filePath, patchContent, testScript }) => {
    const result = await SelfPatchSkill.applyAndVerifyPatch({ filePath, patchContent, testScript });
    return JSON.stringify(result);
  },
  {
    name: "self_patch_workspace",
    description: "Securely applies and sandbox-verifies code patches for RyanAI platform self-evolution.",
    schema: z.object({
      filePath: z.string().describe("Target file path to update."),
      patchContent: z.string().describe("New file content or patch string."),
      testScript: z.string().optional().describe("Optional verification script to run in sandbox."),
    }),
  }
);

const diagnosticsToolWrapper = tool(
  async ({ queryType }) => {
    const result = await systemDiagnosticsTool.invoke({ queryType });
    return typeof result === "string" ? result : JSON.stringify(result);
  },
  {
    name: "system_diagnostics",
    description: "Inspects local GPU, memory, or general system telemetry.",
    schema: z.object({
      queryType: z.enum(["memory", "gpu", "general"]).describe("Type of diagnostics query."),
    }),
  }
);

export const stackOverflowTool = new DynamicStructuredTool({
  name: "query_stackoverflow_agents",
  description: "Search technical solutions and documentation via Stack Overflow for Agents",
  schema: z.object({
    query: z.string().describe("The programming or architectural query to search"),
  }),
  func: async ({ query }) => {
    // Fixed: Pass query object payload instead of raw string (TS2345 fix)
    const result = await queryStackOverflow({ query });
    return JSON.stringify(result);
  },
});

const tools = [selfPatchTool, diagnosticsToolWrapper, stackOverflowTool];
const toolNode = new ToolNode(tools);

// Initialize Model
const model = new ChatOpenAI({
  modelName: process.env.RYAN_MODEL_NAME || "gpt-4o",
  temperature: 0.2,
}).bindTools(tools);

// Agent Logic Functions
function shouldContinue(state: State) {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];

  if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  return END;
}

async function callModel(state: State) {
  const messages = state.messages;
  const response = await model.invoke(messages);
  return { messages: [response] };
}

// Build LangGraph State Machine
export const workflow = new StateGraph(GraphState)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue, {
    tools: "tools",
    [END]: END,
  })
  .addEdge("tools", "agent");

export const ryanAgentApp = workflow.compile();

/**
 * Autonomous Self-Update Trigger for background processes or API routes.
 */
export async function triggerSelfCheckAndPatch(objective: string) {
  console.log(`[RyanAI Engine] Initiating autonomous objective: "${objective}"`);

  const finalState = await ryanAgentApp.invoke({
    messages: [new HumanMessage(objective)],
  });

  const lastMessage = finalState.messages[finalState.messages.length - 1];
  console.log("[RyanAI Engine] Objective completed:", lastMessage.content);
  return lastMessage.content;
}