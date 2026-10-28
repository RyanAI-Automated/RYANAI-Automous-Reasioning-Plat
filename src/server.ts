// File path: ./src/server.ts

import { startTelemetry } from './telemetry/otel.js';
startTelemetry();

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { registerAuthRoutes } from './routes/auth.js';
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import crypto from "node:crypto";
import twilio from "twilio";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultEngine } from "./agent/reactGraph.js";
import { createRyanAgentGraph } from "./agent/reactWorkflow.js";
import { HumanMessage } from "@langchain/core/messages";
import { RyanAIOrchestrator } from "./engine/orchestrator.js";
import { RyanAISwarmCoordinator } from "./engine/swarmCoordinator.js";
import { agentOpsRoutes } from "./routes/agentOps.js";
import { dispatchRoutes } from "./routes/dispatch.js";
import { githubRoutes } from "./routes/github.js";
import { voiceRealtimeGateway } from "./gateway/voiceRealtimeGateway.js";
import transcendPlugin from "./plugins/transcendGovernance.js";
import nativeInferencePlugin from "./plugins/nativeInference.js";
import { eBPFSentinel } from "./security/sentinelLoader.js";

dotenv.config();

declare module 'fastify' {
  interface FastifyInstance {
    cppEngine?: {
      evaluate: (prompt: string) => unknown;
    };
    transcend?: {
      evaluate: (payload: Record<string, unknown>) => { allow: boolean; requires_human_approval: boolean; violations: string[] };
    };
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const swarm = RyanAISwarmCoordinator.getInstance();
swarm.startMeshBroadcast(3000);

swarm.on("peer_updated", (peerId: string) => {
  console.log(`[Swarm Mesh] Discovered / updated peer node in cluster: ${peerId}`);
});

const sentinel = new eBPFSentinel();
sentinel.initializeSentinel();

const RyanAICheckpointer = {
  getLatestCheckpoint: async (_threadId: string) => {
    return null;
  },
  saveCheckpoint: async (_threadId: string, _step: number, _state: unknown) => {
    // Persists checkpoint state
  },
};

interface EngineCommandBody {
  command: string;
  targetModule?: string;
}

interface ReasonRequestBody {
  prompt: string;
}

interface TaskRequestBody {
  task: string;
  threadId?: string;
}

interface InitiateCallBody {
  to?: string;
  reason?: string;
  message?: string;
  priority?: "low" | "medium" | "high" | "critical";
}

interface TwimlQuery {
  message?: string;
  reason?: string;
}

interface GatherBody {
  Digits?: string;
  SpeechResult?: string;
}

const activeCalls = new Map<string, { reason: string; startTime: number }>();

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

let previousCpuSample = cpus().map((cpu) => ({ ...cpu.times }));

export function readTelemetry(): TelemetryData {
  const currentCpuSample = cpus().map((cpu) => ({ ...cpu.times }));
  let cpuUsage: number | null = null;
  if (currentCpuSample.length === previousCpuSample.length && currentCpuSample.length > 0) {
    const current = currentCpuSample.reduce(
      (result, cpu) => ({
        idle: result.idle + cpu.idle,
        total: result.total + Object.values(cpu).reduce((sum, value) => sum + value, 0),
      }),
      { idle: 0, total: 0 },
    );
    const previous = previousCpuSample.reduce(
      (result, cpu) => ({
        idle: result.idle + cpu.idle,
        total: result.total + Object.values(cpu).reduce((sum, value) => sum + value, 0),
      }),
      { idle: 0, total: 0 },
    );
    const elapsed = current.total - previous.total;
    cpuUsage = elapsed > 0
      ? Math.round(((elapsed - (current.idle - previous.idle)) / elapsed) * 100)
      : null;
  }
  previousCpuSample = currentCpuSample;

  return {
    cpuUsage,
    memoryUsage: Math.round((process.memoryUsage().rss / totalmem()) * 100),
    networkLatency: null,
    activeThreads: null,
  };
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      transport: {
        target: "pino-pretty",
        options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" },
      },
    },
  });

  await app.register(cors, {
    origin: process.env.NODE_ENV === "production" ? false : "*",
  });
  await app.register(formbody);
  await app.register(websocket);
  await app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || "ryanai-secure-jwt-secret-key-2026",
  });
  await registerAuthRoutes(app);
  await app.register(nativeInferencePlugin);

  await app.register(transcendPlugin, {
    wasmFilePath: path.join(__dirname, "../policy.wasm"),
    enforceRoutes: ["/api/v1/agent/execute", "/api/v1/voice/call"],
  });

  await app.register(agentOpsRoutes);
  await app.register(dispatchRoutes);
  await app.register(githubRoutes);
  await app.register(voiceRealtimeGateway);

  app.get("/health", async (_request: FastifyRequest, _reply: FastifyReply) => {
    return {
      status: "online",
      service: "ryanai-api-gateway",
      timestamp: new Date().toISOString(),
      services: {
        database: "unknown",
        cudaEngine: Boolean(app.cppEngine),
        swarmMesh: "started",
        ebpfSentinel: sentinel.getStatus(),
      },
    };
  });

  app.get("/api/health", async (_request: FastifyRequest, _reply: FastifyReply) => {
    return {
      status: "ONLINE",
      engine: "RyanAI Sovereign Autonomous Reasoning Platform",
      architect: "Ntsiyeni Ganyane",
      cudaActive: Boolean(app.cppEngine),
      activeGraph: "ReAct-v4",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/api/system", async (_request: FastifyRequest, _reply: FastifyReply) => {
    return {
      status: "online",
      service: "ryanai-api-gateway",
      timestamp: new Date().toISOString(),
      services: { database: "unknown", cuda: Boolean(app.cppEngine), swarm: "started", sentinel: sentinel.getStatus() },
    };
  });

  app.get("/api/ryan/security/status", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      success: true,
      sentinel: sentinel.getStatus(),
    });
  });

  app.post<{ Body: { prompt: string } }>(
    "/api/ryan/inference",
    async (req: FastifyRequest<{ Body: { prompt: string } }>, reply: FastifyReply) => {
      const { prompt } = req.body || {};

      if (!prompt) {
        return reply.status(400).send({
          success: false,
          error: "Missing prompt parameter",
        });
      }

      if (!app.cppEngine) {
        return reply.status(503).send({ success: false, error: "Native inference engine is not configured." });
      }
      const cppOutput = await app.cppEngine.evaluate(prompt);

      return reply.send({
        success: true,
        engine: "C++ CUDA/CPU Native Core",
        prompt,
        result: cppOutput,
        timestamp: new Date().toISOString(),
      });
    }
  );

  app.post<{ Body: EngineCommandBody }>(
    "/api/engine/command",
    async (request: FastifyRequest<{ Body: EngineCommandBody }>, reply: FastifyReply) => {
      const { command, targetModule } = request.body || {};
      return reply.send({ status: "success", command, targetModule });
    }
  );

  app.post<{ Body: ReasonRequestBody }>(
    "/api/reason",
    async (request: FastifyRequest<{ Body: ReasonRequestBody }>, reply: FastifyReply) => {
      const { prompt } = request.body || {};

      if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return reply.status(400).send({ error: "Missing or invalid objective prompt payload." });
      }

      try {
        request.log.info(`Dispatching objective to RyanReActEngine: ${prompt}`);
        const agentState = await defaultEngine.execute(prompt);

        return reply.send({
          success: true,
          engine: "RyanAI LangGraph ReAct + CUDA Autonomous reasoning processor",
          objective: prompt,
          reasoningTrace: agentState?.steps || [],
          output: agentState?.output || "Autonomous execution complete.",
          timestamp: new Date().toISOString(),
        });
      } catch (error: unknown) {
        request.log.error(error);
        return reply.status(500).send({ error: getErrorMessage(error) });
      }
    }
  );

  app.post<{ Body: { threadId: string; message: string } }>(
    "/api/ryan/agent/invoke",
    async (request: FastifyRequest<{ Body: { threadId: string; message: string } }>, reply: FastifyReply) => {
      const { threadId, message } = request.body || {};

      if (!threadId || !message) {
        return reply.status(400).send({ success: false, error: "Missing threadId or message" });
      }

      try {
        const agentApp = await createRyanAgentGraph();
        const config = { configurable: { thread_id: threadId } };
        const output = await agentApp.invoke(
          { messages: [new HumanMessage(message)] },
          config
        );

        return reply.send({
          success: true,
          threadId,
          state: output,
        });
      } catch (err: unknown) {
        request.log.error(err);
        return reply.status(500).send({ success: false, error: getErrorMessage(err) });
      }
    }
  );

  app.post<{ Body: TaskRequestBody }>(
    "/api/v1/reason",
    async (request: FastifyRequest<{ Body: TaskRequestBody }>, reply: FastifyReply) => {
      try {
        const { task, threadId } = request.body || {};

        if (!task || typeof task !== "string" || !task.trim()) {
          return reply.status(400).send({ error: "Task payload is required" });
        }

        const activeThreadId = threadId || crypto.randomUUID();

        const existingCheckpoint = await RyanAICheckpointer.getLatestCheckpoint(activeThreadId);
        if (existingCheckpoint) {
          app.log.info(`[Gateway] Resuming execution for thread ${activeThreadId} from saved checkpoint.`);
        }

        app.log.info(`Dispatching task to RyanAI Orchestrator: ${task}`);
        const result = await RyanAIOrchestrator.processTask(task);
        await RyanAICheckpointer.saveCheckpoint(activeThreadId, 1, result);

        return reply.status(200).send({
          threadId: activeThreadId,
          ...result,
        });
      } catch (error: unknown) {
        app.log.error(error);
        return reply.status(500).send({ error: getErrorMessage(error) });
      }
    }
  );

  app.post(
    "/api/v1/agent/execute",
    async (req: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ status: "EXECUTED", payload: req.body });
    }
  );

  app.post(
    "/api/v1/transcend/check",
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!app.transcend) {
        return reply.status(503).send({ success: false, error: "Governance engine is not configured." });
      }
      const result = app.transcend.evaluate(req.body as Record<string, unknown>);
      return reply.send(result);
    }
  );

  const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

  app.post<{ Body: InitiateCallBody }>(
    "/api/v1/voice/call",
    async (req: FastifyRequest<{ Body: InitiateCallBody }>, reply: FastifyReply) => {
      const {
        to = process.env.DEFAULT_RECIPIENT_PHONE,
        reason = "System Telemetry Alert",
        message = "RyanAI administrator notification.",
      } = req.body || {};

      if (!to) {
        return reply.status(400).send({ error: 'Target phone number "to" is required.' });
      }

      if (!twilioClient) {
        return reply.status(503).send({ error: "Twilio client is not configured on this server." });
      }

      const fromPhone = process.env.TWILIO_PHONE_NUMBER;
      if (!fromPhone) {
        return reply.status(500).send({ error: "TWILIO_PHONE_NUMBER environment variable is not configured." });
      }

      try {
        app.log.info({ to, reason }, "Ryan initiating outbound phone call via Twilio...");

        const twimlUrl = `${BASE_URL}/api/v1/voice/twiml?reason=${encodeURIComponent(
          reason
        )}&message=${encodeURIComponent(message)}`;
        const statusCallbackUrl = `${BASE_URL}/api/v1/voice/status`;

        const call = await twilioClient.calls.create({
          to,
          from: fromPhone,
          url: twimlUrl,
          statusCallback: statusCallbackUrl,
          statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
          statusCallbackMethod: "POST",
          timeLimit: 300,
        });

        activeCalls.set(call.sid, { reason, startTime: Date.now() });

        return reply.status(200).send({
          success: true,
          callSid: call.sid,
          status: call.status,
          recipient: to,
          agent: "RyanAI",
          timestamp: new Date().toISOString(),
        });
      } catch (error: unknown) {
        app.log.error(error, "Failed to trigger voice call via Twilio");
        return reply.status(500).send({
          success: false,
          error: "Twilio Telephony Dispatch Failed",
          details: getErrorMessage(error),
        });
      }
    }
  );

  app.get<{ Querystring: TwimlQuery }>(
    "/api/v1/voice/twiml",
    async (req: FastifyRequest<{ Querystring: TwimlQuery }>, reply: FastifyReply) => {
      const { message = "Hello, this is Ryan.", reason = "Notification" } = req.query;

      const twiml = new twilio.twiml.VoiceResponse();
      twiml.pause({ length: 1 });

      const gather = twiml.gather({
        input: ["dtmf", "speech"],
        timeout: 5,
        numDigits: 1,
        action: `${BASE_URL}/api/v1/voice/interactive`,
        method: "POST",
      });

      gather.say(
        { voice: "Polly.Matthew", language: "en-US" },
        `Greetings. This is Ryan, your system architect. Notification brief: ${reason}. ${message}. Press 1 or speak 'status' to review live telemetry. Press 2 to acknowledge.`
      );

      twiml.say({ voice: "Polly.Matthew" }, "No response detected. Goodbye.");
      twiml.hangup();

      reply.header("Content-Type", "text/xml");
      return reply.send(twiml.toString());
    }
  );

  app.post<{ Body: GatherBody }>(
    "/api/v1/voice/interactive",
    async (req: FastifyRequest<{ Body: GatherBody }>, reply: FastifyReply) => {
      const { Digits, SpeechResult } = req.body || {};
      const twiml = new twilio.twiml.VoiceResponse();

      const input = Digits || (SpeechResult ? SpeechResult.toLowerCase() : "");
      app.log.info({ input, Digits, SpeechResult }, "Received interactive input during call");

      if (input === "1" || input.includes("status") || input.includes("telemetry")) {
        twiml.say({ voice: "Polly.Matthew" }, "Live system telemetry is not available through this call.");
        twiml.pause({ length: 1 });
        twiml.say({ voice: "Polly.Matthew" }, "Acknowledged. Ending voice session. Have a productive session.");
        twiml.hangup();
      } else if (input === "2" || input.includes("acknowledge") || input.includes("ok")) {
        twiml.say(
          { voice: "Polly.Matthew" },
          "Acknowledged. This acknowledgement has not been forwarded to an external registry."
        );
        twiml.hangup();
      } else {
        twiml.say(
          { voice: "Polly.Matthew" },
          `Received unrecognized input. No external dispatch is configured.`
        );
        twiml.hangup();
      }

      reply.header("Content-Type", "text/xml");
      return reply.send(twiml.toString());
    }
  );

  return app;
}