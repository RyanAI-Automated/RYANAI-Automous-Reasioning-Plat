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
const channels = ['whatsapp', 'sms', 'voice', 'email'];

export function createMcpServer() {
  const server = new Server(
    { name: 'ryanai-mcp-manager', version: '1.2.0' },
    { capabilities: { tools: {} } },
  );

  const tools = [
    {
      name: 'tool_registry',
      description: 'List RyanAI MCP tools, ownership, risk classification, and explicit enablement state.',
      inputSchema: { type: 'object', properties: {} },
    },
    ...(hasProjectManifest ? [{
      name: 'run_project_checks',
      description: 'Run the RyanAI application validation suite and verify the Docker Compose configuration.',
      inputSchema: { type: 'object', properties: {} },
    }] : []),
    ...(hasGitMetadata ? [{
      name: 'repository_status',
      description: 'Return Git status and whitespace diagnostics without changing files.',
      inputSchema: { type: 'object', properties: {} },
    }] : []),
    ...(hasStackManifest ? [{
      name: 'ryanai_stack_manifest',
      description: 'Return the non-secret RyanAI service and deployment stack manifest for Jarvis orchestration.',
      inputSchema: { type: 'object', properties: {} },
    }] : []),
    {
      name: 'platform_health',
      description: 'Check the configured RyanAI API health endpoint.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
    },
    {
      name: 'reasoning_route',
      description: 'Send a prompt through the configured reasoning provider.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', maxLength: 20000 },
          brain: { type: 'string', enum: ['openai', 'nemotron', 'qwen', 'deepseek', 'torch_tpu'] },
          response_format: { type: 'string', enum: ['text', 'json_object'] },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'comms_policy_read',
      description: 'Read channel consent and safety policy. Read-only; no private history or provider access.',
      inputSchema: {
        type: 'object',
        properties: { channel: { type: 'string', enum: channels } },
        required: ['channel'],
        additionalProperties: false,
      },
    },
    {
      name: 'comms_draft_prepare',
      description: 'Prepare a communications draft for human approval. Never sends, schedules or calls.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string', enum: channels },
          recipient: { type: 'string', minLength: 1, maxLength: 320 },
          subject: { type: 'string', maxLength: 200 },
          message: { type: 'string', minLength: 1, maxLength: 4000 },
        },
        required: ['channel', 'recipient', 'message'],
        additionalProperties: false,
      },
    },
  ];

  const requestedTools = String(process.env.RYANAI_MCP_ENABLED_TOOLS || '')
    .split(',').map((name) => name.trim()).filter(Boolean);
  if (requestedTools.some((name) => name.startsWith('comms_'))) {
    const token = process.env.MCP_AUTH_TOKEN || '';
    if (token.length < 32) {
      throw new Error('MCP_AUTH_TOKEN must contain at least 32 characters before enabling communications MCP tools.');
    }
  }

  const { tools: exposedTools, registry } = resolveToolRegistry(tools);
  const exposedToolNames = new Set(exposedTools.map((tool) => tool.name));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: exposedTools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    if (!exposedToolNames.has(request.params.name)) {
      return textResult('MCP tool is not enabled by the operator allowlist.', true);
    }

    try {
      if (request.params.name === 'tool_registry') return textResult(JSON.stringify(registry, null, 2));
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
        return textResult(JSON.stringify(JSON.parse(readFileSync(stackManifestPath, 'utf8')), null, 2));
      }
      if (request.params.name === 'platform_health') {
        const configuredUrl = process.env.RYANAI_API_HEALTH_URL || 'http://localhost:3000/health';
        const url = resolveHealthUrl(typeof args.url === 'string' ? args.url : undefined, configuredUrl);
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const body = await response.text();
        if (!response.ok) throw new Error(`RyanAI API returned HTTP ${response.status}: ${body.slice(0, 500)}`);
        return textResult(body);
      }
      if (request.params.name === 'reasoning_route') {
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        const brain = typeof args.brain === 'string' ? args.brain : 'openai';
        if (!prompt) throw new Error('prompt is required.');
        if (prompt.length > 20000) throw new Error('prompt must be 20,000 characters or fewer.');
        if (!['openai', 'nemotron', 'qwen', 'deepseek', 'torch_tpu'].includes(brain)) throw new Error(`Unsupported reasoning provider: ${brain}`);
        const responseFormat = typeof args.response_format === 'string' ? args.response_format : 'text';
        return textResult(JSON.stringify(await routeReasoning(prompt, brain, { responseFormat }), null, 2));
      }
      if (request.params.name === 'comms_policy_read') {
        const channel = requireChannel(args.channel);
        const policy = {
          whatsapp: ['Respect opt-in and opt-out requests.', 'Use approved templates when required by provider policy.'],
          sms: ['Use E.164 recipients.', 'Respect consent, quiet hours and opt-out requests.'],
          voice: ['Use E.164 recipients.', 'Calls require explicit owner approval and recipient consent.'],
          email: ['Validate recipient addresses.', 'Provider acceptance is not proof of delivery.'],
        }[channel];
        return textResult(JSON.stringify({ channel, policy, readOnly: true, providerAccess: false }));
      }
      if (request.params.name === 'comms_draft_prepare') {
        const channel = requireChannel(args.channel);
        const recipient = typeof args.recipient === 'string' ? args.recipient.trim() : '';
        const message = typeof args.message === 'string' ? args.message.trim() : '';
        const subject = typeof args.subject === 'string' ? args.subject.trim() : undefined;
        if (!recipient || !message || message.length > 4000) throw new Error('A recipient and message of 1–4000 characters are required.');
        if (channel === 'email') {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('A valid email recipient is required.');
          if (subject && subject.length > 200) throw new Error('Email subject must be 200 characters or fewer.');
        } else {
          if (!/^\+[1-9]\d{7,14}$/.test(recipient)) throw new Error('Phone-based channels require an E.164 recipient.');
          if (subject) throw new Error('Subjects are supported only for email drafts.');
        }
        return textResult(JSON.stringify({
          status: 'draft_ready', channel, recipient,
          ...(channel === 'email' ? { subject: subject || 'RyanAI message' } : {}),
          message, approvalRequired: true, dispatchPerformed: false,
        }));
      }
      throw new Error(`Unknown tool: ${request.params.name}`);
    } catch (error) {
      return textResult(`RyanAI MCP operation failed:\n${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  return server;
}

function requireChannel(value) {
  if (typeof value !== 'string' || !channels.includes(value)) throw new Error('Unsupported communications channel.');
  return value;
}

async function run(command, args) {
  const executable = isWindows && command === 'npm' ? 'npm.cmd' : command;
  const result = await execFileAsync(executable, args, {
    cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024 * 8, timeout: 10 * 60 * 1000,
  });
  return `${command} ${args.join(' ')}\n${result.stdout.trim()}${result.stderr.trim() ? `\n[stderr]\n${result.stderr.trim()}` : ''}`;
}

function textResult(text, isError = false) {
  return { isError, content: [{ type: 'text', text }] };
}
