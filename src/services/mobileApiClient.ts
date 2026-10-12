// src/services/mobileApiClient.ts
const BACKEND_URL = process.env.EXPO_PUBLIC_RYAN_API_URL || "https://api.ryanganyane.co.za"; // Or local IP for development

export interface AgentEvolutionResponse {
  status: string;
  objective: string;
  result: string;
}

export class MobileApiClient {
  /**
   * Post an evolution objective and return the parsed response.
   * HTTP errors reject with the API error when available; fetch and JSON errors propagate.
   */
  public static async executeObjective(objective: string): Promise<AgentEvolutionResponse> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/agent/evolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ objective }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error((errorData as { error?: string } | null)?.error || `Server responded with status ${response.status}`);
      }

      return await response.json() as AgentEvolutionResponse;
    } catch (error: unknown) {
      console.error("[Mobile API Error]:", (error instanceof Error ? error.message : String(error)));
      throw error;
    }
  }

  /** Return parsed health JSON regardless of HTTP status, or offline on fetch/parse failure. */
  public static async checkHealth(): Promise<unknown> {
    try {
      const response = await fetch(`${BACKEND_URL}/health`);
      return await response.json();
    } catch {
      return { status: "offline" };
    }
  }
}