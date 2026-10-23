// src/engine/autonomousLoop.ts
import { RyanAIDispatcher } from './dispatcher';
import { AgenticReflectionLoop } from './reflection';
import { RyanAICheckpointer } from './checkpointer';

export interface MissionResult {
  missionId: string;
  objective: string;
  status: string;
  stepsCompleted: number;
  manifest: unknown[];
}

export class RyanAIAutonomousLoop {
  /**
   * Executes a complex, multi-step engineering objective with automated dispatching,
   * self-correction reflection loops, and persistent checkpoint recovery.
   */
  static async executeAutonomousMission(missionId: string, objective: string): Promise<MissionResult> {
    console.log(`[Autonomous Mission] Initializing long-horizon mission [${missionId}]: "${objective}"`);

    // 1. Decompose the master objective into structured sub-tasks across the cluster
    const dispatchResult = await RyanAIDispatcher.decomposeAndExecute(objective);
    
    const refinedOutputs = [];
    let step = 1;

    // 2. Iterate through each sub-task, applying reflection and checkpointing
    for (const subTask of dispatchResult.results) {
      console.log(`[Autonomous Mission] Step ${step}: Processing sub-task [${subTask.id}] on brain [${subTask.brain}]`);

      // Run through the self-correction reflection loop to ensure high precision
      const refinedOutput = await AgenticReflectionLoop.executeWithReflection(
        subTask.title,
        subTask.output
      );

      refinedOutputs.push({
        id: subTask.id,
        title: subTask.title,
        brainUsed: subTask.brain,
        output: refinedOutput
      });

      // Persist checkpoint state to PostgreSQL after every completed sub-task
      await RyanAICheckpointer.saveCheckpoint(missionId, step, {
        objective,
        completedSubTasks: refinedOutputs
      });

      step++;
    }

    console.log(`[Autonomous Mission] Mission [${missionId}] successfully completed across all ${refinedOutputs.length} steps.`);

    return {
      missionId,
      objective,
      status: "success",
      stepsCompleted: refinedOutputs.length,
      manifest: refinedOutputs
    };
  }
}