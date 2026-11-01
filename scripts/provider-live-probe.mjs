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
const prisma = new PrismaClient();
const started = Date.now();
let record;

try {
  if (!apiKey) throw new Error('Provider credential is not configured.');
  const config = resolveBrainProviderConfig(brain);
  const model = process.env[provider.model] || config.model;
  const endpoint = process.env[provider.endpoint] || config.endpoint;
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
    brain, model: process.env[provider.model] || resolveBrainProviderConfig(brain).model,
    status: apiKey ? 'DEGRADED' : 'UNCONFIGURED',
    latencyMs: Date.now() - started, lastSuccessAt: null, lastError: safeMessage,
  };
}

try {
  await prisma.agentBrainHealth.upsert({
    where: { brain },
    create: record,
    update: { ...record, checkedAt: new Date() },
  });
  console.log(JSON.stringify({
    brain: record.brain, model: record.model, status: record.status,
    responseValidated: record.status === 'HEALTHY',
    latencyMs: record.latencyMs, checkedAt: new Date().toISOString(),
    diagnostic: record.lastError,
  }));
} finally {
  await prisma.$disconnect();
}
if (record.status !== 'HEALTHY') process.exitCode = 1;
