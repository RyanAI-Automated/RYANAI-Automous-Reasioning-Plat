// src/engine/reflection.ts
import { primaryBrain, secondaryBrain } from '../config/brains';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export class AgenticReflectionLoop {
  /**
   * Evaluates and iteratively refines reasoning output until it passes quality standards
   */
  static async executeWithReflection(task: string, initialDraft: string, maxIterations = 2): Promise<string> {
    let currentDraft = initialDraft;
    let iteration = 0;

    while (iteration < maxIterations) {
      console.log(`[Reflection Engine] Evaluating draft quality (Iteration ${iteration + 1}/${maxIterations})...`);

      // 1. Secondary Brain critiques the draft
      const critiquePrompt = new SystemMessage(
        "You are the Critical Reviewer. Analyze the draft against the original task. " +
        "If it is fully accurate, robust, and complete, reply with 'APPROVED'. " +
        "If there are flaws, missing code, or logic errors, specify the exact corrections required."
      );
      
      const critiqueResponse = await secondaryBrain.invoke([
        critiquePrompt,
        new HumanMessage(`Original Task: ${task}\n\nCurrent Draft:\n${currentDraft}`)
      ]);

      const critiqueText = critiqueResponse.content.toString();

      if (critiqueText.includes("APPROVED")) {
        console.log("[Reflection Engine] Draft approved by validation brain.");
        break;
      }

      console.log("[Reflection Engine] Corrections requested. Refining via Primary Brain...");

      // 2. Primary Brain refines the output based on critique
      const refinementPrompt = new SystemMessage("Refine the previous draft by strictly addressing the reviewer's critique.");
      const refinementResponse = await primaryBrain.invoke([
        refinementPrompt,
        new HumanMessage(`Task: ${task}\n\nCurrent Draft: ${currentDraft}\n\nReviewer Critique: ${critiqueText}`)
      ]);

      currentDraft = refinementResponse.content.toString();
      iteration++;
    }

    return currentDraft;
  }
}