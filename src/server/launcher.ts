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
import { assertProductionDependencies, resolveConnectionUrls, resolveRateLimitClientIp } from './startupConfig.js';
import { startupSummary } from './startupDiagnostics.js';
import { inspectReadiness } from './readiness.js';

import { API_ROUTES } from '../config/core.js';

import { invokeReasoningAgent } from '../agent/invoke.js';
import { startScheduler } from '../scheduler/runner.js';
import { startAlerts } from '../alerts/runner.js';
import { registerWebSocketRoutes } from '../api/websocket.js';
import { authPlugin, installAuthentication } from './routes/auth.js';
import { commsPlugin } from './comms/index.js';
import { approvalRoutes } from './routes/approvalRoutes.js';
import { engineeringEvidenceRoutes } from './routes/engineeringEvidenceRoutes.js';
import { slackInteractionsPlugin } from './routes/slackInteractions.js';
import { twilioWebhookPlugin } from './routes/twilioWebhook.js';
import { metricsRoutes } from './routes/metrics.js';
import { quantRoutes } from './routes/quantRoutes.js';
import { tasksRoutes } from './routes/tasks.js';
import { pendingActionsRoutes } from './routes/pendingActions.js';
import { jarvisRoutes } from './routes/jarvisRoutes.js';
import { internalJarvisRoutes } from './routes/internalJarvisRoutes.js';
import { internalOpenAiGatewayRoutes } from './routes/internalOpenAi.js';
import { registerPatchRoutes } from './routes/patchRoutes.js';
import { inspectDatabaseSchema } from './databaseSchema.js';
import { agentOperationsRoutes } from './routes/agentOperations.js';
import { realtimeVoiceRoutes } from './routes/realtimeVoice.js';
import { startAgentTaskWorker, startBrainHealthMonitor, type AgentRunProgressEvent } from '../agent/operations.js';
import { AgentPAScript, setAgentPAObserver } from '../skills/agentPAScript.js';
import { startAttachmentScanner } from './attachments/scanner.js';
import { startAttachmentOrphanCleanup } from './attachments/orphanCleanup.js';

const { Pool } = pg;

console.log('🚀 RyanAI Platform Initialization');
console.log('==================================\n');

// Configuration
const nodeEnv = process.env.NODE_ENV || 'production';
const connectionUrls = resolveConnectionUrls(
  nodeEnv,
  process.env.DATABASE_URL,
  process.env.REDIS_URL,
);
const config = {
  port: parseInt(
    process.env.PORT ||
      (nodeEnv === 'development' ? '3001' : '3000'),
    10,
  ),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv,
  database: { url: connectionUrls.databaseUrl },
  redis: { url: connectionUrls.redisUrl },
};

console.log(`📋 Configuration:`);
console.log(`    - Node Env: ${config.nodeEnv}`);
console.log(`    - Host: ${config.host}:${config.port}`);
console.log(
  `    - Database: ${process.env.DATABASE_URL ? 'URL supplied' : 'Local development/test default'} (connection not yet checked)`,
);
console.log(
  `    - Redis: ${process.env.REDIS_URL ? 'URL supplied' : 'Local development/test default'} (connection not yet checked)\n`,
);

// Do not trust X-Forwarded-For. Rate limiting uses the single-value Cloudflare
// client-IP header only when accompanied by CF-Ray; otherwise it uses the socket peer.
const fastify = Fastify({
  trustProxy: false,
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

// Register CORS with an explicit origin allowlist. Reflecting every Origin while
// allowing credentials would let arbitrary websites make authenticated API calls.
const configuredCorsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedCorsOrigins = new Set(configuredCorsOrigins);

if (process.env.NODE_ENV !== 'production') {
  [
    'http://localhost:1420',
    'http://127.0.0.1:1420',
    'http://localhost:9090',
    'http://127.0.0.1:9090',
  ].forEach((origin) => allowedCorsOrigins.add(origin));
}

await fastify.register(fastifyCors, {
  origin: (origin, callback) => {
    if (!origin || allowedCorsOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
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
  applicationSchema: false,
  api: false,
};

// ============================================================================
// API ROUTES REGISTRATION
// ============================================================================

function registerCoreRoutes() {
  const healthCheck = async (_request: FastifyRequest, reply: FastifyReply) => {
    const readiness = await inspectReadiness({
      database: async () => {
        if (!dbPool) throw new Error('PostgreSQL pool is unavailable');
        await dbPool.query('SELECT 1');
      },
      redis: async () => {
        await fastify.redis.ping();
      },
      agentCheckpointerInitialized: serviceStatus.agentCheckpointer,
      applicationSchemaInitialized: serviceStatus.applicationSchema,
      apiListening: serviceStatus.api,
    });
    reply.code(readiness.ready ? 200 : 503);
    return {
      status: readiness.ready ? 'online' : 'degraded',
      service: 'ryanai-api-gateway',
      timestamp: new Date().toISOString(),
      services: readiness.services,
      engine: 'LangGraph ReAct',
      architect: 'RyanAI',
      cudaActive: false,
      activeGraph: 'reasoning-agent',
    };
  };

  // Liveness is deliberately independent of dependency readiness.
  fastify.get('/livez', async () => ({
    status: 'alive',
    service: 'ryanai-api-gateway',
    timestamp: new Date().toISOString(),
  }));

  // Readiness probes live PostgreSQL and Redis connections on every request.
  fastify.get('/readyz', healthCheck);

  // Collision-free health check registrations; legacy paths remain readiness aliases.
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
    language?: string,
    onProgress?: (event: AgentRunProgressEvent) => void,
  ) {
    const result = await invokeReasoningAgent({ prompt, model, user, language, onProgress });
    const reasoningTrace = result.messages.map(
      (message: { content: unknown }) => contentToText(message.content),
    );
    const output = reasoningTrace.at(-1) ?? '';

    return {
      success: true,
      objective: prompt,
      output,
      reasoningTrace,
      engine: result.engine ?? 'RyanAI Three-Brain Orchestrator',
      response: output,
      trace: reasoningTrace,
      runId: result.runId,
      handoffs: result.handoffs,
      timestamp: new Date().toISOString(),
    };
  }

  const reasoningBodySchema = {
    body: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 20000 },
        model: { type: 'string', maxLength: 100 },
        sessionId: { type: 'string', maxLength: 200 },
        language: { type: 'string', maxLength: 16 },
      },
    },
  };

  const handleReasoningRequest = async (
    request: FastifyRequest<{ Body: { prompt?: string; model?: string; language?: string } }>,
    reply: FastifyReply,
  ) => {
    if (!request.authUser?.id) {
      return reply.code(401).send({
        success: false,
        error: 'Sign in to use traceable three-brain reasoning.',
      });
    }
    const prompt = request.body?.prompt?.trim();
    if (!prompt) {
      return reply
        .code(400)
        .send({ success: false, error: 'A non-empty prompt is required' });
    }

    try {
      return await runReasoning(prompt, request.body?.model, request.authUser, request.body?.language);
    } catch (err) {
      fastify.log.error({ err }, 'Reasoning request failed');
      return reply.code(502).send({
        success: false,
        error: 'Reasoning provider request failed. Please try again later.',
      });
    }
  };

  // Collision-free reasoning endpoint registrations
  fastify.post<{ Body: { prompt?: string; model?: string; language?: string } }>(
    API_ROUTES.reasonPath,
    { schema: reasoningBodySchema },
    handleReasoningRequest,
  );
  if (API_ROUTES.reasonPath !== '/api/reason') {
    fastify.post<{ Body: { prompt?: string; model?: string; language?: string } }>(
      '/api/reason',
      { schema: reasoningBodySchema },
      handleReasoningRequest,
    );
  }

  // Reasoning stream endpoint
  fastify.post<{
    Body: { prompt?: string; sessionId?: string; model?: string; language?: string };
  }>(API_ROUTES.streamPath, { schema: reasoningBodySchema }, async (request, reply) => {
    if (!request.authUser?.id) {
      return reply.code(401).send({
        success: false,
        error: 'Sign in to use traceable three-brain reasoning.',
      });
    }
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
      const result = await runReasoning(
        prompt,
        request.body?.model,
        request.authUser,
        request.body?.language,
        (progress) => sendEvent({
          status: 'processing',
          message: 'Persisted brain handoff state changed.',
          runId: progress.runId,
          runStatus: progress.status,
          handoffs: progress.handoffs.map(({ fromAgent, toAgent, status, startedAt, completedAt, error }) => ({
            fromAgent, toAgent, status, startedAt, completedAt, error,
          })),
        }),
      );
      sendEvent({
        status: 'complete',
        result: result.output,
        reasoningTrace: result.reasoningTrace,
        runId: result.runId,
        handoffs: result.handoffs,
      });
    } catch (err: unknown) {
      fastify.log.error({ err }, 'Streaming reasoning request failed');
      sendEvent({
        error: 'Reasoning provider request failed. Please try again later.',
      });
    } finally {
      if (!raw.writableEnded) {
        raw.end();
      }
    }
  });

  // This legacy route previously echoed a requested tool/action and returned
  // success without executing anything. Fail explicitly instead of reporting a
  // false success; real MCP calls belong on the dedicated Streamable HTTP server.
  fastify.post<{
    Body: { action?: string; tool?: string; payload?: Record<string, unknown> };
  }>('/api/mcp', async (request, reply) => {
    const { action, tool } = request.body || {};

    if (!action && !tool) {
      return reply
        .code(400)
        .send({ success: false, error: 'Missing action or tool parameter' });
    }

    return reply.code(501).send({
      success: false,
      error: 'MCP tool execution is not available through this legacy API route. Use the dedicated Streamable HTTP MCP service at /mcp.',
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
    const schema = await inspectDatabaseSchema((sql) => dbPool!.query(sql));

    if (!schema.communications) {
      throw new Error(
        'Required communication schema is missing. Run npm run db:migrate before starting the API.',
      );
    }

    console.log(`✓ Database connected: ${result.rows[0].now}`);
    serviceStatus.database = true;
    serviceStatus.agentCheckpointer = schema.agentCheckpointer;
    serviceStatus.applicationSchema = schema.applicationSchema;

    if (!schema.applicationSchema) {
      console.warn('⚠️ Required Prisma application migrations are missing. Run npm run db:migrate before enabling production API traffic.');
    }

    if (!schema.agentCheckpointer) {
      console.warn(
        '⚠️ Agent checkpointer schema is not prepared. Run npm run db:migrate before enabling agent execution.',
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
  } catch {
    console.error(
      `✗ Redis connection failed:`,
      'Redis health probe failed. Raw error details are omitted to protect credentials.',
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
    keyGenerator: (request) => resolveRateLimitClientIp(
      request.headers['cf-connecting-ip'],
      request.headers['cf-ray'],
      request.ip,
    ),
  });

  // 2. Register WebSocket routes after rate-limiting and redis are fully decorated
  await registerWebSocketRoutes(fastify);

  registerCoreRoutes();

  // 3. Register Application & Webhook Routes
  await fastify.register(authPlugin);
  await fastify.register(commsPlugin);
  await fastify.register(approvalRoutes);
  await fastify.register(engineeringEvidenceRoutes);
  await fastify.register(slackInteractionsPlugin);
  await fastify.register(twilioWebhookPlugin);
  await fastify.register(metricsRoutes);
  await fastify.register(quantRoutes);
  await fastify.register(tasksRoutes);
  await fastify.register(agentOperationsRoutes);
  await fastify.register(realtimeVoiceRoutes);
  await fastify.register(pendingActionsRoutes);
  await fastify.register(jarvisRoutes);
  await fastify.register(internalJarvisRoutes);
  await fastify.register(internalOpenAiGatewayRoutes);
  await fastify.register(registerPatchRoutes);
}

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function start() {
  try {
    // Probe PostgreSQL before Redis/plugin registration. A Redis failure must
    // never prevent us from independently verifying and reporting the database.
    console.log('\n📡 Verifying PostgreSQL before plugin registration...\n');
    const databaseReady = await initializeDatabase();

    console.log('\n🔧 Registering Plugins and verifying Redis...\n');
    let redisReady = false;
    try {
      await registerPlugins();
      redisReady = await verifyRedis();
    } catch {
      // Redis URLs and client errors can contain credentials. connectRedis
      // already emits a sanitized diagnostic; do not log a raw plugin error.
      fastify.log.error(
        'Redis/plugin initialization failed. Raw connection details are omitted to protect credentials.',
      );
    }

    assertProductionDependencies(config.nodeEnv, {
      database: databaseReady,
      redis: redisReady,
      agentCheckpointer: serviceStatus.agentCheckpointer,
      applicationSchema: serviceStatus.applicationSchema,
    });
    if (!redisReady) {
      throw new Error('Startup blocked: Redis did not pass its live connectivity check.');
    }

    console.log(`\n🚀 Starting Fastify Server...\n`);
    await fastify.listen({ port: config.port, host: config.host });

    serviceStatus.api = true;

    console.log(`\n✓ RyanAI API Gateway is running!`);
    console.log(`\n📍 Endpoints:`);
    console.log(`    - Root: http://${config.host}:${config.port}/`);
    console.log(`    - Health: http://${config.host}:${config.port}/health`);
    console.log(`    - System: http://${config.host}:${config.port}/api/system`);
    console.log(`    - Authentication: Supabase Auth`);
    console.log(`\n${startupSummary(serviceStatus)}\n`);
    stopBrainMonitor = startBrainHealthMonitor();
    if (serviceStatus.database) stopAgentWorker = startAgentTaskWorker();

    // PA is a read-only observer: it reports real API/PostgreSQL/Redis probes
    // and has no task dispatch, messaging, file-edit or privileged capabilities.
    const paObserver = new AgentPAScript({
      fastifyPort: config.port,
      heartbeatIntervalMs: Number(process.env.PA_HEARTBEAT_INTERVAL_MS ?? 15000),
      healthCheck: async () => {
        const [database, redis] = await Promise.allSettled([
          dbPool.query('SELECT 1'),
          fastify.redis.ping(),
        ]);
        return {
          api: fastify.server.listening,
          database: database.status === 'fulfilled',
          redis: redis.status === 'fulfilled' && redis.value === 'PONG',
        };
      },
    });
    paObserver.on('report', (report) => fastify.log.info({ pa: report }, 'PA observer report'));
    paObserver.on('healthCheckFailed', (report) => fastify.log.warn({ pa: report }, 'PA observer health degraded'));
    await paObserver.start();
    setAgentPAObserver(paObserver);
    stopAgentPA = () => { void paObserver.stop().finally(() => setAgentPAObserver(null)); };
    else fastify.log.warn('Durable agent task worker disabled because PostgreSQL is unavailable.');

    if (process.env.ATTACHMENT_SCANNER_ENABLED === 'true') {
      stopAttachmentScanner = startAttachmentScanner();
    }
    if (process.env.ATTACHMENT_ORPHAN_CLEANUP_ENABLED === 'true') {
      stopAttachmentOrphanCleanup = startAttachmentOrphanCleanup();
    }

    // Scheduled tasks start AI runs with no person present, and those runs cost
    // money. Turn them on with an explicit setting.
    if (process.env.SCHEDULER_ENABLED === 'true') {
      stopScheduler = startScheduler();
    }

    // Alerts send messages to the owner with no person present. Turn them on
    // with an explicit setting. A setting that cannot work stops the start with
    // a clear error, so a typo never leaves you without alerts.
    if (process.env.ALERTS_ENABLED === 'true') {
      stopAlerts = startAlerts();
    }
  } catch (err) {
    fastify.log.fatal(err);
    process.exit(1);
  }
}

// Graceful shutdown hooks
let stopScheduler: (() => void) | undefined;
let stopBrainMonitor: (() => void) | undefined;
let stopAgentWorker: (() => void) | undefined;
let stopAttachmentScanner: (() => void) | undefined;
let stopAttachmentOrphanCleanup: (() => void) | undefined;
let stopAlerts: (() => void) | undefined;
let stopAgentPA: (() => void) | undefined;
const shutdown = async () => {
  console.log('\n📴 Shutting down gracefully...');
  stopScheduler?.();
  stopBrainMonitor?.();
  stopAgentWorker?.();
  stopAttachmentScanner?.();
  stopAttachmentOrphanCleanup?.();
  stopAlerts?.();
  stopAgentPA?.();
  if (dbPool) await dbPool.end();
  if (prisma) await prisma.$disconnect();
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();