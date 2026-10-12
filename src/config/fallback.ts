// src/config/fallback.ts
import { primaryBrain, secondaryBrain, logicBrain } from './brains';
import { BaseMessage } from '@langchain/core/messages';

export class BrainFallbackHandler {
  /**
   * Invoke the selected model, retrying once with the secondary model on failure.
   * Returns the successful response; if the retry fails, its error reaches the caller.
   * Selecting the secondary model therefore retries that same model.
   */
  static async safeInvoke(
    brainType: 'primary' | 'secondary' | 'logic',
    messages: BaseMessage[]
  ) {
    const targetBrain = 
      brainType === 'primary' ? primaryBrain :
      brainType === 'secondary' ? secondaryBrain : logicBrain;

    const fallbackBrain = secondaryBrain; // Fallback to Qwen if primary fails

    try {
      const response = await targetBrain.invoke(messages);
      return response;
    } catch (error: unknown) {
      console.warn(`[Fallback Warning] ${brainType} brain failed: ${(error instanceof Error ? error.message : String(error))}. Routing to fallback brain...`);
      
      try {
        const fallbackResponse = await fallbackBrain.invoke(messages);
        return fallbackResponse;
      } catch (fallbackError: unknown) {
        console.error(`[Critical Error] Fallback brain also failed: ${(fallbackError instanceof Error ? fallbackError.message : String(fallbackError))}`);
        throw fallbackError;
      }
    }
  }
}