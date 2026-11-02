import { appendFileSync } from 'node:fs';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { PrismaClient } from '@prisma/client';
import { resolveBrainProviderConfig } from '../src/agent/providerConfig.ts';
import { assertBrainProbeResponse, BRAIN_PROBE_CHALLENGE } from '../src/agent/brainProbe.ts';

const providers = {
  primary: { key: 'NVIDIA_API_KEY', endpoint: 'NVIDIA_API_ENDPOINT', model: 'PRIMARY_REASONING_MODEL' },
  secondary: { key: 'QWEN_API_KEY', endpoint: 'QWEN_API_ENDPOINT', model: 'SECONDARY_REASONING_MODEL' },
  logic: { key: 'LOGIC_API_KEY', endpoint: 'LOGIC_API_ENDPOINT', model: 'LOGIC_REASONING_MODEL' },
};
const brain = process.env.RYANAI_PROBE_BRAIN;
if (!Object.hasOwn(providers, brain)) throw new Error('RYANAI_PROBE_BRAIN must be primary, secondary, or logic.');

const provider = providers[brain];
const apiKey = process.env.PROVIDER_API_KEY;
if (apiKey) process.env[provider.key] = apiKey;

const config = resolveBrainProviderConfig(brain);
const model = process.env[provider.model] || config.model;
const endpoint = process.env[provider.endpoint] || config.endpoint;
const prisma = new PrismaClient();
const started = Date.now();
let record;

try {
  if (!apiKey || !config.credential) {
    throw new Error('Provider credential is not configured.');
  }

  const client = new ChatOpenAI({
    modelName: model,
    temperature: 0,
    timeout: 20000,
    maxRetries: 0,
    openAIApiKey: apiKey,
    configuration: { baseURL: endpoint },
  });
  const response = await client.invoke([
    new SystemMessage('Reply with exactly the requested challenge string and nothing else.'),
    new HumanMessage('Reply exactly: ' + BRAIN_PROBE_CHALLENGE),
  ]);
  const output = typeof response.content === 'string' ? response.content : JSON.stringify(response.content ?? '');
  assertBrainProbeResponse(output);
  record = {
    brain, model, status: 'HEALTHY', latencyMs: Date.now() - started,
    lastSuccessAt: new Date(), lastError: null,
  };
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  const safeMessage = !apiKey
    ? 'Credential missing; no provider request made.'
    : /401|403|auth|unauthor/i.test(message)
      ? 'Provider authentication or authorization failed.'
      : /429|rate.?limit/i.test(message)
        ? 'Provider rate limit reached.'
        : /timeout|timed out|abort/i.test(message)
          ? 'Provider request timed out.'
          : 'Provider request failed or returned an invalid challenge; raw details withheld.';
  record = {
    brain, model, status: apiKey ? 'DEGRADED' : 'UNCONFIGURED',
    latencyMs: Date.now() - started, lastSuccessAt: null, lastError: safeMessage,
  };
}

try {
  await prisma.agentBrainHealth.upsert({
    where: { brain },
    create: record,
    update: { ...record, checkedAt: new Date() },
  });

  const persisted = await prisma.agentBrainHealth.findUnique({ where: { brain } });
  if (
    !persisted ||
    persisted.brain !== record.brain ||
    persisted.model !== record.model ||
    persisted.status !== record.status ||
    persisted.latencyMs !== record.latencyMs ||
    persisted.lastError !== record.lastError
  ) {
    throw new Error('Persisted provider health record did not match the probe result.');
  }

  const result = {
    brain: persisted.brain,
    model: persisted.model,
    status: persisted.status,
    responseValidated: persisted.status === 'HEALTHY',
    challenge: BRAIN_PROBE_CHALLENGE,
    latencyMs: persisted.latencyMs,
    checkedAt: persisted.checkedAt.toISOString(),
    diagnostic: persisted.lastError,
    persistenceVerified: true,
  };
  console.log(JSON.stringify(result));

  // Keep a concise, credential-free evidence record in the Actions summary.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        '## Provider verification evidence',
        '',
        '| Field | Result |',
        '|---|---|',
        `| Brain | ${result.brain} |`,
        `| Model | ${result.model} |`,
        `| Status | ${result.status} |`,
        `| Exact challenge | ${result.responseValidated ? 'Validated' : 'Failed'} |`,
        `| Challenge value | ${result.challenge} |`,
        `| Database readback | ${result.persistenceVerified ? 'Verified' : 'Failed'} |`,
        `| Latency (ms) | ${result.latencyMs} |`,
        `| Checked at (UTC) | ${result.checkedAt} |`,
        `| Diagnostic | ${result.diagnostic || 'None'} |`,
        '',
      ].join('\\n') + '\\n',
    );
  }
} finally {
  await prisma.$disconnect();
}
if (record.status !== 'HEALTHY') process.exitCode = 1;
