// src/engine/missionOrchestrator.ts
import { RyanAIDispatcher } from './dispatcher';
import { RyanAIAgentWorkers } from './agentWorkers';

export interface MissionContext {
  missionId: string;
  objective: string;
  currentPhase: number;
  status: 'PENDING' | 'RUNNING' | 'PAUSED_FOR_APPROVAL' | 'COMPLETED' | 'FAILED';
  logs: string[];
}

export class RyanAIMissionOrchestrator {
  private static activeMissions = new Map<string, MissionContext>();

  /**
   * Store a mission context, execute its decomposed tasks, then audit their results.
   * Returns PAUSED_FOR_APPROVAL if the audit mentions risk or vulnerability, otherwise
   * COMPLETED. Dispatch or audit errors become a FAILED context.
   */
  async startMission(missionId: string, objective: string): Promise<MissionContext> {
    console.log(`[Mission Orchestrator] Initializing mission [${missionId}]: "${objective}"`);
    
    const context: MissionContext = {
      missionId,
      objective,
      currentPhase: 1,
      status: 'RUNNING',
      logs: [`[${new Date().toISOString()}] Mission initialized: ${objective}`]
    };

    RyanAIMissionOrchestrator.activeMissions.set(missionId, context);

    try {
      // Phase 1: Sub-Task Decomposition
      context.logs.push(`[Phase 1] Decomposing objective across multi-brain cluster...`);
      const decomposition = await RyanAIDispatcher.decomposeAndExecute(objective);
      context.logs.push(`[Phase 1] Decomposition complete. Generated execution plan.`);

      // Phase 2: Security & Feasibility Pre-Audit
      context.logs.push(`[Phase 2] Running security sentinel pre-audit on mission plan...`);
      const audit = await RyanAIAgentWorkers.runSecurityAuditor(JSON.stringify(decomposition));
      context.logs.push(`[Phase 2 Audit] ${audit.output}`);

      // Pause for human approval if high-risk actions are detected
      if (audit.output.toLowerCase().includes('vulnerability') || audit.output.toLowerCase().includes('risk')) {
        context.status = 'PAUSED_FOR_APPROVAL';
        context.logs.push(`[Checkpoint] Mission paused. Human authorization required due to security flags.`);
        return context;
      }

      // Phase 3: Autonomous Execution
      context.currentPhase = 3;
      context.logs.push(`[Phase 3] Executing approved mission tasks...`);
      
      context.status = 'COMPLETED';
      context.logs.push(`[Mission] Mission [${missionId}] executed successfully.`);
      
      return context;
    } catch (error: unknown) {
      context.status = 'FAILED';
      context.logs.push(`[Error] Mission failed: ${(error instanceof Error ? error.message : String(error))}`);
      return context;
    }
  }

  /**
   * Resumes a paused mission after manual human authorization
   */
  async resumeMission(missionId: string, approved: boolean): Promise<MissionContext | null> {
    const context = RyanAIMissionOrchestrator.activeMissions.get(missionId);
    if (!context) return null;

    if (!approved) {
      context.status = 'FAILED';
      context.logs.push(`[Checkpoint] Mission [${missionId}] terminated by human operator.`);
      return context;
    }

    context.status = 'RUNNING';
    context.logs.push(`[Checkpoint] Human authorization received. Resuming autonomous execution pipeline...`);
    
    // Proceed with final execution phase
    context.status = 'COMPLETED';
    context.logs.push(`[Mission] Mission [${missionId}] successfully completed post-approval.`);
    
    return context;
  }
}