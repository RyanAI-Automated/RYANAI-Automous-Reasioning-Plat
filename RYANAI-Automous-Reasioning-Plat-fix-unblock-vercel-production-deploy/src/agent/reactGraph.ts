// File path: ./src/agent/reactGraph.ts

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, BaseMessage } from "@langchain/core/messages";
import { AUTONOMOUS_REASONING_SKILL } from "../skills/autonomousReasoning.js";

// Define the execution output structure expected by the Fastify gateway
export interface AgentState {
  input: string;
  steps: string[];
  context: Record<string, unknown>;
  output: string;
}

const modelName = process.env.PRIMARY_REASONING_MODEL ||
  (process.env.NVIDIA_API_KEY
    ? process.env.NVIDIA_MODEL || "nvidia/nemotron-3-ultra"
    : process.env.OPENAI_MODEL || "gpt-4o");
let reactAgentGraph: ReturnType<typeof createReactAgent> | undefined;

const agentTools: Parameters<typeof createReactAgent>[0]['tools'] = [];

function getReactAgentGraph() {
  if (!reactAgentGraph) {
    const apiKey = process.env.NVIDIA_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Configure NVIDIA_API_KEY or OPENAI_API_KEY before requesting reasoning.");
    }

    const llm = new ChatOpenAI({
      modelName,
      temperature: 0.2,
      configuration: {
        ...(process.env.NVIDIA_API_KEY
          ? { baseURL: process.env.NVIDIA_API_ENDPOINT || "https://integrate.api.nvidia.com/v1" }
          : process.env.OPENAI_BASE_URL
            ? { baseURL: process.env.OPENAI_BASE_URL }
            : {}),
        apiKey,
      },
    });

    reactAgentGraph = createReactAgent({
      llm,
      tools: agentTools,
      stateModifier: new SystemMessage(AUTONOMOUS_REASONING_SKILL.systemPrompt),
    });
  }
  return reactAgentGraph;
}

export class RyanReActEngine {
  private cudaEnabled: boolean;

  constructor(cudaEnabled = process.env.CUDA_ENABLED === "true") {
    this.cudaEnabled = cudaEnabled;
  }

  /**
   * Executes an objective prompt through the LangGraph ReAct loop.
   * 
   * @param prompt - Objective passed from Fastify /api/reason endpoint
   * @returns Formatted steps and final synthesis payload
   */
  public async execute(prompt: string): Promise<AgentState> {
    const startTime = Date.now();

    // System prompt is handled by stateModifier, so we only need to pass the HumanMessage
    const inputs = {
      messages: [new HumanMessage(prompt)],
    };

    try {
      // Invoke the LangGraph execution pipeline
      const graphState = await getReactAgentGraph().invoke(inputs, {
        recursionLimit: AUTONOMOUS_REASONING_SKILL?.maxIterations || 10,
      });

      const messages: BaseMessage[] = graphState.messages || [];
      const finalMessage = messages[messages.length - 1];

      // Extract intermediate Thought/Action steps for tracing (skip human input and final output)
      const reasoningTrace = messages
        .slice(1, -1)
        .map((msg) => {
          if (msg._getType() === "ai" && msg.additional_kwargs?.tool_calls) {
             const tools = msg.additional_kwargs.tool_calls.map((t) => t.function.name).join(", ");
             return `[Action] Invoking tool(s): ${tools}`;
          }
          if (msg._getType() === "tool") {
             return `[Observation] Tool returned execution data.`;
          }
          const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          return content ? `[Thought] ${content}` : "";
        })
        .filter((step) => step.length > 0);

      // Extract final text output
      const outputText = typeof finalMessage?.content === "string" 
        ? finalMessage.content 
        : JSON.stringify(finalMessage?.content || "No output generated.");

      // Calculate latency
      const latencyMs = Date.now() - startTime;

      return {
        input: prompt,
        steps: reasoningTrace.length ? reasoningTrace : ["[Dispatcher] Direct response synthesized without intermediate tool steps."],
        context: {
          engine: "RyanAI-LangGraph",
          model: modelName,
          latencyMs,
          cudaEnabled: this.cudaEnabled,
        },
        output: outputText,
      };

    } catch (error) {
      console.error("[RyanReActEngine] Execution failed:", error);
      throw error;
    }
  }
}

// Default instance consumed by server.ts
export const defaultEngine = new RyanReActEngine();