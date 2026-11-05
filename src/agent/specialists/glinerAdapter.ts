import type {
  SpecialistAdapter,
  SpecialistExecutionContext,
} from './adapterRegistry.js';

export interface GlinerExtractionRequest {
  readonly text: string;
  readonly labels: readonly string[];
  readonly threshold: number;
}

export interface GlinerEntity {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly label: string;
  readonly score: number;
}

export interface GlinerExtractionResult {
  readonly entities: readonly GlinerEntity[];
}

export interface GlinerRuntime {
  /** Runtime is injected so tests can use fixtures without loading model weights. */
  extract(
    request: GlinerExtractionRequest,
    context: SpecialistExecutionContext,
  ): Promise<unknown>;
}

export interface GlinerAdapterOptions {
  readonly modelRevision: string;
  readonly runtime: GlinerRuntime;
  readonly maxTextCharacters?: number;
  readonly maxLabels?: number;
  readonly maxEntities?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateGlinerExtractionRequest(
  value: unknown,
  limits: { readonly maxTextCharacters: number; readonly maxLabels: number } = {
    maxTextCharacters: 20_000,
    maxLabels: 64,
  },
): value is GlinerExtractionRequest {
  if (!isRecord(value)) return false;
  if (typeof value.text !== 'string' || value.text.length < 1 || value.text.length > limits.maxTextCharacters) return false;
  if (!Array.isArray(value.labels) || value.labels.length < 1 || value.labels.length > limits.maxLabels) return false;
  if (!value.labels.every(label => typeof label === 'string' && label.trim().length > 0 && label.length <= 128)) return false;
  if (new Set(value.labels).size !== value.labels.length) return false;
  return typeof value.threshold === 'number'
    && Number.isFinite(value.threshold)
    && value.threshold >= 0
    && value.threshold <= 1;
}

export function validateGlinerExtractionResult(
  value: unknown,
  request: GlinerExtractionRequest,
  maxEntities = 256,
): value is GlinerExtractionResult {
  if (!isRecord(value) || !Array.isArray(value.entities) || value.entities.length > maxEntities) return false;
  return value.entities.every(entity => {
    if (!isRecord(entity)) return false;
    if (!Number.isSafeInteger(entity.start) || !Number.isSafeInteger(entity.end)) return false;
    const start = entity.start as number;
    const end = entity.end as number;
    if (start < 0 || end <= start || end > request.text.length) return false;
    if (typeof entity.text !== 'string' || request.text.slice(start, end) !== entity.text) return false;
    if (typeof entity.label !== 'string' || !request.labels.includes(entity.label)) return false;
    return typeof entity.score === 'number'
      && Number.isFinite(entity.score)
      && entity.score >= request.threshold
      && entity.score <= 1;
  });
}

/**
 * GLiNER application adapter. It validates source-grounded spans and confidence
 * values but deliberately does not choose/download a checkpoint or instantiate
 * the runtime. The exact checkpoint licence and revision must be reviewed
 * before a concrete runtime is supplied.
 */
export function createGlinerAdapter(
  options: GlinerAdapterOptions,
): SpecialistAdapter<GlinerExtractionRequest, GlinerExtractionResult> {
  const maxTextCharacters = options.maxTextCharacters ?? 20_000;
  const maxLabels = options.maxLabels ?? 64;
  const maxEntities = options.maxEntities ?? 256;

  if (!options.modelRevision.trim()) throw new Error('GLiNER requires an exact model revision.');
  if (!Number.isSafeInteger(maxTextCharacters) || maxTextCharacters < 1) throw new Error('GLiNER maxTextCharacters must be a positive safe integer.');
  if (!Number.isSafeInteger(maxLabels) || maxLabels < 1) throw new Error('GLiNER maxLabels must be a positive safe integer.');
  if (!Number.isSafeInteger(maxEntities) || maxEntities < 0) throw new Error('GLiNER maxEntities must be a non-negative safe integer.');

  return {
    id: 'specialist.gliner',
    modelRevision: options.modelRevision,
    validateInput: value => validateGlinerExtractionRequest(value, { maxTextCharacters, maxLabels }),
    async invoke(request, context) {
      const output = await options.runtime.extract(request, context);
      if (!validateGlinerExtractionResult(output, request, maxEntities)) {
        throw new Error('GLiNER returned an invalid or non-source-grounded entity result.');
      }
      return {
        entities: output.entities.map(entity => ({
          start: entity.start,
          end: entity.end,
          text: entity.text,
          label: entity.label,
          score: entity.score,
        })),
      };
    },
  };
}
