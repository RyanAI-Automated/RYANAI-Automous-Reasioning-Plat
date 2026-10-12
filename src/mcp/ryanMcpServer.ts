import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { RyanAISandbox } from "../engine/sandbox.js";
import { SelfPatchSkill } from "../engine/selfPatchSkill.js";
import { systemDiagnosticsTool } from "../tools/systemTools.js";

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
   * Register workspace reading, script execution, diagnostics, and patching tools.
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
              "Executes a JavaScript/TypeScript script inside the isolated RyanAISandbox runtime.",
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
          {
            name: "self_patch_workspace",
            description:
              "Securely applies and sandbox-verifies code patches for RyanAI platform self-evolution.",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Target file path to update.",
                },
                patchContent: {
                  type: "string",
                  description: "New file content or patch string.",
                },
                testScript: {
                  type: "string",
                  description:
                    "Optional verification script to run in sandbox.",
                },
              },
              required: ["filePath", "patchContent"],
            },
          },
        ],
      };
    });

    // Handle tool execution requests with secure validation and structured error handling
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === "read_workspace_file") {
          const filePath = args?.filePath;
          if (typeof filePath !== "string" || !filePath) {
            throw new Error("Missing required argument: 'filePath'");
          }

          const targetPath = path.resolve(WORKSPACE_DIR, filePath);
          if (!targetPath.startsWith(WORKSPACE_DIR)) {
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

        if (name === "self_patch_workspace") {
          return await this.applyPatchTool(args);
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

  /**
   * Validate patch arguments and return the serialized patch status as MCP text.
   * Mark every non-success status as an error; invalid argument types reject.
   */
  private async applyPatchTool(args: Record<string, unknown> | undefined) {
    const { filePath, patchContent, testScript } = args ?? {};
    if (
      typeof filePath !== "string" ||
      typeof patchContent !== "string" ||
      (testScript !== undefined && typeof testScript !== "string")
    ) {
      throw new Error(
        "filePath and patchContent must be strings; testScript must be a string when supplied",
      );
    }
    const result = await SelfPatchSkill.applyAndVerifyPatch({
      filePath,
      patchContent,
      testScript,
    });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
      isError: result.status !== "success",
    };
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
