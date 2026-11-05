const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
};

export function summarizeBenchmarkRun(run) {
  if (!run || run.modelInvocation !== false || run.providerCalls !== 0) {
    throw new Error('This contract accepts mock-only, zero-provider-call records.');
  }
  if (!Array.isArray(run.tasks) || run.tasks.length === 0) {
    throw new Error('Every run must account for at least one attempted task.');
  }
  const ids = new Set();
  for (const task of run.tasks) {
    if (!task.taskId || ids.has(task.taskId)) throw new Error('Task IDs must be present and unique.');
    ids.add(task.taskId);
    if (!['completed', 'failed', 'timeout', 'refused'].includes(task.status)) {
      throw new Error('Unknown task status: ' + task.status);
    }
    if (!Number.isFinite(task.latencyMs) || task.latencyMs < 0) {
      throw new Error('Every attempt requires measured latency in milliseconds.');
    }
  }
  const latencies = run.tasks.map(task => task.latencyMs);
  const accepted = run.tasks.filter(task => task.status === 'completed' && task.accepted === true);
  return {
    attempted: run.tasks.length,
    accepted: accepted.length,
    failed: run.tasks.filter(task => task.status === 'failed').length,
    timedOut: run.tasks.filter(task => task.status === 'timeout').length,
    refused: run.tasks.filter(task => task.status === 'refused').length,
    latencyMs: {
      p50: percentile(latencies, 0.50),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99)
    },
    modelInvocation: false,
    providerCalls: 0
  };
}

export function calculateLocalCostZar(input) {
  const required = ['energyKwh', 'tariffZarPerKwh', 'hardwareAmortizationZar'];
  if (required.some(key => !Number.isFinite(input?.[key]) || input[key] < 0)) {
    return { status: 'BLOCKED', reason: 'Measured energy, declared tariff and amortization are required.' };
  }
  if (!Number.isInteger(input.attemptedTasks) || input.attemptedTasks < 1 ||
      !Number.isInteger(input.acceptedTasks) || input.acceptedTasks < 0 ||
      input.acceptedTasks > input.attemptedTasks) {
    throw new Error('Task accounting must include every attempt and accepted task.');
  }
  const energyCost = input.energyKwh * input.tariffZarPerKwh;
  const totalCost = energyCost + input.hardwareAmortizationZar;
  return {
    status: 'CALCULATED_FROM_MEASUREMENTS',
    currency: 'ZAR',
    energyCostZar: energyCost,
    hardwareAmortizationZar: input.hardwareAmortizationZar,
    totalCostZar: totalCost,
    costPerAttemptZar: totalCost / input.attemptedTasks,
    costPerAcceptedTaskZar: input.acceptedTasks > 0 ? totalCost / input.acceptedTasks : null,
    attemptedTasks: input.attemptedTasks,
    acceptedTasks: input.acceptedTasks
  };
}

export function compareRepeatability(first, second) {
  const keys = [
    'datasetSha256', 'promptConfigSha256', 'candidateIdentity',
    'runtimeIdentity', 'hardwareIdentity', 'seed', 'concurrency'
  ];
  const mismatches = keys.filter(key => first?.[key] !== second?.[key]);
  return {
    reproducibleConfiguration: mismatches.length === 0,
    mismatches,
    verdict: mismatches.length === 0 ? 'CONFIGURATION_MATCH' : 'NOT_COMPARABLE'
  };
}
