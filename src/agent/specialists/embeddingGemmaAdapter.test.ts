import { describe, expect, it, vi } from 'vitest';
import {
  createEmbeddingGemmaAdapter,
  validateEmbeddingGemmaRequest,
  validateEmbeddingGemmaResult,
} from './embeddingGemmaAdapter.js';

const request = {
  texts: ['RyanAI private retrieval', 'A separate candidate embedding index'],
  indexNamespace: 'ryanai-private-rag-candidate',
  targetIndexVersion: 'embeddinggemma-candidate-v1',
};

describe('EmbeddingGemma adapter contract', () => {
  it('validates bounded batches and versioned index identifiers', () => {
    expect(validateEmbeddingGemmaRequest(request)).toBe(true);
    expect(validateEmbeddingGemmaRequest({ ...request, texts: [] })).toBe(false);
    expect(validateEmbeddingGemmaRequest({ ...request, indexNamespace: '../production' })).toBe(false);
    expect(validateEmbeddingGemmaRequest({ ...request, targetIndexVersion: '' })).toBe(false);
    expect(validateEmbeddingGemmaRequest({ ...request, texts: ['x'.repeat(8_001)] })).toBe(false);
  });

  it('requires the exact model revision, vector count and configured dimension', () => {
    const result = {
      modelRevision: 'sha256:embeddinggemma-candidate',
      dimensions: 3,
      vectors: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
    };
    expect(validateEmbeddingGemmaResult(result, request, {
      modelRevision: 'sha256:embeddinggemma-candidate',
      dimensions: 3,
    })).toBe(true);
    expect(validateEmbeddingGemmaResult({
      ...result,
      vectors: [[0.1, 0.2], [0.4, 0.5]],
    }, request, { modelRevision: result.modelRevision, dimensions: 3 })).toBe(false);
    expect(validateEmbeddingGemmaResult({
      ...result,
      vectors: [[0.1, Number.NaN, 0.3], [0.4, 0.5, 0.6]],
    }, request, { modelRevision: result.modelRevision, dimensions: 3 })).toBe(false);
    expect(validateEmbeddingGemmaResult({
      ...result,
      vectors: [[0, 0, 0], [0.4, 0.5, 0.6]],
    }, request, { modelRevision: result.modelRevision, dimensions: 3 })).toBe(false);
  });

  it('returns candidate vectors without writing or replacing an index', async () => {
    const runtime = {
      embed: vi.fn(async () => ({
        modelRevision: 'sha256:embeddinggemma-candidate',
        dimensions: 3,
        vectors: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
      })),
    };
    const adapter = createEmbeddingGemmaAdapter({
      modelRevision: 'sha256:embeddinggemma-candidate',
      dimensions: 3,
      runtime,
    });
    const result = await adapter.invoke(request, {
      requestId: 'embedding-fixture-001',
      mode: 'offline_benchmark',
      signal: new AbortController().signal,
    });
    expect(runtime.embed).toHaveBeenCalledOnce();
    expect(result.vectors).toHaveLength(request.texts.length);
    expect(result.dimensions).toBe(3);
  });

  it('rejects malformed runtime vectors', async () => {
    const adapter = createEmbeddingGemmaAdapter({
      modelRevision: 'sha256:embeddinggemma-candidate',
      dimensions: 3,
      runtime: {
        embed: async () => ({
          modelRevision: 'sha256:embeddinggemma-candidate',
          dimensions: 4,
          vectors: [[0.1, 0.2, 0.3, 0.4], [0.1, 0.2, 0.3, 0.4]],
        }),
      },
    });
    await expect(adapter.invoke(request, {
      requestId: 'embedding-invalid-001',
      mode: 'offline_benchmark',
      signal: new AbortController().signal,
    })).rejects.toThrow('unexpected revision, count, dimension, or numeric value');
  });
});
