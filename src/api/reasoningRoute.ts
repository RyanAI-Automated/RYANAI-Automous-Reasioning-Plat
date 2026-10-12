// File path: ./src/api/reasoningRoute.ts

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { VectorCacheManager } from "../services/vectorCache";

interface ReasoningPayload {
  prompt: string;
  sessionId?: string;
}

const reasoningRouteSchema = {
  body: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: { type: "string", minLength: 1 },
      sessionId: { type: "string" },
    },
  },
};

/**
 * Register reasoning status, execution acknowledgment, and simulated SSE progress routes.
 * Create a vector cache manager and register its connection cleanup on app shutdown.
 */
export async function registerReasoningRoutes(fastify: FastifyInstance): Promise<void> {
  const vectorCache = new VectorCacheManager(
    process.env.REDIS_URL || "redis://localhost:6379",
    process.env.DATABASE_URL || "postgresql://postgres:postgres@postgres:5432/ryanai"
  );

  // Safely close connection pool on app shutdown
  fastify.addHook("onClose", async () => {
    if ("close" in vectorCache && typeof vectorCache.close === "function") {
      await vectorCache.close();
    }
  });

  // 1. Status Check Route
  fastify.get('/api/reason', async () => ({ status: 'active' }));

  // 2. Standard Execution Route
  fastify.post("/api/reasoning/execute", async (_request: FastifyRequest, _reply: FastifyReply) => {
    return { success: true, message: "Reasoning pipeline executed successfully." };
  });

  // 3. SSE Streaming Reasoning Route
  fastify.post<{ Body: ReasoningPayload }>(
    "/api/reasoning/stream",
    { schema: reasoningRouteSchema },
    async (req: FastifyRequest<{ Body: ReasoningPayload }>, reply: FastifyReply) => {
      const { prompt, sessionId } = req.body;

      // Tell Fastify we are handling the raw Node HTTP stream response directly
      reply.hijack();

      const { raw } = reply;
      raw.setHeader("Content-Type", "text/event-stream");
      raw.setHeader("Cache-Control", "no-cache, no-transform");
      raw.setHeader("Connection", "keep-alive");
      raw.setHeader("X-Accel-Buffering", "no"); // Prevents Nginx response buffering

      // Prevent memory leaks / dangling loops on premature client disconnect
      let isAborted = false;
      req.raw.on("close", () => {
        isAborted = true;
      });

      const sendEvent = (data: Record<string, unknown>): void => {
        if (!isAborted && !raw.writableEnded) {
          raw.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      try {
        const steps = [
          "Initializing LangGraph ReAct state graph...",
          `Parsing input context for session: ${sessionId || "default"}`,
          "Executing CUDA C++ tensor inference module...",
          "Evaluating tool-call routing and vector memory match...",
          "Synthesizing autonomous reasoning output.",
        ];

        for (const step of steps) {
          if (isAborted) break;

          sendEvent({ status: "processing", message: step });
          await new Promise((resolve) => setTimeout(resolve, 350));
        }

        if (!isAborted) {
          sendEvent({
            status: "complete",
            result: `RyanAI processed: "${prompt}"`,
          });
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "Internal Server Error";
        sendEvent({ error: errorMessage });
      } finally {
        if (!raw.writableEnded) {
          raw.end();
        }
      }
    }
  );
}