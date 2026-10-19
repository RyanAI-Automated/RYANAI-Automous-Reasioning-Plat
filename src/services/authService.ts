// File path: frontend/src/services/authService.ts

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export async function authenticateUser(endpoint: 'signup' | 'signin', credentials: Record<string, string>) {
  const response = await fetch(`${API_BASE}/api/auth/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Authentication failed");
  
  if (data.token) {
    localStorage.setItem("ryan_auth_token", data.token);
  }
  return data;
}

export async function fetchCurrentProfile() {
  const token = localStorage.getItem("ryan_auth_token");
  if (!token) throw new Error("No active session token found");

  const response = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to fetch profile");
  return data.user;
}