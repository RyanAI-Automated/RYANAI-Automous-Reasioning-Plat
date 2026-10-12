// src/services/tauriBridge.ts
import { invoke } from "@tauri-apps/api/core";

export interface AgentResponse {
  status: string;
  objective: string;
  result: string;
}

export class TauriBridge {
  /** Invoke the desktop objective command, wrapping IPC failures in an Error. */
  public static async executeObjective(objective: string): Promise<AgentResponse> {
    try {
      const response = await invoke<AgentResponse>("trigger_agent_objective", { objective });
      return response;
    } catch (error: unknown) {
      console.error("[Tauri IPC Error]:", error);
      throw new Error(String(error || "Unknown Tauri IPC execution failure."));
    }
  }

  /** Return the desktop system-status command result; IPC failures propagate. */
  public static async checkSystemHealth(): Promise<unknown> {
    return await invoke("get_system_status");
  }
}