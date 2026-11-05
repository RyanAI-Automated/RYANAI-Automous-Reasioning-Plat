import { describe, expect, it } from 'vitest';
import {
  hashBenchmarkDataset,
  validateBenchmarkEvidence,
  type BenchmarkCase,
  type ModelBenchmarkEvidence,
} from './benchmark.js';

const dataset: BenchmarkCase[] = [
  { caseId: 'za-en-001', input: 'Explain the result.', expected: 'A grounded explanation.', slice: 'en-ZA' },
  { caseId: 'za-ve-001', input: 'Ndi khou humbela thuso.', expected: 'A Tshivenda response.', slice: 've-ZA' },
];

function evidence(overrides: Partial<ModelBenchmarkEvidence> = {}): ModelBenchmarkEvidence {
  return {
    modelId: 'reasoning.primary',
    provider: 'nvidia',
    revision: 'sha256:immutable-model-revision',
    datasetId: 'ryanai-heldout-v1',
    datasetSha256: hashBenchmarkDataset(dataset),
    runnerRevision: 'git:immutable-runner-revision',
    observations: [
      { caseId: 'za-en-001', output: 'A grounded explanation.', latencyMs: 120, inputTokens: 12, outputTokens: 20 },
      { caseId: 'za-ve-001', output: 'Ndi a livhuwa.', latencyMs: 150, inputTokens: 10, outputTokens: 18 },
    ],
    ...overrides,
  };
}

describe('isolated model benchmark evidence contract', () => {
  it('hashes the held-out dataset independent of case ordering', () => {
    expect(hashBenchmarkDataset(dataset)).toBe(hashBenchmarkDataset([...dataset].reverse()));
  });

  it('accepts complete, pinned evidence for every held-out case', () => {
    const result = validateBenchmarkEvidence(dataset, evidence());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.expectedCaseCount).toBe(2);
    expect(result.observedCaseCount).toBe(2);
  });

  it('rejects evidence produced against a different dataset', () => {
    const result = validateBenchmarkEvidence(dataset, evidence({ datasetSha256: '0'.repeat(64) }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Dataset SHA-256 does not match the supplied held-out dataset.');
  });

  it('requires exact model and runner revisions', () => {
    const result = validateBenchmarkEvidence(dataset, evidence({ revision: ' ', runnerRevision: '' }));
    expect(result.errors).toContain('Exact model revision is required.');
    expect(result.errors).toContain('Exact runner revision is required.');
  });

  it('rejects missing, duplicate, and unknown case observations', () => {
    const invalid = evidence({
      observations: [
        { caseId: 'za-en-001', output: 'one', latencyMs: 1, inputTokens: 1, outputTokens: 1 },
        { caseId: 'za-en-001', output: 'duplicate', latencyMs: 1, inputTokens: 1, outputTokens: 1 },
        { caseId: 'not-in-dataset', output: 'unknown', latencyMs: 1, inputTokens: 1, outputTokens: 1 },
      ],
    });
    const result = validateBenchmarkEvidence(dataset, invalid);
    expect(result.errors).toContain('Duplicate observation case id: za-en-001');
    expect(result.errors).toContain('Unknown observation case id: not-in-dataset');
    expect(result.errors).toContain('Missing observation for case: za-ve-001');
  });

  it('rejects empty outputs and invalid latency/token measurements', () => {
    const invalid = evidence({
      observations: [
        { caseId: 'za-en-001', output: ' ', latencyMs: -1, inputTokens: -2, outputTokens: 1.5 },
        { caseId: 'za-ve-001', output: 'ok', latencyMs: Number.NaN, inputTokens: 1, outputTokens: 2 },
      ],
    });
    const result = validateBenchmarkEvidence(dataset, invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Empty output for case: za-en-001');
    expect(result.errors).toContain('Invalid latency for case: za-en-001');
    expect(result.errors).toContain('Invalid input token count for case: za-en-001');
    expect(result.errors).toContain('Invalid output token count for case: za-en-001');
    expect(result.errors).toContain('Invalid latency for case: za-ve-001');
  });

  it('does not treat valid evidence structure as an activation verdict', () => {
    const result = validateBenchmarkEvidence(dataset, evidence());
    expect(result).not.toHaveProperty('activationApproved');
    expect(result).not.toHaveProperty('qualityPassed');
  });
});
