import { createHash } from 'node:crypto';

export type EvaluationScoring = 'exact' | 'contains' | 'manual';

export interface EvaluationPromptCase {
  id: string;
  taskFamily: string;
  prompt: string;
  expected?: string;
  scoring?: EvaluationScoring;
}

export interface EvaluationCandidate {
  id: string;
  revision: string;
  generate(prompt: string): Promise<string>;
}

export interface EvaluationRecord {
  candidateId: string;
  candidateRevision: string;
  caseId: string;
  taskFamily: string;
  success: boolean;
  score: boolean | null;
  latencyMs: number;
  outputCharacters: number;
  estimatedOutputTokens: number;
  outputSha256: string | null;
  errorName: string | null;
}

export interface CandidateEvaluationSummary {
  candidateId: string;
  candidateRevision: string;
  caseCount: number;
  successCount: number;
  failureRate: number;
  scoredCount: number;
  accuracy: number | null;
  latencyP50Ms: number;
  latencyP95Ms: number;
  meanEstimatedOutputTokens: number;
}

export interface ModelComparisonReport {
  schemaVersion: 1;
  datasetSha256: string;
  caseCount: number;
  records: EvaluationRecord[];
  summaries: CandidateEvaluationSummary[];
}

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function scoreOutput(
  output: string,
  expected: string | undefined,
  scoring: EvaluationScoring | undefined,
): boolean | null {
  if (!expected || !scoring || scoring === 'manual') return null;
  if (scoring === 'exact') return output.trim().toLowerCase() === expected.trim().toLowerCase();
  return output.toLowerCase().includes(expected.toLowerCase());
}

/**
 * Deterministic, serial comparison harness. It never logs or persists prompts
 * or completions; reports contain hashes and aggregate measurements only.
 * Candidate callbacks let the same frozen suite exercise TwIL, NVIDIA, Qwen,
 * and Logic without embedding provider credentials in this module.
 */
export async function runModelComparison(
  cases: EvaluationPromptCase[],
  candidates: EvaluationCandidate[],
): Promise<ModelComparisonReport> {
  if (cases.length === 0) throw new Error('Evaluation dataset must contain at least one case.');
  if (candidates.length < 2) throw new Error('At least two candidates are required for a comparative evaluation.');

  const caseIds = new Set<string>();
  for (const item of cases) {
    if (!item.id.trim() || caseIds.has(item.id)) throw new Error('Evaluation case ids must be non-empty and unique.');
    caseIds.add(item.id);
    if (!item.taskFamily.trim() || !item.prompt.trim()) throw new Error(`Evaluation case ${item.id} is missing taskFamily or prompt.`);
    if (item.scoring && !['exact', 'contains', 'manual'].includes(item.scoring)) {
      throw new Error(`Evaluation case ${item.id} has an unsupported scoring mode.`);
    }
    if (item.scoring && item.scoring !== 'manual' && !item.expected?.trim()) {
      throw new Error(`Evaluation case ${item.id} requires expected output for automatic scoring.`);
    }
  }

  const candidateIds = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.id.trim() || candidateIds.has(candidate.id)) throw new Error('Candidate ids must be non-empty and unique.');
    candidateIds.add(candidate.id);
    if (!candidate.revision.trim()) throw new Error(`Candidate ${candidate.id} must have an exact revision.`);
  }

  const records: EvaluationRecord[] = [];
  for (const candidate of candidates) {
    for (const item of cases) {
      const started = performance.now();
      try {
        const output = await candidate.generate(item.prompt);
        const latencyMs = Math.max(0, performance.now() - started);
        const validOutput = typeof output === 'string' ? output : '';
        records.push({
          candidateId: candidate.id,
          candidateRevision: candidate.revision,
          caseId: item.id,
          taskFamily: item.taskFamily,
          success: validOutput.trim().length > 0,
          score: validOutput.trim() ? scoreOutput(validOutput, item.expected, item.scoring) : null,
          latencyMs,
          outputCharacters: validOutput.length,
          estimatedOutputTokens: Math.ceil(validOutput.length / 4),
          outputSha256: validOutput ? sha256(validOutput) : null,
          errorName: null,
        });
      } catch (error) {
        records.push({
          candidateId: candidate.id,
          candidateRevision: candidate.revision,
          caseId: item.id,
          taskFamily: item.taskFamily,
          success: false,
          score: null,
          latencyMs: Math.max(0, performance.now() - started),
          outputCharacters: 0,
          estimatedOutputTokens: 0,
          outputSha256: null,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }
  }

  const summaries = candidates.map((candidate): CandidateEvaluationSummary => {
    const rows = records.filter((record) => record.candidateId === candidate.id);
    const scored = rows.filter((record) => record.score !== null);
    return {
      candidateId: candidate.id,
      candidateRevision: candidate.revision,
      caseCount: rows.length,
      successCount: rows.filter((record) => record.success).length,
      failureRate: rows.length ? rows.filter((record) => !record.success).length / rows.length : 0,
      scoredCount: scored.length,
      accuracy: scored.length ? scored.filter((record) => record.score === true).length / scored.length : null,
      latencyP50Ms: percentile(rows.map((record) => record.latencyMs), 0.5),
      latencyP95Ms: percentile(rows.map((record) => record.latencyMs), 0.95),
      meanEstimatedOutputTokens: rows.length
        ? rows.reduce((total, record) => total + record.estimatedOutputTokens, 0) / rows.length
        : 0,
    };
  });

  const datasetDescriptor = cases.map(({ id, taskFamily, prompt, expected, scoring }) => ({
    id, taskFamily, prompt, expected: expected ?? null, scoring: scoring ?? 'manual',
  }));
  return {
    schemaVersion: 1,
    datasetSha256: sha256(JSON.stringify(datasetDescriptor)),
    caseCount: cases.length,
    records,
    summaries,
  };
}
