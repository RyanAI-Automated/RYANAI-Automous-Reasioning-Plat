// Load local configuration before tracing and application imports.
import '../loadEnv.js';

// Tracing must precede application imports.
import '../instrument.js';
import '../telemetry.js';

import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyRedis from '@fastify/redis';
import fastifyRateLimit from '@fastify/rate-limit';
import pg from 'pg';
import { connectRedis } from './connectRedis.js';
import {
  databaseFailureDiagnostic,
  startupSummary,
} from './startupDiagnostics.js';

import { API_ROUTES } from '../config/core.js';

import { getReasoningAgent } from '../agent/engine.js';
import { registerWebSocketRoutes } from '../api/websocket.js';
import { authPlugin, installAuthentication } from './routes/auth.js';
import { commsPlugin } from './comms/index.js';
import { approvalRoutes } from './routes/approvalRoutes.js';
import { slackInteractionsPlugin } from './routes/slackInteractions.js';
import { twilioWebhookPlugin } from './routes/twilioWebhook.js';
import { metricsRoutes } from './routes/metrics.js';
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
console.log(`   - Node Env: ${config.nodeEnv}`);
console.log(`   - Host: ${config.host}:${config.port}`);
console.log(
  `   - Database: ${process.env.DATABASE_URL ? 'URL supplied' : 'Local default'} (connection not yet checked)`,
);
console.log(
  `   - Redis: ${process.env.REDIS_URL ? 'URL supplied' : 'Unauthenticated local default'} (connection not yet checked)\n`,
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

// CORS Hook
fastify.addHook('onRequest', (req, reply, done) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS',
  );
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    reply.code(200).send();
    return;
  }
  done();
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
// MIDDLEWARE & PLUGINS INITIALIZATION
// ============================================================================

async function registerPlugins() {
  // Check readiness before Avvio's plugin timeout obscures connection failures.
  const redis = await connectRedis(config.redis.url);
  await fastify.register(fastifyRedis, {
    client: redis,
    closeClient: true,
  });

  // 2. Register Global Rate Limiter backed by Redis
  await fastify.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    redis: fastify.redis,
  });

  // Register routes only after rate-limit's onRoute hook is installed.
  await fastify.register(fastifyWebsocket);
  await registerWebSocketRoutes(fastify);
  registerCoreRoutes();

  // 3. Register Application & Webhook Routes
  await fastify.register(authPlugin);
  await fastify.register(commsPlugin);
  await fastify.register(approvalRoutes);
  await fastify.register(slackInteractionsPlugin);
  await fastify.register(twilioWebhookPlugin);
  await fastify.register(metricsRoutes);
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

    // Initialize LangGraph PostgresSaver checkpointer tables
    try {
      await initializeAgentDatabase();
      serviceStatus.agentCheckpointer = true;
    } catch (agentErr) {
      console.warn(
        '⚠️ Agent PostgresSaver checkpointer setup deferred/failed:',
        databaseFailureDiagnostic(agentErr),
      );
    }

    return true;
  } catch (err) {
    console.error(
      `✗ Database connection failed:`,
      databaseFailureDiagnostic(err),
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
// API ROUTES
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

<<<<<<< HEAD
fastify.get('/health', healthCheck);
fastify.get(API_ROUTES.healthPath, healthCheck);
=======
  fastify.get('/health', healthCheck);
  fastify.get('/api/health', healthCheck);
>>>>>>> 46f6e7a (fix(auth): enforce rate limits before provider verification)

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

  async function runReasoning(prompt: string, model?: string) {
    const result = await getReasoningAgent(model).invoke({
      messages: [{ role: 'user', content: prompt }],
    });
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

  fastify.post<{ Body: { prompt?: string; model?: string } }>(
    '/api/reason',
    async (request, reply) => {
      const prompt = request.body?.prompt?.trim();
      if (!prompt) {
        return reply
          .code(400)
          .send({ success: false, error: 'A non-empty prompt is required' });
      }

      try {
        return await runReasoning(prompt, request.body?.model);
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
    },
  );

<<<<<<< HEAD
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

fastify.post<{ Body: { prompt?: string; model?: string } }>(
  API_ROUTES.reasonPath,
  async (request, reply) => {
    const prompt = request.body?.prompt?.trim();
    if (!prompt) {
      return reply
        .code(400)
        .send({ success: false, error: 'A non-empty prompt is required' });
    }

    try {
      return await runReasoning(prompt, request.body?.model);
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
  },
);

// Reasoning stream endpoint
fastify.post<{ Body: { prompt?: string; sessionId?: string; model?: string } }>(
  API_ROUTES.streamPath,
  async (request, reply) => {
=======
  // Reasoning stream endpoint
  fastify.post<{
    Body: { prompt?: string; sessionId?: string; model?: string };
  }>('/api/reasoning/stream', async (request, reply) => {
>>>>>>> 46f6e7a (fix(auth): enforce rate limits before provider verification)
    const prompt = request.body?.prompt?.trim();
    const { sessionId } = request.body || {};
    if (!prompt) {
      return reply
        .code(400)
        .send({ success: false, error: 'A non-empty prompt is required' });
    }

    reply.hijack();
    const { raw } = reply;

    // Hijacking bypasses Fastify's header flush, including the CORS hook.
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
      const result = await runReasoning(prompt, request.body?.model);
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
    console.log(`   - Root: http://${config.host}:${config.port}/`);
    console.log(`   - Health: http://${config.host}:${config.port}/health`);
    console.log(
      `   - Sentry Test: http://${config.host}:${config.port}/debug-sentry`,
    );
    console.log(`   - System: http://${config.host}:${config.port}/api/system`);
    console.log(
      `   - Sign-in: Supabase Auth (use the frontend Sign in / Create account screens)`,
    );
    console.log(
      `   - Auth Verify: GET http://${config.host}:${config.port}/api/auth/verify`,
    );
    console.log(
      `   - Reason: POST http://${config.host}:${config.port}${API_ROUTES.reasonPath}`,
    );
    console.log(
      `   - Stream: POST http://${config.host}:${config.port}${API_ROUTES.streamPath}`,
    );
    console.log(`   - MCP: POST http://${config.host}:${config.port}/api/mcp`);
    console.log(
      `   - Approval: POST http://${config.host}:${config.port}/api/reason/with-approval`,
    );
    console.log(
      `   - Approve: POST http://${config.host}:${config.port}/api/reason/approve`,
    );
    console.log(
      `   - Slack Interactions: POST http://${config.host}:${config.port}/api/slack/interactions`,
    );
    console.log(
      `   - Twilio Webhook: POST http://${config.host}:${config.port}/api/webhooks/twilio`,
    );
    console.log(
      `   - Admin Metrics: GET http://${config.host}:${config.port}/api/admin/metrics`,
    );
    serviceStatus.api = true;
    const summary = startupSummary(serviceStatus);
    if (
      serviceStatus.database &&
      serviceStatus.redis &&
      serviceStatus.agentCheckpointer
    ) {
      console.log(`\n${summary}\n`);
    } else {
      console.warn(`\n${summary}\n`);
    }
  } catch (err) {
    fastify.log.fatal(err);
    process.exit(1);
  }
}

// Graceful shutdown hooks
const shutdown = async () => {
  console.log('\n📴 Shutting down gracefully...');
  if (dbPool) await dbPool.end();
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
