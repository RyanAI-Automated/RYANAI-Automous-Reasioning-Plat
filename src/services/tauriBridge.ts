import { invoke, isTauri } from '@tauri-apps/api/core';
import { executeAgentReasoning, fetchSystemHealth } from './api';

export interface AgentResponse {
  status: string;
  objective: string;
  result: string;
}

export interface HardwareTelemetry {
  cpuUsage: number;
  memoryUsed: number;
  memoryTotal: number;
}

export class TauriBridge {
  /** Route an objective to native IPC on desktop or the same reasoning API on web. */
  public static async executeObjective(objective: string): Promise<AgentResponse> {
    const normalizedObjective = objective.trim();
    if (!normalizedObjective) {
      throw new Error('A non-empty objective is required.');
    }

    try {
      if (isTauri()) {
        return await invoke<AgentResponse>('trigger_agent_objective', {
          objective: normalizedObjective,
        });
      }

      const response = await executeAgentReasoning(normalizedObjective);
      return {
        status: response.success ? 'completed' : 'failed',
        objective: response.objective || normalizedObjective,
        result: response.output || '',
      };
    } catch (error: unknown) {
      console.error("[Tauri IPC Error]:", error);
      throw new Error(String(error || "Unknown Tauri IPC execution failure."), { cause: error });
      console.error('[RyanAI bridge error]:', error);
      throw new Error(
        error instanceof Error ? error.message : String(error || 'Unknown bridge failure.'),
        { cause: error },
      );
    }
  }

  /** Read native telemetry in Tauri; use the API health endpoint in browser mode. */
  public static async checkSystemHealth(): Promise<HardwareTelemetry | unknown> {
    if (isTauri()) {
      return invoke<HardwareTelemetry>('get_hardware_telemetry');
    }
    return fetchSystemHealth();
  }
}
