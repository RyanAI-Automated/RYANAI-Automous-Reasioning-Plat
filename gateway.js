import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import Redis from 'ioredis';

// 1. Initialize Fastify with structured logging
const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' }
    }
  }
});

// 2. State Checkpointing (LangGraph Persistence)
// This Redis instance must be running locally to store agent state
const redis = new Redis({
  host: '127.0.0.1',
  port: 6379,
  maxRetriesPerRequest: 3
});

// 3. Register CORS for Vercel Frontend Integration
await fastify.register(cors, {
  // Allow your Vercel URL and local dev environment
  origin: ['https://ryanai-automous-reasioning-plat.vercel.app', 'http://localhost:3000'],
  methods: ['GET', 'POST']
});

// 4. Register WebSocket Support for Real-Time Console Telemetry
// Caps payload size at 1MB to prevent memory exhaustion
await fastify.register(websocket, {
  options: { maxPayload: 1048576 } 
});

// --- ROUTES ---

// A. Real-Time Console Telemetry Stream (WebSocket)
fastify.get('/api/telemetry/stream', { websocket: true }, (socket, req) => {
  fastify.log.info('Vercel frontend connected to telemetry stream');
  
  // Subscribe to a local Redis channel where LangGraph and eBPF publish events
  const subscriber = new Redis();
  subscriber.subscribe('system_telemetry', 'langgraph_events');

  subscriber.on('message', (channel, message) => {
    // Push real-time thought loops and audit logs to the frontend console
    socket.send(JSON.stringify({ channel, payload: JSON.parse(message) }));
  });

  socket.on('message', (msg) => {
    // Handle incoming control commands from the Vercel UI
    fastify.log.info(`Received control command: ${msg}`);
  });

  socket.on('close', () => {
    subscriber.quit();
    fastify.log.info('Vercel frontend disconnected');
  });
});

// B. CUDA C++ Inference Bridge (REST)
fastify.post('/api/inference/execute', async (request, reply) => {
  const { prompt, agentId } = request.body;
  
  try {
    // Route this to your local Nvidia Nemotron or CUDA C++ binary
    // const result = await executeCudaBinary(prompt);
    
    // Persist interaction state in Redis for LangGraph
    await redis.set(`agent:${agentId}:last_prompt`, prompt);
    
    return reply.send({ status: 'success', output: "CUDA inference executed successfully." });
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Inference engine failure' });
  }
});

// C. eBPF Security Guardrails Audit Sink
// Grafana Alloy or Loki forwards audit logs here, which are broadcast to the UI
fastify.post('/api/audit/sink', async (request, reply) => {
  const auditLog = request.body;
  
  // Publish to Redis so the WebSocket stream picks it up and sends it to Vercel
  await redis.publish('system_telemetry', JSON.stringify({ type: 'eBPF_alert', data: auditLog }));
  
  return reply.send({ status: 'logged' });
});

// --- STARTUP ---
const start = async () => {
  try {
    // Listen on all interfaces so Cloudflare Tunnel or ngrok can route to it
    await fastify.listen({ port: 8080, host: '0.0.0.0' });
    fastify.log.info(`Gateway active. Expose port 8080 via Cloudflare Tunnel to connect Vercel.`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
