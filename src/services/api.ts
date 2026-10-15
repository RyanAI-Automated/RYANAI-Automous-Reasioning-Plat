// File path: ./src/services/api.ts

import { authenticatedFetch } from '@/lib/authenticatedFetch';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// --- Interfaces ---

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

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt?: string;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  token?: string;
  user: AuthUser;
  error?: string;
  details?: unknown;
}

// --- System & Agent Services ---

/**
 * Fetch current system health status.
 */
export async function fetchSystemHealth(): Promise<SystemHealth> {
  const response = await fetch(`${API_BASE_URL}/api/health`);
  if (!response.ok) {
    throw new Error(`Health check failed with status: ${response.status}`);
  }
  return response.json();
}

/**
 * Submit an authenticated prompt and return the parsed reasoning response.
 * Rejects HTTP errors using the API error when available.
 */
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

// --- Authentication Client ---

export const authClient = {
  /**
   * Register a new user account.
   */
  async signup(data: { email: string; password: string; name: string }): Promise<AuthResponse> {
    const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Failed to sign up');
    }

    if (result.token) {
      localStorage.setItem('ryanai_token', result.token);
    }

    return result;
  },

  /**
   * Authenticate existing user credentials.
   */
  async signin(data: { email: string; password: string }): Promise<AuthResponse> {
    const response = await fetch(`${API_BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Failed to sign in');
    }

    if (result.token) {
      localStorage.setItem('ryanai_token', result.token);
    }

    return result;
  },

  /**
   * Fetch current authenticated user profile using the stored token.
   */
  async getMe(): Promise<AuthResponse> {
    const token = localStorage.getItem('ryanai_token');
    if (!token) {
      throw new Error('No authentication token found');
    }

    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Unauthorized');
    }

    return result;
  },

  /**
   * Log out user by clearing the stored session token.
   */
  logout(): void {
    localStorage.removeItem('ryanai_token');
  },
};
