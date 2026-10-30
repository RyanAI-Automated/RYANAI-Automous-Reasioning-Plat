// src/engine/missionOrchestrator.ts
import { RyanAIDispatcher, validateSubTaskPlan, type SubTask, type SubTaskResult } from './dispatcher';
import { RyanAIAgentWorkers } from './agentWorkers';
import { RyanAICheckpointer } from './checkpointer';

export interface MissionContext {
  missionId: string;
  objective: string;
  currentPhase: number;
  status: 'PENDING' | 'RUNNING' | 'PAUSED_FOR_APPROVAL' | 'COMPLETED' | 'FAILED';
  logs: string[];
  tasks?: SubTask[];
  results?: SubTaskResult[];
}

export class RyanAIMissionOrchestrator {
  private static activeMissions = new Map<string, MissionContext>();

  private async checkpoint(context: MissionContext, step: number): Promise<void> {
    const saved = await RyanAICheckpointer.saveCheckpoint(context.missionId, step, context);
    if (!saved) throw new Error('Mission checkpoint could not be persisted; execution is paused to protect recovery state.');
  }

  private async executeApproved(context: MissionContext): Promise<MissionContext> {
    if (!context.tasks?.length) {
      context.status = 'FAILED';
      context.logs.push('[Error] No validated task plan is available; refusing to mark mission complete.');
      return context;
    }
    context.status = 'RUNNING';
    context.currentPhase = 3;
    context.logs.push('[Phase 3] Executing approved analysis tasks in parallel...');
    try {
      await this.checkpoint(context, 3);
      context.results = await RyanAIDispatcher.executeTasks(context.tasks);
      context.status = 'COMPLETED';
      context.logs.push(`[Mission] Completed ${context.results.length} of ${context.tasks.length} approved analysis tasks.`);
      await this.checkpoint(context, 4);
      return context;
    } catch (error: unknown) {
      context.status = 'FAILED';
      context.logs.push(`[Error] Task execution failed: ${error instanceof Error ? error.message : String(error)}`);
      try { await this.checkpoint(context, 4); } catch { context.logs.push('[Recovery] Final failure state could not be persisted.'); }
      return context;
    }
  }

  /** Plan first, audit second, and execute only after an explicit LOW-risk result. */
  async startMission(missionId: string, objective: string): Promise<MissionContext> {
    const context: MissionContext = {
      missionId,
      objective,
      currentPhase: 1,
      status: 'RUNNING',
      logs: [`[${new Date().toISOString()}] Mission initialized.`],
    };
    if (!missionId.trim() || missionId.length > 120 || RyanAIMissionOrchestrator.activeMissions.has(missionId)) {
      context.status = 'FAILED';
      context.logs.push('[Error] Mission ID is invalid or already active.');
      return context;
    }
    RyanAIMissionOrchestrator.activeMissions.set(missionId, context);

    try {
      context.logs.push('[Phase 1] Creating a bounded task plan; no tasks have executed.');
      const planned = await RyanAIDispatcher.planObjective(objective);
      context.tasks = planned.tasks;
      await this.checkpoint(context, 1);

      context.currentPhase = 2;
      context.logs.push('[Phase 2] Security Sentinel is reviewing the plan before execution.');
      const audit = await RyanAIAgentWorkers.runSecurityAuditor(JSON.stringify({
        objective,
        tasks: planned.tasks,
      }));
      context.logs.push(`[Security Audit] ${audit.output}`);

      if (!/^RISK_LEVEL:\s*LOW\s*$/im.test(audit.output)) {
        context.status = 'PAUSED_FOR_APPROVAL';
        context.logs.push('[Checkpoint] Risk is elevated or unclear. No mission tasks were executed; administrator approval is required.');
        await this.checkpoint(context, 2);
        return context;
      }

      context.logs.push('[Security Gate] Explicit LOW-risk decision received.');
      return this.executeApproved(context);
    } catch (error: unknown) {
      context.status = 'FAILED';
      context.logs.push(`[Error] Mission failed before execution: ${error instanceof Error ? error.message : String(error)}`);
      try { await this.checkpoint(context, context.currentPhase); } catch { context.logs.push('[Recovery] Failure state could not be persisted.'); }
      return context;
    }
  }

  /** Resume only the stored, validated task plan after an explicit human decision. */
  async resumeMission(missionId: string, approved: boolean): Promise<MissionContext | null> {
    let context = RyanAIMissionOrchestrator.activeMissions.get(missionId);
    if (!context) {
      const checkpoint = await RyanAICheckpointer.getLatestCheckpoint(missionId);
      const restored = checkpoint?.state as Partial<MissionContext> | undefined;
      if (
        !restored ||
        restored.missionId !== missionId ||
        restored.status !== 'PAUSED_FOR_APPROVAL' ||
        !Array.isArray(restored.tasks)
      ) return null;
      try {
        restored.tasks = validateSubTaskPlan(restored.tasks);
      } catch {
        return null;
      }
      context = restored as MissionContext;
      RyanAIMissionOrchestrator.activeMissions.set(missionId, context);
    }
    if (context.status !== 'PAUSED_FOR_APPROVAL') return null;

    if (!approved) {
      context.status = 'FAILED';
      context.logs.push('[Checkpoint] Mission rejected by the human operator; no tasks executed.');
      try { await this.checkpoint(context, context.currentPhase); } catch { context.logs.push('[Recovery] Rejection state could not be persisted.'); }
      return context;
    }

    context.logs.push('[Checkpoint] Human authorization received for the stored task plan.');
    return this.executeApproved(context);
  }

  static getMission(missionId: string): MissionContext | null {
    return this.activeMissions.get(missionId) ?? null;
  }
}
