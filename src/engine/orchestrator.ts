// File path: ./src/engine/orchestrator.ts

import { ryanAiGraph } from "./graph.js";
import { primaryBrain, secondaryBrain, logicBrain } from "../config/brains.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { MemoryRepository } from "../database/memory.js";
import { SelfPatchSkill } from "./selfPatchSkill.js";
import { CsScriptTool } from "../agent/tools/csScriptTool.js";

// Define the state interface for the LangGraph workflow
export interface RyanAIState {
  task: string;
  executionPlan: string;
  primaryOutput: string;
  finalValidation: string;
  errors: string[];
}

export interface ReasoningContext {
  goal: string;
  history: string[];
}

export class RyanAIOrchestrator {
  /**
   * Main entry point for the Reasoning Platform.
   * Attempts the LangGraph ReAct workflow first, with a fallback to the direct pipeline.
   * Automatically persists successful sessions to PostgreSQL.
   */
  static async processTask(taskPayload: string) {
    console.log("[RyanAI Orchestrator] Initializing LangGraph ReAct Workflow...");

    try {
      const initialState: RyanAIState = {
        task: taskPayload,
        executionPlan: "",
        primaryOutput: "",
        finalValidation: "",
        errors: []
      };

      // Execute the compiled LangGraph workflow
      const result = await ryanAiGraph.invoke(initialState);

      // Persist session to PostgreSQL
      await MemoryRepository.saveSession({
        taskPayload,
        logicPlan: result.executionPlan,
        primarySynthesis: result.primaryOutput,
        finalValidation: result.finalValidation
      });

      return {
        status: "success",
        mode: "graph",
        pipeline: {
          logicPlan: result.executionPlan,
          primarySynthesis: result.primaryOutput,
          finalValidation: result.finalValidation
        }
      };
    } catch (error) {
      console.warn("[RyanAI Orchestrator] LangGraph execution failed. Falling back to Direct Multi-Brain Pipeline.", error);
      return this.processTaskDirect(taskPayload);
    }
  }

  /**
   * Direct Multi-Brain Pipeline (Fallback / Manual Mode)
   * Executes the sequential logic -> primary -> secondary chain without LangGraph state management.
   */
  static async processTaskDirect(taskPayload: string) {
    console.log("[Logic Brain] Parsing task structure...");

    // 1. Logic Brain processes the raw input and structures the execution plan
    const structuralPrompt = new SystemMessage("You are the logic processor. Break down the user's task into a strict execution plan.");
    const taskMessage = new HumanMessage(taskPayload);
    const logicResponse = await logicBrain.invoke([structuralPrompt, taskMessage]);

    console.log("[Primary Brain] Executing core synthesis...");

    // 2. Primary Brain executes heavy reasoning based on the plan
    const executionPrompt = new SystemMessage("You are the Primary Brain. Execute the following execution plan with high precision.");
    const planMessage = new HumanMessage(logicResponse.content.toString());
    const primaryResponse = await primaryBrain.invoke([executionPrompt, planMessage]);

    console.log("[Secondary Brain] Cross-checking outputs...");

    // 3. Secondary Brain cross-checks the output for errors or missing context
    const validationPrompt = new SystemMessage("You are the Secondary Brain. Review the Primary Brain's output against the original task. Fix any logical errors.");
    const validationMessage = new HumanMessage(`Original Task: ${taskPayload}\n\nPrimary Output: ${primaryResponse.content.toString()}`);
    const finalResponse = await secondaryBrain.invoke([validationPrompt, validationMessage]);

    const logicPlanText = logicResponse.content.toString();
    const primarySynthesisText = primaryResponse.content.toString();
    const finalValidationText = finalResponse.content.toString();

    // Persist direct fallback session to PostgreSQL
    try {
      await MemoryRepository.saveSession({
        taskPayload,
        logicPlan: logicPlanText,
        primarySynthesis: primarySynthesisText,
        finalValidation: finalValidationText
      });
    } catch (dbError) {
      console.error("[RyanAI Orchestrator] Failed to persist direct pipeline session to database:", dbError);
    }

    return {
      status: "success",
      mode: "direct",
      pipeline: {
        logicPlan: logicPlanText,
        primarySynthesis: primarySynthesisText,
        finalValidation: finalValidationText
      }
    };
  }

  /**
   * Executes a reasoning and self-improvement cycle using autonomous tool invocation.
   */
  public static async executeCycle(goal: string): Promise<{ success: boolean; output: string; error?: string }> {
    console.log(`[RyanAI Orchestrator] Starting reasoning cycle for goal: "${goal}"`);

    // Handle self-patching goals
    if (goal.startsWith('patch:')) {
      const parts = goal.replace('patch:', '').trim().split('|');
      const filePath = parts[0]?.trim();
      const patchContent = parts[1]?.trim();

      if (!filePath || !patchContent) {
        return { success: false, output: "", error: 'Invalid patch format. Use "patch: filePath | content"' };
      }

      const result = await SelfPatchSkill.applyAndVerifyPatch({
        filePath,
        patchContent,
      });

      const isSuccess = result.status === "success";
      return {
        success: isSuccess,
        output: isSuccess ? `Successfully patched and verified ${filePath}` : "",
        error: isSuccess ? undefined : (result.error || result.message || 'Patch failed'),
      };
    }

    // Handle script execution goals
    if (goal.startsWith('cs-exec:')) {
      const scriptCode = goal.replace('cs-exec:', '').trim();
      const execResult = await CsScriptTool.executeScript(scriptCode);
      return {
        success: execResult.success,
        output: execResult.output || '',
        error: execResult.error,
      };
    }

    return {
      success: true,
      output: `Autonomous reasoning loop acknowledged goal: "${goal}". No direct execution trigger matched.`,
    };
  }
}

// Alias for backwards compatibility if referenced elsewhere as RyanOrchestrator
export const RyanOrchestrator = RyanAIOrchestrator;
