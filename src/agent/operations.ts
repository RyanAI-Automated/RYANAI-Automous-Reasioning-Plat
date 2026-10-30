import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { primaryBrain, secondaryBrain, logicBrain } from '../config/brains.js';
import { prisma } from '../lib/prisma.js';
import { executeThreeBrainPlan, type BrainId, type BrainOutput } from './operationsCore.js';

const brains = {
  primary: { model: process.env.PRIMARY_REASONING_MODEL || process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra', endpoint: process.env.NVIDIA_API_ENDPOINT || process.env.LM_STUDIO_URL || process.env.OLLAMA_URL || 'https://integrate.api.nvidia.com/v1', credential: Boolean(process.env.NVIDIA_API_KEY || ((process.env.LM_STUDIO_URL || process.env.OLLAMA_URL) && process.env.LM_STUDIO_API_KEY)), client: primaryBrain },
  secondary: { model: process.env.SECONDARY_REASONING_MODEL || process.env.QWEN_MODEL || 'Qwen/Qwen3-235B-A22B-Instruct-2507', endpoint: process.env.QWEN_API_ENDPOINT || process.env.LM_STUDIO_URL || 'https://api.together.xyz/v1', credential: Boolean(process.env.QWEN_API_KEY || (process.env.LM_STUDIO_URL && process.env.LM_STUDIO_API_KEY)), client: secondaryBrain },
  logic: { model: process.env.LOGIC_REASONING_MODEL || process.env.LM_STUDIO_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini', endpoint: process.env.LOGIC_API_ENDPOINT || process.env.LM_STUDIO_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', credential: Boolean(process.env.LOGIC_API_KEY || process.env.LM_STUDIO_API_KEY || process.env.OPENAI_API_KEY), client: logicBrain },
} as const;
const localRuntime = (endpoint: string) => Boolean(process.env.LM_STUDIO_URL || process.env.OLLAMA_URL) || /localhost|127\.0\.0\.1/.test(endpoint);
const asText = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value ?? '') ?? '';
async function invokeWithRecovery(brain: BrainId, prompt: string): Promise<BrainOutput> {
  const config = brains[brain];
  if (!config.credential && !localRuntime(config.endpoint)) throw new Error(`${brain} brain credential is not configured`);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        config.client.invoke([new SystemMessage(`You are RyanAI's ${brain} reasoning brain. Analyze rigorously. Never perform external actions.`), new HumanMessage(prompt)], { signal: AbortSignal.timeout(20_000) }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Brain invocation timed out after 20 seconds')), 20_000); }),
      ]);
      const output = asText(response.content);
      if (!output.trim()) throw new Error('Provider returned an empty response');
      return { brain, output, latencyMs: Date.now() - started };
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
    } finally { if (timer) clearTimeout(timer); }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function probeAllBrains() {
  return Promise.all((Object.keys(brains) as BrainId[]).map(async (brain) => {
    const config = brains[brain]; const started = Date.now();
    let status = 'UNCONFIGURED'; let latencyMs: number | null = null;
    let lastError: string | null = null; let lastSuccessAt: Date | null = null;
    try {
      if (!config.credential && !localRuntime(config.endpoint)) throw new Error('Credential missing; no network request made');
      await invokeWithRecovery(brain, 'Connectivity test. Reply exactly: RYANAI_BRAIN_READY');
      status = 'HEALTHY'; latencyMs = Date.now() - started; lastSuccessAt = new Date();
    } catch (error) {
      lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      status = /credential missing/i.test(lastError) ? 'UNCONFIGURED' : 'DEGRADED';
    }
    await prisma.agentBrainHealth.upsert({
      where: { brain },
      create: { brain, model: config.model, status, latencyMs, lastSuccessAt, lastError },
      update: { model: config.model, status, latencyMs, lastSuccessAt, lastError, checkedAt: new Date() },
    });
    return { brain, model: config.model, status, latencyMs, lastSuccessAt, lastError };
  }));
}
export async function listBrainHealth() {
  return prisma.agentBrainHealth.findMany({ orderBy: { brain: 'asc' } });
}

/** Periodically probes all configured brains; unavailable providers never block API startup. */
export function startBrainHealthMonitor(intervalMs = Number(process.env.RYANAI_BRAIN_HEALTH_INTERVAL_MS || 300_000)) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await probeAllBrains(); }
    catch (error) { console.error('[brain-monitor] Probe failed:', error instanceof Error ? error.message : String(error)); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, Math.max(60_000, intervalMs));
  timer.unref();
  return () => clearInterval(timer);
}

export async function dispatchAutonomousTask(userId: string, objective: string) {
  const run = await prisma.agentRun.create({ data: { userId, objective, status: 'running' }, select: { id: true, userId: true, objective: true, status: true, createdAt: true } });
  await prisma.agentHandoff.createMany({ data: [
    { runId: run.id, fromAgent: 'supervisor', toAgent: 'primary', input: objective, status: 'running' },
    { runId: run.id, fromAgent: 'supervisor', toAgent: 'secondary', input: objective, status: 'running' },
    { runId: run.id, fromAgent: 'primary', toAgent: 'logic', input: 'Awaiting primary analysis', status: 'pending' },
    { runId: run.id, fromAgent: 'secondary', toAgent: 'logic', input: 'Awaiting secondary analysis', status: 'pending' },
  ] });
  try {
    const plan = await executeThreeBrainPlan(objective, invokeWithRecovery);
    const rows = await prisma.agentHandoff.findMany({ where: { runId: run.id }, orderBy: { startedAt: 'asc' } });
    const outputByBrain = new Map(plan.outputs.map((item) => [item.brain, item]));
    await Promise.all(rows.map(async (row) => {
      const output = row.toAgent === 'primary' ? outputByBrain.get('primary') : row.toAgent === 'secondary' ? outputByBrain.get('secondary') : outputByBrain.get(row.fromAgent as 'primary' | 'secondary');
      if (!output) return;
      await prisma.agentHandoff.update({ where: { id: row.id }, data: { status: 'completed', output: row.toAgent === 'logic' ? plan.synthesis : output.output, input: row.toAgent === 'logic' ? output.output : row.input, completedAt: new Date() } });
    }));
    await prisma.agentRun.update({ where: { id: run.id }, data: { status: 'completed', result: { synthesis: plan.synthesis, brains: plan.outputs.map(({ brain, latencyMs }) => ({ brain, latencyMs })) }, completedAt: new Date() } });
    await prisma.memoryVault.create({ data: { userId, title: `Autonomous task ${run.id}`, content: `Objective:\n${objective}\n\nResult:\n${plan.synthesis}`, category: 'agent-task', tags: ['agent-run', 'autonomous'] } });
    return { ...run, status: 'completed', result: plan.synthesis, handoffs: plan.handoffs };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    await prisma.agentRun.update({ where: { id: run.id }, data: { status: 'failed', error: message, completedAt: new Date() } });
    await prisma.agentHandoff.updateMany({ where: { runId: run.id, status: { in: ['pending', 'running'] } }, data: { status: 'failed', error: message, completedAt: new Date() } });
    throw error;
  }
}
export async function listAgentRuns(userId: string) {
  return prisma.agentRun.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 25, include: { handoffs: { orderBy: { startedAt: 'asc' } } } });
}
