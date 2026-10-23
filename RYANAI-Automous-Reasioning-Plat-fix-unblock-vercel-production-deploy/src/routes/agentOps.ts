// src/routes/agentOps.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ryanAgentApp } from "../engine/agentGraph.js";
import { HumanMessage } from "@langchain/core/messages";

interface AgentTriggerBody {
  objective: string;
}

/**
 * Register objective execution through the agent graph.
 * Missing objectives return HTTP 400; invocation failures become HTTP 500 results.
 */
export async function agentOpsRoutes(fastify: FastifyInstance) {
  fastify.post("/api/agent/evolve", async (request: FastifyRequest<{ Body: AgentTriggerBody }>, reply: FastifyReply) => {
    const { objective } = request.body;

    if (!objective) {
      return reply.code(400).send({ error: "Missing required field: 'objective'" });
    }

    try {
      console.log(`[RyanAI Gateway] Autonomous objective received: "${objective}"`);

      // Invoke the LangGraph ReAct agent pipeline
      const finalState = await ryanAgentApp.invoke({
        messages: [new HumanMessage(objective)],
      });

      const lastMessage = finalState.messages[finalState.messages.length - 1];

      return reply.send({
        status: "success",
        objective,
        result: lastMessage.content,
      });
    } catch (error: unknown) {
      console.error("[RyanAI Gateway Execution Error]:", error);
      return reply.code(500).send({
        status: "failed",
        error: (error instanceof Error ? error.message : String(error)),
      });
    }
  });
}