import { describe, expect, it, vi } from 'vitest';
import { createGlinerAdapter, validateGlinerExtractionRequest, validateGlinerExtractionResult } from './glinerAdapter.js';

const request = {
  text: 'Sir G works on RyanAI in South Africa.',
  labels: ['PERSON', 'ORGANIZATION', 'LOCATION'],
  threshold: 0.5,
};

describe('GLiNER adapter contract', () => {
  it('validates bounded text, unique labels and thresholds', () => {
    expect(validateGlinerExtractionRequest(request)).toBe(true);
    expect(validateGlinerExtractionRequest({ ...request, labels: ['PERSON', 'PERSON'] })).toBe(false);
    expect(validateGlinerExtractionRequest({ ...request, threshold: 1.1 })).toBe(false);
    expect(validateGlinerExtractionRequest({ ...request, text: '' })).toBe(false);
    expect(validateGlinerExtractionRequest({ ...request, text: 'x'.repeat(20_001) })).toBe(false);
  });

  it('accepts only source-grounded spans with allowed labels and scores', () => {
    const result = {
      entities: [
        { start: 0, end: 5, text: 'Sir G', label: 'PERSON', score: 0.98 },
        { start: 15, end: 21, text: 'RyanAI', label: 'ORGANIZATION', score: 0.91 },
      ],
    };
    expect(validateGlinerExtractionResult(result, request)).toBe(true);
    expect(validateGlinerExtractionResult({
      entities: [{ start: 0, end: 5, text: 'Wrong', label: 'PERSON', score: 0.98 }],
    }, request)).toBe(false);
    expect(validateGlinerExtractionResult({
      entities: [{ start: 0, end: 5, text: 'Sir G', label: 'SECRET', score: 0.98 }],
    }, request)).toBe(false);
  });

  it('uses an injected runtime and returns validated entities without loading weights', async () => {
    const runtime = {
      extract: vi.fn(async () => ({
        entities: [{ start: 0, end: 5, text: 'Sir G', label: 'PERSON', score: 0.98 }],
      })),
    };
    const adapter = createGlinerAdapter({
      modelRevision: 'sha256:reviewed-checkpoint-placeholder',
      runtime,
    });
    const result = await adapter.invoke(request, {
      requestId: 'gliner-fixture-001',
      mode: 'offline_benchmark',
      signal: new AbortController().signal,
    });
    expect(runtime.extract).toHaveBeenCalledOnce();
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({ text: 'Sir G', label: 'PERSON' });
  });

  it('rejects malformed runtime output instead of silently accepting it', async () => {
    const adapter = createGlinerAdapter({
      modelRevision: 'sha256:reviewed-checkpoint-placeholder',
      runtime: { extract: async () => ({ entities: [{ start: -1, end: 100, text: 'x', label: 'PERSON', score: 9 }] }) },
    });
    await expect(adapter.invoke(request, {
      requestId: 'gliner-invalid-001',
      mode: 'offline_benchmark',
      signal: new AbortController().signal,
    })).rejects.toThrow('invalid or non-source-grounded');
  });
});
