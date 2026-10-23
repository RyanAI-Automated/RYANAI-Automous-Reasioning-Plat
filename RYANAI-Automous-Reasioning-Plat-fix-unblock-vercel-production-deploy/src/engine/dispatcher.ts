// src/engine/dispatcher.ts
import { primaryBrain, secondaryBrain, logicBrain } from '../config/brains';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export interface SubTask {
  id: string;
  title: string;
  targetBrain: 'nvidia' | 'qwen' | 'logic';
  payload: string;
}

export class RyanAIDispatcher {
  /**
   * Decompose an objective and execute the resulting tasks concurrently across the cluster.
   * Invalid plan JSON falls back to one primary-model task. Returns the original plan
   * text and task outputs with durations in seconds as strings; model errors propagate.
   * Valid JSON with an unusable task shape can still throw.
   */
  static async decomposeAndExecute(masterObjective: string) {
    console.log("[Dispatcher] Decomposing master objective across cluster...");

    // 1. Logic Brain breaks the objective into structured sub-tasks JSON
    const decompositionPrompt = new SystemMessage(
      "You are the Master Dispatcher. Break down the user's objective into 2 to 3 distinct sub-tasks. " +
      "Return ONLY a valid JSON array of objects with keys: id, title, targetBrain ('nvidia', 'qwen', or 'logic'), and payload."
    );

    const planResponse = await logicBrain.invoke([
      decompositionPrompt,
      new HumanMessage(masterObjective)
    ]);

    let subTasks: SubTask[] = [];
    try {
      // Clean up markdown code blocks if the model wrapped the JSON
      const rawText = planResponse.content.toString().replace(/```json/g, '').replace(/```/g, '').trim();
      subTasks = JSON.parse(rawText);
    } catch {
      console.warn("[Dispatcher Warning] Failed to parse sub-task JSON. Falling back to single-node execution.");
      subTasks = [{ id: "task-1", title: "Direct Execution", targetBrain: "nvidia", payload: masterObjective }];
    }

    console.log(`[Dispatcher] Successfully split into ${subTasks.length} concurrent sub-tasks. Executing...`);

    // 2. Execute sub-tasks concurrently across assigned brains
    const executionPromises = subTasks.map(async (task) => {
      const target = 
        task.targetBrain === 'nvidia' ? primaryBrain :
        task.targetBrain === 'qwen' ? secondaryBrain : logicBrain;

      const startTime = performance.now();
      const res = await target.invoke([
        new SystemMessage(`Execute sub-task: ${task.title}`),
        new HumanMessage(task.payload)
      ]);
      const duration = ((performance.now() - startTime) / 1000).toFixed(2);

      return {
        id: task.id,
        title: task.title,
        brain: task.targetBrain,
        durationSeconds: duration,
        output: res.content.toString()
      };
    });

    const results = await Promise.all(executionPromises);

    console.log("[Dispatcher] All concurrent sub-tasks completed and synchronized.");
    return {
      plan: planResponse.content.toString(),
      results
    };
  }
}