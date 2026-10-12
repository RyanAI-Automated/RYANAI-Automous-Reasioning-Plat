import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export class SystemMcpServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "ryanai-system-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  /** Registers the MCP list-tools and call-tool handlers for system diagnostics and container log retrieval. */
  private setupHandlers() {
    // List available system tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "get_container_logs",
          description: "Retrieve recent Docker container logs for diagnostics.",
          inputSchema: {
            type: "object",
            properties: {
              container: {
                type: "string",
                description: "Docker container name or ID",
              },
            },
            required: ["container"],
          },
        },
      ],
    }));

    // Handle incoming tool execution calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === "get_container_logs") {
        const containerArgs = args as { container?: string };
        const container = containerArgs?.container || "ryanai-runtime";

        // Sanitize and verify container identifier format
        if (!/^[a-zA-Z0-9_.-]+$/.test(container)) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid container name format: ${container}`,
              },
            ],
            isError: true,
          };
        }

        try {
          // Execute docker logs safely via execFile (bypassing shell evaluation)
          const { stdout, stderr } = await execFileAsync("docker", [
            "logs",
            "--tail",
            "50",
            container,
          ]);

          const output =
            stdout || stderr || `No logs found for container: ${container}`;

          return {
            content: [
              {
                type: "text",
                text: output,
              },
            ],
          };
        } catch (err: unknown) {
          return {
            content: [
              {
                type: "text",
                text: `Error fetching logs for container ${container}: ${(err instanceof Error ? err.message : String(err))}`,
              },
            ],
            isError: true,
          };
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Unknown tool requested: ${name}`,
          },
        ],
        isError: true,
      };
    });
  }

  public async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    // Logging MUST go to stderr to prevent corrupting stdio JSON-RPC stream
    console.error(
      "[System MCP Server] ryanai-system-server running on stdio."
    );
  }

  public async stop() {
    await this.server.close();
    console.error("[System MCP Server] Server stopped gracefully.");
  }
}