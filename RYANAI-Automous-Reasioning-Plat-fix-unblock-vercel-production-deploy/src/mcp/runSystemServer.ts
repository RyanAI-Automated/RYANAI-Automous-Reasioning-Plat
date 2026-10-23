import { SystemMcpServer } from "./systemServer.js";

const mcpServer = new SystemMcpServer();

const shutdown = async (signal: string) => {
  console.error(`Received ${signal}. Shutting down SystemMcpServer...`);
  try {
    await mcpServer.stop();
    process.exit(0);
  } catch (err) {
    console.error("Error during server shutdown:", err);
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

mcpServer.start().catch((err) => {
  // Always log errors to stderr in stdio MCP applications
  console.error("Fatal error starting SystemMcpServer:", err);
  process.exit(1);
});