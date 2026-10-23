// src/lib/models.ts
// LLM model definitions and metadata

import type { ModelId } from './types.js';
import modelCatalog from '../../models/catalog.json';

export interface ModelMeta {
  id: ModelId;
  label: string;
  provider: string;
  contextWindow?: number;
  description: string;
}

export const DEFAULT_MODEL: ModelId = modelCatalog.defaultModel;
export const MODELS = Object.fromEntries(
  modelCatalog.models.map((model) => [model.id, model]),
) as Record<ModelId, ModelMeta>;

export const MODEL_LIST: ModelId[] = Object.keys(MODELS) as ModelId[];

export function modelMeta(modelId?: ModelId): ModelMeta {
  if (!modelId || !MODELS[modelId]) {
    return MODELS[DEFAULT_MODEL];
  }
  return MODELS[modelId];
}

export function getAvailableModels(): ModelMeta[] {
  return MODEL_LIST.map((id) => MODELS[id]);
}