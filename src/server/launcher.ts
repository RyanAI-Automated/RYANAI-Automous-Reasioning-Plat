// Load local configuration before tracing and application imports.
import '../loadEnv.js';

// Tracing must precede application imports.
import '../instrument.js';
import '../telemetry.js';

import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyRedis from '@fastify/redis';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCors from '@fastify/cors';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { connectRedis } from './connectRedis.js';
import { databaseFailureDiagnostic } from './startupDiagnostics.js';

import { API_ROUTES } from '../config/core.js';

import { invokeReasoningAgent } from '../agent/invoke.js';
import { startScheduler } from '../scheduler/runner.js';
import { registerWebSocketRoutes } from '../api/websocket.js';
import { authPlugin, installAuthentication } from './routes/auth.js';
import authSigninRoute from '../api/auth/signin.js';
import { commsPlugin } from './comms/index.js';
import { approvalRoutes } from './routes/approvalRoutes.js';
import { slackInteractionsPlugin } from './routes/slackInteractions.js';
import { twilioWebhookPlugin } from './routes/twilioWebhook.js';
import { metricsRoutes } from './routes/metrics.js';
import { tasksRoutes } from './routes/tasks.js';
import { initializeAgentDatabase } from '../agent/approvalEngine.js';

const { Pool } = pg;

console.log('🚀 RyanAI Platform Initialization');
console.log('==================================\n');

// Configuration
const config = {
  port: parseInt(
    process.env.PORT ||
      (process.env.NODE_ENV === 'development' ? '3001' : '3000'),
    10,
  ),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'production',
  database: {
    url:
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/ryanai',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
};

console.log(`📋 Configuration:`);
console.log(`    - Node Env: ${config.nodeEnv}`);
console.log(`    - Host: ${config.host}:${config.port}`);
console.log(
  `    - Database: ${process.env.DATABASE_URL ? 'URL supplied' : 'Local default'} (connection not yet checked)`,
);
console.log(
  `    - Redis: ${process.env.REDIS_URL ? 'URL supplied' : 'Unauthenticated local default'} (connection not yet checked)\n`,
);

// Initialize Fastify instance with trustProxy and telemetry-aware logger
const fastify = Fastify({
  trustProxy: true,
  logger: {
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
    ...(config.nodeEnv !== 'production' && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
        },
      },
    }),
  },
});

// Initialize and decorate Prisma Client
const prisma = new PrismaClient();
fastify.decorate('prisma', prisma);

// Register CORS Plugin
await fastify.register(fastifyCors, {
  origin: true,
  credentials: true,
});

installAuthentication(fastify);

// Database pool
let dbPool: pg.Pool;

// Service health status
const serviceStatus = {
  database: false,
  redis: false,
  agentCheckpointer: false,
  api: false,
};

// ============================================================================
// API ROUTES REGISTRATION
// ============================================================================

function registerCoreRoutes() {
  const healthCheck = async (_request: FastifyRequest, reply: FastifyReply) => {
    const healthy =
      serviceStatus.database && serviceStatus.redis && serviceStatus.api;
    reply.code(healthy ? 200 : 503);
    return {
      status: healthy ? 'online' : 'degraded',
      service: 'ryanai-api-gateway',
      timestamp: new Date().toISOString(),
      services: serviceStatus,
      engine: 'LangGraph ReAct',
      architect: 'RyanAI',
      cudaActive: false,
      activeGraph: 'reasoning-agent',
    };
  };

  // Collision-free health check registrations
  fastify.get('/health', healthCheck);
  if ((API_ROUTES.healthPath as string) !== '/health') {
    fastify.get(API_ROUTES.healthPath, healthCheck);
  }
  if ((API_ROUTES.healthPath as string) !== '/api/health') {
    fastify.get('/api/health', healthCheck);
  }

  // Sentry integration test route
  fastify.get('/debug-sentry', async () => {
    throw new Error('RyanAI Sentry Integration Test Exception!');
  });

  // Root
  fastify.get('/', async () => {
    return {
      status: 'online',
      service: 'RyanAI API Gateway',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  });

  function contentToText(content: unknown): string {
    if (typeof content === 'string') return content;
    return JSON.stringify(content) ?? String(content);
  }

  async function runReasoning(
    prompt: string,
    model?: string,
    user?: FastifyRequest['authUser'],
  ) {
    const result = await invokeReasoningAgent({ prompt, model, user });
    const reasoningTrace = result.messages.map(
      (message: { content: unknown }) => contentToText(message.content),
    );
    const output = reasoningTrace.at(-1) ?? '';

    return {
      success: true,
      objective: prompt,
      output,
      reasoningTrace,
      engine: 'RyanAI LangGraph ReAct',
      response: output,
      trace: reasoningTrace,
      timestamp: new Date().toISOString(),
    };
  }

  const handleReasoningRequest = async (
    request: FastifyRequest<{ Body: { prompt?: string; model?: string } }>,
    reply: FastifyReply,
  ) => {
    const prompt = request.body?.prompt?.trim();
    if (!prompt) {
      return reply
        .code(400)
        .send({ success: false, error: 'A non-empty prompt is required' });
    }

    try {
      return await runReasoning(prompt, request.body?.model, request.authUser);
    } catch (err) {
      fastify.log.error({ err }, 'Reasoning request failed');
      return reply.code(502).send({
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reasoning provider request failed',
      });
    }
  };

  // Collision-free reasoning endpoint registrations
  fastify.post<{ Body: { prompt?: string; model?: string } }>(
    API_ROUTES.reasonPath,
    handleReasoningRequest,
  );
  if (API_ROUTES.reasonPath !== '/api/reason') {
    fastify.post<{ Body: { prompt?: string; model?: string } }>(
      '/api/reason',
      handleReasoningRequest,
    );
  }

  // Reasoning stream endpoint
  fastify.post<{
    Body: { prompt?: string; sessionId?: string; model?: string };
  }>(API_ROUTES.streamPath, async (request, reply) => {
    const prompt = request.body?.prompt?.trim();
    const { sessionId } = request.body || {};
    if (!prompt) {
      return reply
        .code(400)
        .send({ success: false, error: 'A non-empty prompt is required' });
    }

    reply.hijack();
    const { raw } = reply;

    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) raw.setHeader(name, value);
    }
    raw.setHeader('Content-Type', 'text/event-stream');
    raw.setHeader('Cache-Control', 'no-cache, no-transform');
    raw.setHeader('Connection', 'keep-alive');
    raw.setHeader('X-Accel-Buffering', 'no');

    let isDisconnected = false;
    raw.on('close', () => {
      isDisconnected = true;
    });

    const sendEvent = (data: Record<string, unknown>) => {
      if (!isDisconnected && !raw.writableEnded) {
        raw.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      sendEvent({
        status: 'processing',
        message: `Running reasoning for ${sessionId || 'default'}...`,
      });
      const result = await runReasoning(prompt, request.body?.model, request.authUser);
      sendEvent({
        status: 'complete',
        result: result.output,
        reasoningTrace: result.reasoningTrace,
      });
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Internal Server Error';
      fastify.log.error({ err }, 'Streaming reasoning request failed');
      sendEvent({ error: errorMessage });
    } finally {
      if (!raw.writableEnded) {
        raw.end();
      }
    }
  });

  // MCP routes
  fastify.post<{
    Body: { action?: string; tool?: string; payload?: Record<string, unknown> };
  }>('/api/mcp', async (request, reply) => {
    const { action, tool, payload } = request.body || {};

    if (!action && !tool) {
      return reply
        .code(400)
        .send({ success: false, error: 'Missing action or tool parameter' });
    }

    return reply.send({
      success: true,
      data: {
        receivedAction: action,
        receivedTool: tool,
        processedPayload: payload ?? {},
      },
    });
  });

  // System info
  fastify.get('/api/system', async () => {
    return {
      platform: process.platform,
      nodeVersion: process.version,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      env: config.nodeEnv,
    };
  });
}

// ============================================================================
// INITIALIZATION FUNCTIONS
// ============================================================================

async function initializeDatabase() {
  console.log('📡 Initializing Database...');
  try {
    dbPool = new Pool({
      connectionString: config.database.url,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    const result = await dbPool.query('SELECT NOW()');

    console.log(`✓ Database connected: ${result.rows[0].now}`);
    serviceStatus.database = true;

    try {
      await initializeAgentDatabase();
      serviceStatus.agentCheckpointer = true;
    } catch (agentErr) {
      console.warn(
        '⚠️ Agent PostgresSaver checkpointer setup deferred/failed:',
        databaseFailureDiagnostic(agentErr),
        agentErr instanceof Error ? agentErr.message : agentErr,
      );
    }

    return true;
  } catch (err) {
    console.error(
      `✗ Database connection failed:`,
      databaseFailureDiagnostic(err),
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

async function verifyRedis() {
  console.log('⚡ Initializing Redis...');
  try {
    const pong = await fastify.redis.ping();
    console.log(`✓ Redis connected: ${pong}`);
    serviceStatus.redis = true;
    return true;
  } catch (err) {
    console.error(
      `✗ Redis connection failed:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

// ============================================================================
// MIDDLEWARE & PLUGINS INITIALIZATION
// ============================================================================

async function registerPlugins() {
  const redis = await connectRedis(config.redis.url);

  // 1. Register foundational Fastify plugins first (Websocket, Redis, Rate Limit)
  await fastify.register(fastifyWebsocket);

  await fastify.register(fastifyRedis, {
    client: redis,
    closeClient: true,
  });

  await fastify.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    redis: fastify.redis,
  });

  // 2. Register WebSocket routes after rate-limiting and redis are fully decorated
  await registerWebSocketRoutes(fastify);

  registerCoreRoutes();

  // 3. Register Application & Webhook Routes
  await fastify.register(authPlugin);
  await fastify.register(authSigninRoute);
  await fastify.register(commsPlugin);
  await fastify.register(approvalRoutes);
  await fastify.register(slackInteractionsPlugin);
  await fastify.register(twilioWebhookPlugin);
  await fastify.register(metricsRoutes);
  await fastify.register(tasksRoutes);
}

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function start() {
  try {
    console.log('\n🔧 Registering Plugins...\n');
    await registerPlugins();

    console.log('\n📡 Connecting Services...\n');
    await initializeDatabase();
    await verifyRedis();

    console.log(`\n🚀 Starting Fastify Server...\n`);
    await fastify.listen({ port: config.port, host: config.host });

    console.log(`\n✓ RyanAI API Gateway is running!`);
    console.log(`\n📍 Endpoints:`);
    console.log(`    - Root: http://${config.host}:${config.port}/`);
    console.log(`    - Health: http://${config.host}:${config.port}/health`);
    console.log(`    - System: http://${config.host}:${config.port}/api/system`);
    console.log(`    - Signin: http://${config.host}:${config.port}/signin`);
    console.log(`\n🟢 All services ready!\n`);

    serviceStatus.api = true;

    // Scheduled tasks start AI runs with no person present, and those runs cost
    // money. Turn them on with an explicit setting.
    if (process.env.SCHEDULER_ENABLED === 'true') {
      stopScheduler = startScheduler();
    }
  } catch (err) {
    fastify.log.fatal(err);
    process.exit(1);
  }
}

// Graceful shutdown hooks
let stopScheduler: (() => void) | undefined;
const shutdown = async () => {
  console.log('\n📴 Shutting down gracefully...');
  stopScheduler?.();
  if (dbPool) await dbPool.end();
  if (prisma) await prisma.$disconnect();
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();