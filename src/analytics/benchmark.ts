import { createHash } from 'node:crypto';

/**
 * Evidence contract for an isolated model evaluation.
 *
 * This module deliberately has no provider, network, database, or runtime
 * imports. It validates evidence produced elsewhere; it never invokes a model.
 * A separately reviewed runner must enforce the six readiness gates before
 * producing observations for this contract.
 */
export interface BenchmarkCase {
  caseId: string;
  input: string;
  expected: string;
  slice: string;
}

export interface BenchmarkObservation {
  caseId: string;
  output: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelBenchmarkEvidence {
  modelId: string;
  provider: string;
  revision: string;
  datasetId: string;
  datasetSha256: string;
  runnerRevision: string;
  observations: BenchmarkObservation[];
}

export interface EvidenceValidation {
  valid: boolean;
  errors: string[];
  datasetSha256: string;
  expectedCaseCount: number;
  observedCaseCount: number;
}

function canonicalDataset(cases: BenchmarkCase[]): string {
  return JSON.stringify(
    [...cases]
      .map(({ caseId, input, expected, slice }) => ({ caseId, input, expected, slice }))
      .sort((a, b) => a.caseId.localeCompare(b.caseId)),
  );
}

export function hashBenchmarkDataset(cases: BenchmarkCase[]): string {
  return createHash('sha256').update(canonicalDataset(cases), 'utf8').digest('hex');
}

/**
 * Validate evidence integrity and completeness only. A valid report is not a
 * quality pass, provider-health assertion, or authorization to activate a model.
 */
export function validateBenchmarkEvidence(
  dataset: BenchmarkCase[],
  evidence: ModelBenchmarkEvidence,
): EvidenceValidation {
  const errors: string[] = [];
  const expectedHash = hashBenchmarkDataset(dataset);
  const caseIds = new Set<string>();

  if (!Array.isArray(dataset) || dataset.length === 0) {
    errors.push('Benchmark dataset must contain at least one case.');
  }
  for (const item of dataset) {
    if (!item.caseId?.trim() || !item.input?.trim() || !item.expected?.trim() || !item.slice?.trim()) {
      errors.push('Every dataset case requires caseId, input, expected, and slice.');
      break;
    }
    if (caseIds.has(item.caseId)) errors.push(`Duplicate dataset case id: ${item.caseId}`);
    caseIds.add(item.caseId);
  }

  if (!evidence.modelId?.trim()) errors.push('Exact model id is required.');
  if (!evidence.provider?.trim()) errors.push('Provider identity is required.');
  if (!evidence.revision?.trim()) errors.push('Exact model revision is required.');
  if (!evidence.datasetId?.trim()) errors.push('Dataset id/version is required.');
  if (!evidence.runnerRevision?.trim()) errors.push('Exact runner revision is required.');
  if (evidence.datasetSha256 !== expectedHash) errors.push('Dataset SHA-256 does not match the supplied held-out dataset.');

  const observations = Array.isArray(evidence.observations) ? evidence.observations : [];
  const observedIds = new Set<string>();
  for (const observation of observations) {
    if (!observation.caseId?.trim()) {
      errors.push('Every observation requires a case id.');
      continue;
    }
    if (observedIds.has(observation.caseId)) errors.push(`Duplicate observation case id: ${observation.caseId}`);
    observedIds.add(observation.caseId);
    if (!caseIds.has(observation.caseId)) errors.push(`Unknown observation case id: ${observation.caseId}`);
    if (!observation.output?.trim()) errors.push(`Empty output for case: ${observation.caseId}`);
    if (!Number.isFinite(observation.latencyMs) || observation.latencyMs < 0) {
      errors.push(`Invalid latency for case: ${observation.caseId}`);
    }
    if (!Number.isInteger(observation.inputTokens) || observation.inputTokens < 0) {
      errors.push(`Invalid input token count for case: ${observation.caseId}`);
    }
    if (!Number.isInteger(observation.outputTokens) || observation.outputTokens < 0) {
      errors.push(`Invalid output token count for case: ${observation.caseId}`);
    }
  }

  for (const caseId of caseIds) {
    if (!observedIds.has(caseId)) errors.push(`Missing observation for case: ${caseId}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    datasetSha256: expectedHash,
    expectedCaseCount: caseIds.size,
    observedCaseCount: observedIds.size,
  };
}
