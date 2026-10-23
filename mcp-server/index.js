import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import process from 'node:process';
import { routeReasoning } from './provider-router.js';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(process.env.RYANAI_PROJECT_ROOT || path.join(import.meta.dirname, '..'));
const isWindows = process.platform === 'win32';
const hasProjectManifest = existsSync(path.join(projectRoot, 'package.json'));
const hasGitMetadata = existsSync(path.join(projectRoot, '.git'));

export function createMcpServer() {
  const server = new Server(
    { name: 'ryanai-mcp-manager', version: '1.1.0' },
    { capabilities: { tools: {} } },
  );

  const tools = [
    ...(hasProjectManifest ? [
    {
      name: 'run_project_checks',
      description: 'Run the RyanAI application validation suite and verify the Docker Compose configuration.',
      inputSchema: { type: 'object', properties: {} },
    },
    ] : []),
    ...(hasGitMetadata ? [
    {
      name: 'repository_status',
      description: 'Return Git status and whitespace diagnostics without changing files.',
      inputSchema: { type: 'object', properties: {} },
    },
    ] : []),
    {
      name: 'platform_health',
      description: 'Check the configured RyanAI API health endpoint.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Optional absolute API health URL; defaults to RYANAI_API_HEALTH_URL or http://localhost:3000/health.' },
        },
      },
    },
    {
      name: 'reasoning_route',
      description: 'Send a prompt to the configured Nemotron or Qwen provider. Requires that provider API key; this tool does not claim an unavailable local fallback.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Prompt to process, up to 20,000 characters.' },
          brain: { type: 'string', enum: ['nemotron', 'qwen'], description: 'Provider brain; defaults to nemotron.' },
        },
        required: ['prompt'],
      },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};

    try {
      if (request.params.name === 'run_project_checks') {
        const results = [];
        results.push(await run('npm', ['run', 'validate']));
        results.push(await run('docker', ['compose', 'config', '--quiet']));
        return textResult(`RyanAI checks passed.\n\n${results.join('\n\n')}`);
      }

      if (request.params.name === 'repository_status') {
        const status = await run('git', ['status', '--short']);
        const diffCheck = await run('git', ['diff', '--check']);
        return textResult(`Repository status:\n${status || '(clean)'}\n\nWhitespace check:\n${diffCheck || 'clean'}`);
      }

      if (request.params.name === 'platform_health') {
        const rawUrl = typeof args.url === 'string'
          ? args.url
          : process.env.RYANAI_API_HEALTH_URL || 'http://localhost:3000/health';
        const url = new URL(rawUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Health URL must use HTTP or HTTPS.');

        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const body = await response.text();
        if (!response.ok) throw new Error(`RyanAI API returned HTTP ${response.status}: ${body.slice(0, 500)}`);
        return textResult(body);
      }

      if (request.params.name === 'reasoning_route') {
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        const brain = typeof args.brain === 'string' ? args.brain : 'nemotron';
        if (!prompt) throw new Error('prompt is required.');
        if (prompt.length > 20_000) throw new Error('prompt must be 20,000 characters or fewer.');
        if (!['nemotron', 'qwen'].includes(brain)) throw new Error(`Unsupported reasoning provider: ${brain}`);
        const result = await routeReasoning(prompt, brain);
        return textResult(JSON.stringify(result, null, 2));
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    } catch (error) {
      return textResult(`RyanAI MCP operation failed:\n${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  return server;
}

async function run(command, args) {
  const executable = isWindows && command === 'npm' ? 'npm.cmd' : command;
  const result = await execFileAsync(executable, args, {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8,
    timeout: 10 * 60 * 1000,
  });
  return `${command} ${args.join(' ')}\n${result.stdout.trim()}${result.stderr.trim() ? `\n[stderr]\n${result.stderr.trim()}` : ''}`;
}

function textResult(text, isError = false) {
  return { isError, content: [{ type: 'text', text }] };
}
