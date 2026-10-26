import { ChatOpenAI } from '@langchain/openai';
import modelCatalog from '../../models/catalog.json' with { type: 'json' };

/** Model used when a caller names none. OPENAI_MODEL overrides the catalog default. */
export const defaultModel = process.env.OPENAI_MODEL || modelCatalog.defaultModel;

/**
 * Build a chat model for the OpenAI-compatible endpoint named in the environment.
 * Every agent in the server uses this function, so one set of variables
 * (OPENAI_MODEL, OPENAI_BASE_URL, OPENAI_API_KEY) controls all of them.
 */
export function createChatModel(model = defaultModel) {
  return new ChatOpenAI({
    modelName: model,
    temperature: 0,
    configuration: {
      ...(process.env.OPENAI_BASE_URL
        ? { baseURL: process.env.OPENAI_BASE_URL }
        : {}),
      ...(process.env.OPENAI_API_KEY
        ? { apiKey: process.env.OPENAI_API_KEY }
        : {}),
    },
  });
}
