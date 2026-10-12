import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { PipelineOrchestrator } from '../orchestrator/pipelineOrchestrator';

export class RyanMcpEngine {
  private server: Server;
  private orchestrator: PipelineOrchestrator;

  constructor() {
    this.orchestrator = new PipelineOrchestrator();
    this.server = new Server(
      { name: 'ryan-ai-reasoning-platform', version: '2.0.0' },
      { capabilities: { tools: {} } }
    );

    this.registerTools();
  }

  /**
   * Register pipeline execution and process-health MCP handlers.
   * Pipeline calls may ship files and send reports; unknown tools and uncaught
   * pipeline errors are passed to the MCP server's error handling.
   */
  private registerTools() {
    // 1. List Available MCP Tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'execute_pipeline',
          description: 'Runs the RyanAI 5-Phase Deployment Pipeline for a project',
          inputSchema: {
            type: 'object',
            properties: {
              projectName: { type: 'string' },
              branch: { type: 'string' },
              autoShip: { type: 'boolean' },
              strictMode: { type: 'boolean' },
            },
            required: ['projectName', 'branch'],
          },
        },
        {
          name: 'get_system_health',
          description: 'Retrieves current kernel memory, eBPF telemetry, and process load',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    // 2. Execute MCP Tools
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'execute_pipeline') {
        const { projectName, branch, autoShip = false, strictMode = true } = args as { projectName: string; branch: string; autoShip?: boolean; strictMode?: boolean };
        const result = await this.orchestrator.runPipeline({
          projectName,
          branch,
          commitMessage: `mcp(ryan): automated reasoning trigger [${new Date().toISOString()}]`,
          filesToShip: [{ path: 'src/mcp-trigger.ts', content: '// Triggered via MCP Server\n' }],
          author: 'RyanAI MCP Host',
          autoShip,
          transcendStrict: strictMode,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      if (name === 'get_system_health') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'HEALTHY',
                ebpfProbeState: 'ACTIVE',
                memoryAllocatedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                uptimeSec: process.uptime(),
              }),
            },
          ],
        };
      }

      throw new Error(`Tool not found: ${name}`);
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('RyanAI MCP Protocol Server active over stdio.');
  }
}