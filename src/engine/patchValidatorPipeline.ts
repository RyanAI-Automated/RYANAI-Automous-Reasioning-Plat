// src/engine/patchValidatorPipeline.ts
import { primaryBrain } from '../config/brains';
import { RyanAISandbox } from './sandbox';
import { RyanAIAutoDebugger } from './autoDebugger';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export interface PatchValidationResult {
  success: boolean;
  generatedPatch: string;
  sandboxOutput: string;
  attempts: number;
}

export class RyanPatchValidatorPipeline {
  /**
   * Objective 2 & 3: Generates an optimized patch via the primary brain,
   * then compiles and validates it inside the isolated sandbox runtime.
   */
  public static async executePatchCycle(targetProblem: string, existingCodeSnippet: string): Promise<PatchValidationResult> {
    console.log("[Objective 2] Primary tensor brain drafting optimized TypeScript patch...");

    // Objective 2: Autonomous Patch Generation
    const promptResponse = await primaryBrain.invoke([
      new SystemMessage(
        "You are the Lead Code Generation Agent for RyanAI. " +
        "Analyze the target problem and existing code snippet. Write a clean, highly optimized, " +
        "self-contained TypeScript patch or solution. Return ONLY valid, executable TypeScript code " +
        "wrapped in standard code blocks."
      ),
      new HumanMessage(`Target Problem: ${targetProblem}\n\nExisting Code Context:\n${existingCodeSnippet}`)
    ]);

    const rawContent = promptResponse.content.toString();
    const extractedCode = this.extractCodeBlock(rawContent);

    console.log("[Objective 3] Passing generated patch to isolated RyanAISandbox for validation...");

    let sandboxResult = await RyanAISandbox.executeInSandbox(extractedCode, "autonomous_patch.js");
    if (sandboxResult.success) {
      return {
        success: true,
        generatedPatch: extractedCode,
        sandboxOutput: sandboxResult.output || "",
        attempts: 1,
      };
    }

    console.warn("[Auto-Debugger] Initial isolated verification failed. Requesting a bounded repair...");
    const repaired = await RyanAIAutoDebugger.debugAndRepair(extractedCode, sandboxResult, 2);
    if (!repaired.success) {
      return {
        success: false,
        generatedPatch: repaired.finalCode,
        sandboxOutput: "Patch was not promoted. Isolated verification did not pass.",
        attempts: repaired.attempts + 1,
      };
    }
    return {
      success: true,
      generatedPatch: repaired.finalCode,
      sandboxOutput: "Repaired candidate passed isolated verification.",
      attempts: repaired.attempts + 1,
    };
  }

  private static extractCodeBlock(response: string): string {
    const match = response.match(/```(?:typescript|ts)?([\s\S]*?)```/);
    return match ? match[1].trim() : response.trim();
  }
}