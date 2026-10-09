// File path: ./server.ts

import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import cors from "@fastify/cors";
import { defaultEngine } from "./src/agent/reactGraph";

const server = Fastify({
  logger: true,
});

// CORS: set CORS_ORIGINS to a comma-separated list, e.g.
//   CORS_ORIGINS=https://your-app.vercel.app,https://app.example.com
// In production, an unset value blocks cross-origin browser calls.
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

await server.register(cors, {
  origin:
    allowedOrigins.length > 0
      ? allowedOrigins
      : process.env.NODE_ENV === "production"
        ? false
        : true,
});

interface ReasonRequestBody {
  prompt?: string;
}

/** Build the standalone gateway health response with the current timestamp. */
const healthPayload = () => ({
  status: "online",
  engine: "RyanAI Sovereign Engine",
  architect: "Ntsiyeni Ganyane",
  activeGraph: "ReAct",
  timestamp: new Date().toISOString(),
});

// /health is what the frontend health check, Docker and Kubernetes probes use.
// /api/health is kept for the Vite dev proxy and older clients.
server.get("/health", async (_request: FastifyRequest, _reply: FastifyReply) => healthPayload());
server.get("/api/health", async (_request: FastifyRequest, _reply: FastifyReply) => healthPayload());

// Agent Reasoning execution endpoint
server.post("/api/reason", async (request: FastifyRequest<{ Body: ReasonRequestBody }>, reply: FastifyReply) => {
  const { prompt } = request.body || {};

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return reply.status(400).send({ error: "Objective prompt is required." });
  }

  try {
    request.log.info({ promptLength: prompt.length }, "Dispatching objective to RyanReActEngine");

    const agentState = await defaultEngine.execute(prompt);

    return {
      success: true,
      objective: prompt,
      reasoningTrace: agentState.steps,
      output: agentState.output,
      timestamp: new Date().toISOString(),
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Internal sovereign engine failure.";
    request.log.error(error);
    return reply.status(500).send({ error: errorMessage });
  }
});

// Start the Fastify API Gateway
/** Listen on the configured gateway port and exit with an error if startup fails. */
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || "3001", 10);
    await server.listen({ port, host: "0.0.0.0" });
    console.log(`[RyanAI Gateway] Server listening on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
