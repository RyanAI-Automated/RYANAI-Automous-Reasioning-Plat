import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { RyanAISandbox } from "../engine/sandbox.js";
import { systemDiagnosticsTool } from "../tools/systemTools.js";
import { evaluateGenXSecurityEvent } from "../security/genxPolicy.js";

const WORKSPACE_DIR = process.cwd();

export class RyanMCPServer {
  private server: Server;

  /** Create the MCP server and install tool handlers without connecting a transport. */
  constructor() {
    this.server = new Server(
      {
        name: "ryanai-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupToolHandlers();
  }

  /**
   * Register workspace reading, script execution, and diagnostics tools.
   * Tool invocation exceptions are converted to MCP text results with isError set.
   */
  private setupToolHandlers() {
    // List available tools exposed to external MCP clients
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "read_workspace_file",
            description:
              "Reads a source file securely from the RyanAI workspace directory.",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Relative path to the target file.",
                },
              },
              required: ["filePath"],
            },
          },
          {
            name: "execute_sandbox_script",
            description:
              "Disabled by Gen-X policy; arbitrary script execution is not available to external MCP clients.",
            inputSchema: {
              type: "object",
              properties: {
                scriptContent: {
                  type: "string",
                  description: "Executable code string.",
                },
                fileName: {
                  type: "string",
                  description: "Optional file name for the script.",
                },
              },
              required: ["scriptContent"],
            },
          },
          {
            name: "system_diagnostics",
            description:
              "Inspects local GPU, memory, or general system telemetry.",
            inputSchema: {
              type: "object",
              properties: {
                queryType: {
                  type: "string",
                  enum: ["memory", "gpu", "general"],
                  description: "Type of diagnostics query.",
                },
              },
              required: ["queryType"],
            },
          },
        ],
      };
    });

    // Handle tool execution requests with secure validation and structured error handling
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const knownTool = ["read_workspace_file", "execute_sandbox_script", "system_diagnostics"].includes(name);
        if (!knownTool) throw new Error(`Unknown MCP tool requested: ${name}`);
        const policy = evaluateGenXSecurityEvent({
          agentId: "external-mcp-client",
          principal: "mcp-client",
          toolName: name,
          action: name === "execute_sandbox_script" ? "EXECUTE" : "READ",
          target: name === "read_workspace_file" ? String(args?.filePath ?? "") : undefined,
        });
        if (policy.decision !== "ALLOW") {
          return {
            content: [{ type: "text", text: `Gen-X blocked MCP request [${policy.ruleId}]: ${policy.reason}` }],
            isError: true,
          };
        }

        if (name === "read_workspace_file") {
          const filePath = args?.filePath;
          if (typeof filePath !== "string" || !filePath) {
            throw new Error("Missing required argument: 'filePath'");
          }

          const workspaceRoot = await fs.realpath(WORKSPACE_DIR);
          const targetPath = await fs.realpath(path.resolve(WORKSPACE_DIR, filePath));
          const relativePath = path.relative(workspaceRoot, targetPath);
          if (
            relativePath === ".." ||
            relativePath.startsWith(".." + path.sep) ||
            path.isAbsolute(relativePath)
          ) {
            throw new Error(
              "Access denied: Path traversal outside workspace is prohibited.",
            );
          }

          const content = await fs.readFile(targetPath, "utf-8");
          return {
            content: [{ type: "text", text: content }],
          };
        }

        if (name === "execute_sandbox_script") {
          const { scriptContent, fileName } = args ?? {};
          if (typeof scriptContent !== "string" || !scriptContent) {
            throw new Error("Missing required argument: 'scriptContent'");
          }

          const result = await RyanAISandbox.executeInSandbox(
            scriptContent,
            typeof fileName === "string" ? fileName : "mcp_payload.js",
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        if (name === "system_diagnostics") {
          const result = await systemDiagnosticsTool.invoke(
            await systemDiagnosticsTool.schema.parseAsync(args),
          );
          return {
            content: [
              {
                type: "text",
                text:
                  typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        throw new Error(`Unknown MCP tool requested: ${name}`);
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing tool [${name}]: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /** Connect the MCP server to standard input/output; connection errors propagate. */
  public async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(
      "[RyanAI MCP Server] Model Context Protocol server running on stdio.",
    );
  }
}
