import { describe, expect, it, vi } from 'vitest';
import { runModelComparison } from './modelEvaluation.js';

const cases = [
  { id: 'math-001', taskFamily: 'math', prompt: '6 * 7', expected: '42', scoring: 'exact' as const },
  { id: 'code-001', taskFamily: 'code', prompt: 'return 1', expected: 'return 1', scoring: 'contains' as const },
  { id: 'knowledge-001', taskFamily: 'knowledge', prompt: 'Explain this', scoring: 'manual' as const },
];

describe('runModelComparison', () => {
  it('runs the same frozen cases against multiple pinned candidates and reports aggregate evidence', async () => {
    const twil = vi.fn(async (prompt: string) => prompt === '6 * 7' ? '42' : 'return 1;');
    const qwen = vi.fn(async () => 'not correct');
    const report = await runModelComparison(cases, [
      { id: 'twil8b-balanced', revision: 'sha256:' + 'a'.repeat(64), generate: twil },
      { id: 'qwen-baseline', revision: 'qwen-rev-123', generate: qwen },
    ]);

    expect(report.schemaVersion).toBe(1);
    expect(report.datasetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.caseCount).toBe(3);
    expect(report.records).toHaveLength(6);
    expect(report.summaries[0]).toMatchObject({
      candidateId: 'twil8b-balanced',
      caseCount: 3,
      successCount: 3,
      scoredCount: 2,
      accuracy: 1,
      failureRate: 0,
    });
    expect(report.summaries[1].accuracy).toBe(0);
    expect(report.records.every((record) => record.outputSha256?.length === 64)).toBe(true);
    expect(JSON.stringify(report)).not.toContain('return 1;');
  });

  it('records failures without leaking provider error messages or stopping other candidates', async () => {
    const failed = vi.fn(async () => { throw new Error('private prompt content and secret'); });
    const passed = vi.fn(async () => '42');
    const report = await runModelComparison(
      [{ id: 'one', taskFamily: 'math', prompt: 'question', expected: '42', scoring: 'exact' }],
      [
        { id: 'failed', revision: 'rev-a', generate: failed },
        { id: 'passed', revision: 'rev-b', generate: passed },
      ],
    );
    expect(report.records[0]).toMatchObject({ success: false, score: null, errorName: 'Error', outputSha256: null });
    expect(report.records[1]).toMatchObject({ success: true, score: true });
    expect(JSON.stringify(report)).not.toContain('private prompt');
  });

  it('requires at least two candidates and exact candidate revisions', async () => {
    await expect(runModelComparison(cases, [
      { id: 'only-one', revision: 'rev-1', generate: async () => 'x' },
    ])).rejects.toThrow(/At least two candidates/);
    await expect(runModelComparison(cases, [
      { id: 'one', revision: '', generate: async () => 'x' },
      { id: 'two', revision: 'rev-2', generate: async () => 'x' },
    ])).rejects.toThrow(/exact revision/);
  });

  it('rejects duplicate case ids and missing expected values for automatic scoring', async () => {
    await expect(runModelComparison([
      { id: 'duplicate', taskFamily: 'math', prompt: 'one' },
      { id: 'duplicate', taskFamily: 'math', prompt: 'two' },
    ], [
      { id: 'a', revision: 'rev-a', generate: async () => 'x' },
      { id: 'b', revision: 'rev-b', generate: async () => 'x' },
    ])).rejects.toThrow(/unique/);

    await expect(runModelComparison([
      { id: 'missing-expected', taskFamily: 'math', prompt: 'one', scoring: 'exact' },
    ], [
      { id: 'a', revision: 'rev-a', generate: async () => 'x' },
      { id: 'b', revision: 'rev-b', generate: async () => 'x' },
    ])).rejects.toThrow(/expected output/);
  });
});
