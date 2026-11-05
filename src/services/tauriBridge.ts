import { invoke, isTauri } from '@tauri-apps/api/core';
import { supabase } from '@/lib/supabase';
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

async function getSignedInAccessToken(): Promise<string> {
  if (!supabase) {
    throw new Error('Sign-in is unavailable. Please contact your administrator.');
  }

  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken || data.session?.user?.is_anonymous === true) {
    throw new Error('Sign in to continue.');
  }

  return accessToken;
}

export class TauriBridge {
  /** Route an objective to native IPC on desktop or the same authenticated API on web. */
  public static async executeObjective(objective: string): Promise<AgentResponse> {
    const normalizedObjective = objective.trim();
    if (!normalizedObjective) {
      throw new Error('A non-empty objective is required.');
    }

    try {
      if (isTauri()) {
        // The native process receives only the current user's short-lived session
        // token for this request. It must never persist or log this credential.
        const accessToken = await getSignedInAccessToken();
        return await invoke<AgentResponse>('trigger_agent_objective', {
          objective: normalizedObjective,
          accessToken,
        });
      }

      const response = await executeAgentReasoning(normalizedObjective);
      return {
        status: response.success ? 'completed' : 'failed',
        objective: response.objective || normalizedObjective,
        result: response.output || '',
      };
    } catch (error: unknown) {
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
