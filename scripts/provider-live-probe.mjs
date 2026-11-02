import { appendFileSync } from 'node:fs';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { PrismaClient } from '@prisma/client';
import { resolveProviderProbeConfig } from '../src/agent/providerProbeConfig.ts';
import { assertBrainProbeResponse, BRAIN_PROBE_CHALLENGE } from '../src/agent/brainProbe.ts';

function safeProviderFailureDiagnostic(error) {
  const pending = [error];
  const seen = new Set();
  let status;
  let code;

  for (let visited = 0; pending.length && visited < 12; visited += 1) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    const value = current;
    const candidateStatus = value.status ?? value.statusCode ?? value.response?.status;
    if (status === undefined && Number.isInteger(Number(candidateStatus)) &&
        Number(candidateStatus) >= 100 && Number(candidateStatus) <= 599) {
      status = Number(candidateStatus);
    }

    const candidateCode = value.code;
    if (code === undefined && typeof candidateCode === 'string' &&
        /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|ERR_INVALID_URL|WRONGPASS|NOAUTH)$/.test(candidateCode)) {
      code = candidateCode;
    }

    if (value.cause) pending.push(value.cause);
    if (value.error && typeof value.error === 'object') pending.push(value.error);
    if (value.response && typeof value.response === 'object') pending.push(value.response);
  }

  if (status === 401) return 'Provider rejected the credential (HTTP 401). Check the matching provider secret and rotate it if revoked.';
  if (status === 403) return 'Provider denied this credential or model access (HTTP 403). Check account permissions and model entitlement.';
  if (status === 404) return 'Provider endpoint or model was not found (HTTP 404). Check the endpoint and model configuration.';
  if (status === 429) return 'Provider rate limit or quota reached (HTTP 429). Check provider quota and billing limits.';
  if (status >= 500) return `Provider returned a server error (HTTP ${status}). Retry after checking provider status.`;
  if (status >= 400) return `Provider rejected the request (HTTP ${status}). Check request/model compatibility.`;
  if (code === 'WRONGPASS' || code === 'NOAUTH') return 'Provider-compatible service rejected authentication.';
  if (code) return `Provider network request failed (${code}). Check outbound connectivity and endpoint DNS/TLS.`;

  // Classify common SDK/configuration failures without ever emitting raw messages,
  // request URLs, headers, or provider response bodies.
  const safeName = typeof error?.name === 'string' ? error.name : '';
  const safeMessage = typeof error?.message === 'string' ? error.message : '';
  if (/APIConnectionError|ConnectTimeoutError|FetchError/i.test(safeName)) {
    return 'Provider transport failed before an HTTP response. Check outbound DNS, TLS, and provider availability.';
  }
  if (/model.*(required|empty|undefined)/i.test(safeMessage)) {
    return 'Provider model configuration is missing or invalid.';
  }
  if (/baseURL|base url|endpoint|URL/i.test(safeMessage) && /invalid|malformed|must be/i.test(safeMessage)) {
    return 'Provider endpoint configuration is invalid.';
  }
  if (/API key|apiKey|credential/i.test(safeMessage) && /missing|required|not configured/i.test(safeMessage)) {
    return 'Provider credential is missing from the selected provider configuration.';
  }
  return `Provider call failed (${safeName || 'unknown SDK error'}) before a classifiable HTTP response. Raw details withheld to protect credentials.`;
}

const brain = process.env.RYANAI_PROBE_BRAIN;
if (brain !== 'primary' && brain !== 'secondary' && brain !== 'logic') {
  throw new Error('RYANAI_PROBE_BRAIN must be primary, secondary, or logic.');
}
const { apiKey, model, endpoint } = resolveProviderProbeConfig(brain);
const prisma = new PrismaClient();
const started = Date.now();
let record;

try {
  if (!apiKey) {
    throw new Error('Provider credential is not configured.');
  }

  const client = new ChatOpenAI({
    model,
    apiKey,
    temperature: 0,
    timeout: 20000,
    maxRetries: 0,
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
  const safeMessage = !apiKey
    ? 'Credential missing; no provider request made.'
    : safeProviderFailureDiagnostic(error);
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
      ].join('\n') + '\n',
    );
  }
} finally {
  await prisma.$disconnect();
}
if (record.status !== 'HEALTHY') process.exitCode = 1;
