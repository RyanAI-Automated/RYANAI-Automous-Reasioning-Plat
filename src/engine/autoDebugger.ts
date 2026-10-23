// src/engine/autoDebugger.ts
import { primaryBrain, logicBrain } from '../config/brains';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { RyanAISandbox, SandboxResult } from './sandbox';

export class RyanAIAutoDebugger {
  /**
   * Automatically diagnoses a failed code execution, generates a patch, and verifies it in the sandbox
   */
  static async debugAndRepair(
    originalCode: string,
    initialError: SandboxResult,
    maxAttempts = 3
  ): Promise<{ success: boolean; finalCode: string; attempts: number }> {
    let currentCode = originalCode;
    let lastError = initialError;
    let attempt = 1;

    console.log("[Auto-Debugger] Initializing self-healing repair loop...");

    while (attempt <= maxAttempts && !lastError.success) {
      console.log(`[Auto-Debugger] Repair iteration ${attempt}/${maxAttempts} for failed execution...`);

      // 1. Logic Brain diagnoses the error and determines the fix
      const diagnosisPrompt = new SystemMessage(
        "You are the Automated Debugger and Root Cause Analysis Engine for RyanAI. " +
        "Analyze the code and the stderr traceback. Provide a precise technical diagnosis and the corrected code block."
      );

      const diagnosisResponse = await logicBrain.invoke([
        diagnosisPrompt,
        new HumanMessage(`Failing Code:\n${currentCode}\n\nExecution Error Traceback:\n${lastError.stderr}`)
      ]);

      const diagnosisText = diagnosisResponse.content.toString();

      // 2. Primary Brain generates the refined patch code
      const patchPrompt = new SystemMessage(
        "Generate ONLY the fully corrected, executable code script based on the debugger's analysis. " +
        "Do not include conversational filler or markdown code truncation."
      );

      const patchResponse = await primaryBrain.invoke([
        patchPrompt,
        new HumanMessage(`Diagnosis & Instructions:\n${diagnosisText}`)
      ]);

      currentCode = patchResponse.content.toString().replace(/```typescript|```javascript|```/g, '').trim();

      // 3. Re-test the patched code inside the isolated sandbox
      console.log("[Auto-Debugger] Verifying patch in isolated sandbox runtime...");
      lastError = await RyanAISandbox.executeInSandbox(currentCode, `repaired_payload_${attempt}.js`);

      if (lastError.success) {
        console.log(`[Auto-Debugger] Success! Code successfully repaired on attempt ${attempt}.`);
        return { success: true, finalCode: currentCode, attempts: attempt };
      }

      attempt++;
    }

    console.warn("[Auto-Debugger] Max repair attempts reached without achieving successful execution.");
    return { success: false, finalCode: currentCode, attempts: maxAttempts };
  }
}