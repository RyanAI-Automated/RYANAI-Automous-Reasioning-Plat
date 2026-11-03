import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import process from 'node:process';
import { routeReasoning } from './provider-router.js';
import { resolveHealthUrl } from './health-url.js';
import { resolveToolRegistry } from './tool-registry.js';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(process.env.RYANAI_PROJECT_ROOT || path.join(import.meta.dirname, '..'));
const isWindows = process.platform === 'win32';
const hasProjectManifest = existsSync(path.join(projectRoot, 'package.json'));
const hasGitMetadata = existsSync(path.join(projectRoot, '.git'));
const stackManifestPath = path.join(projectRoot, 'stacks', 'ryanai.stack.json');
const hasStackManifest = existsSync(stackManifestPath);
const taskApiBaseUrl = process.env.RYANAI_TASKS_API_URL?.trim() || '';
const taskApiToken = process.env.RYANAI_TASKS_API_TOKEN?.trim() || '';
const hasTaskBoardBridge = (() => {
  if (!taskApiBaseUrl || taskApiToken.length < 32) return false;
  try {
    const url = new URL(taskApiBaseUrl);
    const safeOrigin = !url.username && !url.password && !url.search && !url.hash && (url.pathname === '/' || url.pathname === '');
    return safeOrigin && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', 'api'].includes(url.hostname)));
  } catch {
    return false;
  }
})();

export function createMcpServer() {
  const server = new Server(
    { name: 'ryanai-mcp-manager', version: '1.1.0' },
    { capabilities: { tools: {} } },
  );

  const tools = [
    {
      name: 'tool_registry',
      description: 'List RyanAI MCP tools, ownership, risk classification, and explicit enablement state.',
      inputSchema: { type: 'object', properties: {} },
    },
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
    ...(hasStackManifest ? [{
      name: 'ryanai_stack_manifest',
      description: 'Return the non-secret RyanAI service and deployment stack manifest for Jarvis orchestration.',
      inputSchema: { type: 'object', properties: {} },
    }] : []),
    ...(hasTaskBoardBridge ? [
      {
        name: 'agent_tasks_list',
        description: 'Read tasks belonging to the owner configured for this agent runtime. The API limits returned fields and enforces owner isolation.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'agent_task_comment',
        description: 'Append a progress comment to a RyanAI task. This tool cannot claim work, change task status, approve actions, merge pull requests, or deploy.',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'UUID of a task returned by agent_tasks_list.' },
            comment: { type: 'string', minLength: 1, maxLength: 4000, description: 'Progress update; never include credentials or personal secrets.' },
          },
          required: ['taskId', 'comment'],
        },
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
      description: 'Send a prompt through the central OpenAI API gateway by default, or explicitly select Nemotron, Qwen, DeepSeek, or TorchTPU.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Prompt to process, up to 20,000 characters.' },
          brain: { type: 'string', enum: ['openai', 'nemotron', 'qwen', 'deepseek', 'torch_tpu'], description: 'Provider brain; defaults to the authenticated RyanAI OpenAI API gateway. DeepSeek defaults to http://127.0.0.1:8888/v1; torch_tpu requires TORCHTPU_MODEL and defaults to http://127.0.0.1:8000/v1.' },
          response_format: { type: 'string', enum: ['text', 'json_object'], description: 'Request plain text (default) or validated JSON object output.' },
        },
        required: ['prompt'],
      },
    },
  ];

  const { tools: exposedTools, registry } = resolveToolRegistry(tools);
  const exposedToolNames = new Set(exposedTools.map((tool) => tool.name));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: exposedTools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    if (!exposedToolNames.has(request.params.name)) {
      return textResult('MCP tool is not enabled by the operator allowlist.', true);
    }

    try {
      if (request.params.name === 'tool_registry') {
        return textResult(JSON.stringify(registry, null, 2));
      }

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

      if (request.params.name === 'ryanai_stack_manifest') {
        const manifest = JSON.parse(readFileSync(stackManifestPath, 'utf8'));
        return textResult(JSON.stringify(manifest, null, 2));
      }

      if (request.params.name === 'agent_tasks_list') {
        const result = await requestTaskApi('/api/jarvis/agent/tasks');
        return textResult(JSON.stringify(result, null, 2));
      }

      if (request.params.name === 'agent_task_comment') {
        const taskId = typeof args.taskId === 'string' ? args.taskId : '';
        const comment = typeof args.comment === 'string' ? args.comment.trim() : '';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
          throw new Error('taskId must be a valid task UUID.');
        }
        if (!comment || comment.length > 4000) throw new Error('comment must contain 1 to 4,000 characters.');
        const result = await requestTaskApi(`/api/jarvis/agent/tasks/${encodeURIComponent(taskId)}/comments`, 'POST', { comment });
        return textResult(JSON.stringify(result, null, 2));
      }

      if (request.params.name === 'platform_health') {
        const configuredUrl = process.env.RYANAI_API_HEALTH_URL || 'http://localhost:3000/health';
        const requestedUrl = typeof args.url === 'string' ? args.url : undefined;
        const url = resolveHealthUrl(requestedUrl, configuredUrl);

        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const body = await response.text();
        if (!response.ok) throw new Error(`RyanAI API returned HTTP ${response.status}: ${body.slice(0, 500)}`);
        return textResult(body);
      }

      if (request.params.name === 'reasoning_route') {
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        const brain = typeof args.brain === 'string' ? args.brain : 'openai';
        if (!prompt) throw new Error('prompt is required.');
        if (prompt.length > 20_000) throw new Error('prompt must be 20,000 characters or fewer.');
        if (!['openai', 'nemotron', 'qwen', 'deepseek', 'torch_tpu'].includes(brain)) throw new Error(`Unsupported reasoning provider: ${brain}`);
        const responseFormat = typeof args.response_format === 'string' ? args.response_format : 'text';
        const result = await routeReasoning(prompt, brain, { responseFormat });
        return textResult(JSON.stringify(result, null, 2));
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    } catch (error) {
      return textResult(`RyanAI MCP operation failed:\n${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  return server;
}

async function requestTaskApi(path, method = 'GET', body) {
  if (!hasTaskBoardBridge) throw new Error('RyanAI task board MCP bridge is not configured.');
  const url = new URL(path, taskApiBaseUrl.endsWith('/') ? taskApiBaseUrl : taskApiBaseUrl + '/');
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${taskApiToken}`,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result && typeof result.error === 'string' ? result.error : `HTTP ${response.status}`;
    throw new Error(`RyanAI task API rejected the request: ${message}`);
  }
  return result;
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
