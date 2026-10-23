// src/index.ts
import { RyanMCPServer } from "./mcp/ryanMcpServer.js";
import { buildServer } from "./server/routes/server.js";

async function main() {
  try {
    console.log("[RyanAI] Initializing autonomous reasoning platform...");

    // 1. Initialize and start the MCP Server on stdio
    const mcpServer = new RyanMCPServer();
    await mcpServer.start();
    console.log("[RyanAI MCP] Server started successfully on stdio.");

    // 2. Initialize and start the Fastify HTTP/WebSocket gateway
    const server = await buildServer();
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    const host = process.env.HOST || "0.0.0.0";

    await server.listen({ port, host });
    console.log(`[RyanAI Gateway] Autonomous Reasoning Gateway listening on http://${host}:${port}`);

  } catch (error) {
    console.error("[Fatal Error during startup]:", error);
    process.exit(1);
  }
}

main();