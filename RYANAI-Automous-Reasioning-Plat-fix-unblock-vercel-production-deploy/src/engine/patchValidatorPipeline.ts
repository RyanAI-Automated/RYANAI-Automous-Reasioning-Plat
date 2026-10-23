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

    let attempts = 1;
    const maxAttempts = 3;
    let sandboxResult = await RyanAISandbox.executeInSandbox(extractedCode, "autonomous_patch.ts");

    // Objective 3: Sandbox Validation & Auto-Debugging Loop
    while (!sandboxResult.success && attempts < maxAttempts) {
      console.warn(`[Auto-Debugger] Sandbox execution failed on attempt ${attempts}. Analyzing traceback...`);
      
      const fixedCode = await RyanAIAutoDebugger.diagnoseAndFix(
        extractedCode, 
        sandboxResult.error || "Unknown runtime exception"
      );

      attempts++;
      console.log(`[Auto-Debugger] Re-testing patched code (Attempt ${attempts})...`);
      sandboxResult = await RyanAISandbox.executeInSandbox(fixedCode, "autonomous_patch.ts");
      
      if (sandboxResult.success) {
        return {
          success: true,
          generatedPatch: fixedCode,
          sandboxOutput: sandboxResult.output || "",
          attempts
        };
      }
    }

    return {
      success: sandboxResult.success,
      generatedPatch: extractedCode,
      sandboxOutput: sandboxResult.output || sandboxResult.error || "Execution failed",
      attempts
    };
  }

  private static extractCodeBlock(response: string): string {
    const match = response.match(/```(?:typescript|ts)?([\s\S]*?)```/);
    return match ? match[1].trim() : response.trim();
  }
}