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

 
const isSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isDateTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function validateResourceMeasurement(measurement) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  require(measurement?.schemaVersion === '1.0.0', 'resource measurement schemaVersion must be 1.0.0');
  require(typeof measurement?.measurementOwner === 'string' && measurement.measurementOwner.trim(), 'named measurement owner is required');
  require(typeof measurement?.hardwareIdentity === 'string' && measurement.hardwareIdentity.trim(), 'hardware identity is required');
  require(typeof measurement?.meter?.source === 'string' && measurement.meter.source.trim(), 'meter source is required');
  require(typeof measurement?.meter?.deviceId === 'string' && measurement.meter.deviceId.trim(), 'meter device ID is required');
  require(isSha256(measurement?.meter?.calibrationEvidenceSha256), 'meter calibration evidence SHA-256 is required');
  require(isSha256(measurement?.meter?.rawEvidenceSha256), 'raw meter evidence SHA-256 is required');
  require(Number.isFinite(measurement?.meter?.startKwh) && measurement.meter.startKwh >= 0, 'meter start kWh reading is required');
  require(Number.isFinite(measurement?.meter?.endKwh) && measurement.meter.endKwh > measurement.meter.startKwh, 'meter end kWh must exceed start kWh');
  require(isDateTime(measurement?.meter?.startedAt) && isDateTime(measurement?.meter?.endedAt) &&
    Date.parse(measurement.meter.endedAt) > Date.parse(measurement.meter.startedAt),
    'meter sampling window must have valid increasing timestamps');
  const grossEnergy = Number.isFinite(measurement?.meter?.startKwh) && Number.isFinite(measurement?.meter?.endKwh)
    ? measurement.meter.endKwh - measurement.meter.startKwh : null;
  require(Number.isFinite(measurement?.idleBaselineKwh) && measurement.idleBaselineKwh >= 0 &&
    grossEnergy !== null && measurement.idleBaselineKwh < grossEnergy,
    'idle baseline must be measured and lower than gross energy');
  require(Number.isFinite(measurement?.tariff?.rateZarPerKwh) && measurement.tariff.rateZarPerKwh >= 0,
    'electricity tariff in ZAR/kWh is required');
  require(typeof measurement?.tariff?.source === 'string' && measurement.tariff.source.trim(), 'tariff source is required');
  require(isSha256(measurement?.tariff?.evidenceSha256), 'tariff evidence SHA-256 is required');
  require(isDateTime(measurement?.tariff?.effectiveAt) &&
    isDateTime(measurement?.meter?.startedAt) &&
    Date.parse(measurement.tariff.effectiveAt) <= Date.parse(measurement.meter.startedAt),
    'tariff must be effective at the start of the measurement window');
  require(Number.isFinite(measurement?.hardwareAmortization?.costZar) &&
    measurement.hardwareAmortization.costZar >= 0, 'hardware amortization in ZAR is required');
  require(typeof measurement?.hardwareAmortization?.allocationMethod === 'string' &&
    measurement.hardwareAmortization.allocationMethod.trim(), 'hardware amortization method is required');
  require(isSha256(measurement?.hardwareAmortization?.evidenceSha256),
    'hardware amortization evidence SHA-256 is required');
  return {
    valid: errors.length === 0,
    errors,
    grossEnergyKwh: grossEnergy,
    netEnergyKwh: grossEnergy !== null && Number.isFinite(measurement?.idleBaselineKwh)
      ? grossEnergy - measurement.idleBaselineKwh : null
  };
}

export function calculateMeasuredResourceCostZar(input) {
  const validation = validateResourceMeasurement(input?.measurement);
  if (!validation.valid) {
    return {
      status: 'BLOCKED',
      gateVerdict: 'BLOCKED',
      reason: 'Resource measurement evidence is incomplete or invalid.',
      errors: validation.errors
    };
  }
  if (!Number.isInteger(input.attemptedTasks) || input.attemptedTasks < 1 ||
      !Number.isInteger(input.acceptedTasks) || input.acceptedTasks < 0 ||
      input.acceptedTasks > input.attemptedTasks) {
    return {
      status: 'BLOCKED',
      gateVerdict: 'BLOCKED',
      reason: 'Failure-inclusive task accounting must include every attempt and accepted task.'
    };
  }
  const energyCost = validation.netEnergyKwh * input.measurement.tariff.rateZarPerKwh;
  const amortizationCost = input.measurement.hardwareAmortization.costZar;
  const totalCost = energyCost + amortizationCost;
  return {
    status: 'MEASURED_INPUTS_VALIDATED_EXTERNAL_CONFIRMATION_REQUIRED',
    gateVerdict: 'BLOCKED',
    currency: 'ZAR',
    grossEnergyKwh: validation.grossEnergyKwh,
    idleBaselineKwh: input.measurement.idleBaselineKwh,
    netEnergyKwh: validation.netEnergyKwh,
    energyCostZar: energyCost,
    hardwareAmortizationZar: amortizationCost,
    totalCostZar: totalCost,
    costPerAttemptZar: totalCost / input.attemptedTasks,
    costPerAcceptedTaskZar: input.acceptedTasks > 0 ? totalCost / input.acceptedTasks : null,
    attemptedTasks: input.attemptedTasks,
    acceptedTasks: input.acceptedTasks,
    hardwareIdentity: input.measurement.hardwareIdentity,
    meterSource: input.measurement.meter.source,
    meterCalibrationEvidenceSha256: input.measurement.meter.calibrationEvidenceSha256,
    rawMeterEvidenceSha256: input.measurement.meter.rawEvidenceSha256,
    tariffEvidenceSha256: input.measurement.tariff.evidenceSha256,
    amortizationEvidenceSha256: input.measurement.hardwareAmortization.evidenceSha256,
    measurementWindow: {
      startedAt: input.measurement.meter.startedAt,
      endedAt: input.measurement.meter.endedAt
    },
    note: 'Evidence hashes and arithmetic are checked; meter authenticity, tariff source and amortization policy require independent review.'
  };
}

function relativeSpreadPercent(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return values.every(value => value === 0) ? 0 : Infinity;
  return ((Math.max(...values) - Math.min(...values)) / mean) * 100;
}

export function evaluateRepeatability(runs, options = {}) {
  if (!Array.isArray(runs) || runs.length < 3) {
    return { verdict: 'BLOCKED', reason: 'At least three independent repetitions are required.' };
  }
  const ids = new Set();
  for (const run of runs) {
    if (!run || typeof run.runId !== 'string' || !run.runId.trim() || ids.has(run.runId)) {
      return { verdict: 'BLOCKED', reason: 'Each repetition requires a unique runId.' };
    }
    ids.add(run.runId);
    if (!isSha256(run.outputSha256) || !isSha256(run.scorerRecordSha256) ||
        !isSha256(run.measurementEvidenceSha256) ||
        !Number.isFinite(run.p95LatencyMs) || run.p95LatencyMs < 0 ||
        !Number.isFinite(run.costPerAcceptedTaskZar) || run.costPerAcceptedTaskZar < 0) {
      return { verdict: 'BLOCKED', reason: 'Each repetition requires output, scorer and resource evidence hashes plus measured latency and ZAR cost.' };
    }
  }
  const configuration = compareRepeatability(runs[0].configuration, runs[1].configuration);
  if (!configuration.reproducibleConfiguration ||
      runs.slice(2).some(run => !compareRepeatability(runs[0].configuration, run.configuration).reproducibleConfiguration)) {
    return {
      verdict: 'NOT_COMPARABLE',
      reason: 'Repetition configuration identities differ.',
      configurationMismatches: runs.slice(1).map(run =>
        compareRepeatability(runs[0].configuration, run.configuration).mismatches
      )
    };
  }
  const outputStable = runs.every(run => run.outputSha256 === runs[0].outputSha256);
  const scorerStable = runs.every(run => run.scorerRecordSha256 === runs[0].scorerRecordSha256);
  const latencySpreadPct = relativeSpreadPercent(runs.map(run => run.p95LatencyMs));
  const costSpreadPct = relativeSpreadPercent(runs.map(run => run.costPerAcceptedTaskZar));
  const maxSpreadPct = Number.isFinite(options.maxSpreadPct) && options.maxSpreadPct >= 0
    ? options.maxSpreadPct : 10;
  const repeatable = outputStable && scorerStable &&
    latencySpreadPct <= maxSpreadPct && costSpreadPct <= maxSpreadPct;
  return {
    verdict: repeatable ? 'REPEATABLE' : 'NOT_REPEATABLE',
    repetitionCount: runs.length,
    outputStable,
    scorerStable,
    latencySpreadPct,
    costSpreadPct,
    maxSpreadPct,
    configurationVerdict: 'CONFIGURATION_MATCH',
    gateVerdict: 'BLOCKED',
    note: 'Repeatability is assessed on synthetic or supplied run records; independent telemetry and human review are still required.'
  };
}
