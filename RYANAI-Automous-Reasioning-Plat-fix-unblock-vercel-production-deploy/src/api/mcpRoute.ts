import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface McpPayload {
  tool?: string;
  action?: string;
  arguments?: {
    container?: string;
  };
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Register MCP status, payload echo, and Docker log retrieval endpoints.
 * Log retrieval returns the last 50 lines; command failures become HTTP 500 responses.
 */
export async function registerMcpRoutes(fastify: FastifyInstance): Promise<void> {
  // Status check endpoint
  fastify.get('/api/mcp', async () => ({ 
    status: 'active', 
    protocol: 'Model Context Protocol' 
  }));

  // Execute specific tool actions via HTTP API
  fastify.post("/api/mcp/execute", async (req: FastifyRequest<{ Body: McpPayload }>, reply: FastifyReply) => {
    const { tool, arguments: args } = req.body;

    if (!tool) {
      return reply.code(400).send({ success: false, error: "Missing tool parameter" });
    }

    if (tool === "check_system_logs" || tool === "get_container_logs") {
      try {
        const container = args?.container || "ryanai-runtime";
        
        // Basic input sanitization to prevent command injection
        if (!/^[a-zA-Z0-9_.-]+$/.test(container)) {
          return reply.code(400).send({ success: false, error: "Invalid container name format" });
        }

        const { stdout, stderr } = await execAsync(`docker logs --tail 50 ${container}`);
        return reply.send({ success: true, result: stdout || stderr });
      } catch (err: unknown) {
        return reply.code(500).send({ success: false, error: (err instanceof Error ? err.message : String(err)) });
      }
    }

    return reply.code(404).send({ success: false, error: `Unknown MCP tool: ${tool}` });
  });

  // General MCP routing endpoint
  fastify.post("/api/mcp", async (request: FastifyRequest<{ Body: McpPayload }>, reply: FastifyReply) => {
    const { action, tool, payload } = request.body;

    if (!action && !tool) {
      return reply.code(400).send({ success: false, error: "Missing action or tool parameter" });
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
}