import { authenticatedFetch } from '@/lib/authenticatedFetch';
// File path: ./src/services/api.ts

import { API_BASE_URL } from '../lib/apiBaseUrl';

export interface ReasonResponse {
  success: boolean;
  objective: string;
  reasoningTrace: string[];
  output: string;
  timestamp: string;
}

export interface SystemHealth {
  status: string;
  engine: string;
  architect: string;
  cudaActive: boolean;
  activeGraph: string;
  timestamp: string;
}

export async function fetchSystemHealth(): Promise<SystemHealth> {
  const response = await fetch(`${API_BASE_URL}/api/health`);
  if (!response.ok) {
    throw new Error(`Health check failed with status: ${response.status}`);
  }
  return response.json();
}

export async function executeAgentReasoning(
  prompt: string,
): Promise<ReasonResponse> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/reason`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      (errorData as { error?: string } | null)?.error ||
        `Reasoning execution failed with status: ${response.status}`,
    );
  }

  return response.json();
}
