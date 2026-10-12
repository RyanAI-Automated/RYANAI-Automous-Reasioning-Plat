import '../loadEnv.js';
import Fastify from 'fastify';
import fastifyRedis from '@fastify/redis';
import fastifyRateLimit from '@fastify/rate-limit';
import { installAuthentication, authPlugin } from './routes/auth.js';
import { reasonPlugin } from './routes/reason.js';
import { RyanMCPServer } from '../mcp/ryanMcpServer.js';

const server = Fastify({
  logger: true,
  pluginTimeout: 30000, // Increase Avvio plugin timeout to 30 seconds
});
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || '0.0.0.0';

// CORS middleware
server.addHook('onRequest', (req, reply, done) => {
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

await server.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });
installAuthentication(server);
server.register(authPlugin);

// Root endpoint
server.get('/', async () => {
  return {
    status: 'online',
    service: 'RyanAI API Gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  };
});

// Health check endpoint with live Redis ping
/**
 * Report API availability and a live Redis ping result.
 * The database field reports configuration only; failed Redis checks still return
 * an online API status.
 */
const healthCheck = async () => {
  let redisStatus = 'not-configured';
  try {
    if (server.redis) {
      await server.redis.ping();
      redisStatus = 'connected';
    }
  } catch {
    redisStatus = 'disconnected';
  }

  return {
    status: 'online',
    service: 'ryanai-api-gateway',
    database: process.env.DATABASE_URL ? 'configured' : 'not-configured',
    redis: redisStatus,
    cudaDevice: process.env.CUDA_DEVICE_ID || '0',
    engine: 'LangGraph ReAct',
    architect: 'RyanAI',
    cudaActive: false,
    activeGraph: 'reasoning-agent',
    timestamp: new Date().toISOString(),
  };
};

server.get('/health', healthCheck);
server.get('/api/health', healthCheck);

// Register plugins and feature routes
/**
 * Attempt Redis and reasoning-route registration and construct an MCP server.
 * Catch each initialization failure independently; do not start the MCP transport.
 */
async function setupRoutes() {
  // Register Redis plugin with graceful fallback and fail-fast connection timeout
  try {
    await server.register(fastifyRedis, {
      url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
      family: 4, // Forces IPv4 to prevent Windows socket resolution hangs
      connectTimeout: 5000, // Fail fast if unreachable
    });
    console.log('✓ Redis plugin registered successfully');
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      '⚠️ Redis connection skipped/failed; running without Redis cache:',
      errorMsg,
    );
  }

  try {
    // Register reasoning plugin routes
    await server.register(reasonPlugin);
    console.log('✓ Reasoning routes registered');
  } catch (err) {
    console.error('Failed to register reasoning routes:', err);
  }

  try {
    // Initialize MCP server instance
    const mcpServer = new RyanMCPServer();
    void mcpServer; // Suppress unused variable warning
    console.log('✓ RyanMCPServer initialized successfully');
  } catch (err) {
    console.error('Failed to initialize RyanMCPServer:', err);
  }
}

// Start server
async function startServer() {
  try {
    await setupRoutes();
    await server.listen({ port: PORT, host: HOST });
    console.log(`✓ RyanAI API Gateway listening on http://${HOST}:${PORT}`);
    console.log(`✓ Health check: http://${HOST}:${PORT}/health`);
    console.log(`✓ Reasoning endpoint: POST http://${HOST}:${PORT}/api/reason`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

startServer();
