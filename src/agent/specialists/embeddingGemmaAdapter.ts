import type {
  SpecialistAdapter,
  SpecialistExecutionContext,
} from './adapterRegistry.js';

export interface EmbeddingGemmaRequest {
  readonly texts: readonly string[];
  /** Logical index namespace; this adapter never writes to the index. */
  readonly indexNamespace: string;
  /** Versioned target index supplied by the caller for provenance only. */
  readonly targetIndexVersion: string;
}

export interface EmbeddingGemmaResult {
  readonly modelRevision: string;
  readonly dimensions: number;
  readonly vectors: readonly (readonly number[])[];
}

export interface EmbeddingGemmaRuntime {
  embed(
    request: EmbeddingGemmaRequest,
    context: SpecialistExecutionContext,
  ): Promise<unknown>;
}

export interface EmbeddingGemmaAdapterOptions {
  readonly modelRevision: string;
  /** Explicit runtime metadata; never assume a model's dimensionality. */
  readonly dimensions: number;
  readonly runtime: EmbeddingGemmaRuntime;
  readonly maxTexts?: number;
  readonly maxCharactersPerText?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateEmbeddingGemmaRequest(
  value: unknown,
  limits: { readonly maxTexts: number; readonly maxCharactersPerText: number } = {
    maxTexts: 32,
    maxCharactersPerText: 8_000,
  },
): value is EmbeddingGemmaRequest {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.texts) || value.texts.length < 1 || value.texts.length > limits.maxTexts) return false;
  if (!value.texts.every(text => typeof text === 'string' && text.length > 0 && text.length <= limits.maxCharactersPerText)) return false;
  if (typeof value.indexNamespace !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(value.indexNamespace)) return false;
  return typeof value.targetIndexVersion === 'string'
    && /^[a-zA-Z0-9._:-]{1,100}$/.test(value.targetIndexVersion);
}

export function validateEmbeddingGemmaResult(
  value: unknown,
  request: EmbeddingGemmaRequest,
  expected: { readonly modelRevision: string; readonly dimensions: number },
): value is EmbeddingGemmaResult {
  if (!isRecord(value)) return false;
  if (value.modelRevision !== expected.modelRevision || value.dimensions !== expected.dimensions) return false;
  if (!Array.isArray(value.vectors) || value.vectors.length !== request.texts.length) return false;
  return value.vectors.every(vector => Array.isArray(vector)
    && vector.length === expected.dimensions
    && vector.every(component => typeof component === 'number' && Number.isFinite(component))
    && vector.some(component => component !== 0));
}

/**
 * EmbeddingGemma adapter contract. It emits vectors only; it does not write to
 * PostgreSQL/pgvector or mutate an active index. Callers must store candidate
 * vectors in a separate versioned index and retain the previous index for
 * rollback. Exact checkpoint terms/revision must be reviewed before supplying
 * a concrete runtime.
 */
export function createEmbeddingGemmaAdapter(
  options: EmbeddingGemmaAdapterOptions,
): SpecialistAdapter<EmbeddingGemmaRequest, EmbeddingGemmaResult> {
  const maxTexts = options.maxTexts ?? 32;
  const maxCharactersPerText = options.maxCharactersPerText ?? 8_000;

  if (!options.modelRevision.trim()) throw new Error('EmbeddingGemma requires an exact model revision.');
  if (!Number.isSafeInteger(options.dimensions) || options.dimensions < 1 || options.dimensions > 4_096) {
    throw new Error('EmbeddingGemma dimensions must be a positive, bounded integer.');
  }
  if (!Number.isSafeInteger(maxTexts) || maxTexts < 1 || maxTexts > 256) {
    throw new Error('EmbeddingGemma maxTexts must be between 1 and 256.');
  }
  if (!Number.isSafeInteger(maxCharactersPerText) || maxCharactersPerText < 1 || maxCharactersPerText > 100_000) {
    throw new Error('EmbeddingGemma maxCharactersPerText must be between 1 and 100000.');
  }

  return {
    id: 'specialist.embeddinggemma',
    modelRevision: options.modelRevision,
    validateInput: value => validateEmbeddingGemmaRequest(value, { maxTexts, maxCharactersPerText }),
    async invoke(request, context) {
      const output = await options.runtime.embed(request, context);
      if (!validateEmbeddingGemmaResult(output, request, {
        modelRevision: options.modelRevision,
        dimensions: options.dimensions,
      })) {
        throw new Error('EmbeddingGemma returned vectors with an unexpected revision, count, dimension, or numeric value.');
      }
      return {
        modelRevision: output.modelRevision,
        dimensions: output.dimensions,
        vectors: output.vectors.map(vector => [...vector]),
      };
    },
  };
}
