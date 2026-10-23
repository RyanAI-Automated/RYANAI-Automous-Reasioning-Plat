// File path: shared/utils/env.ts

/**
 * Retrieves an environment variable seamlessly across Vite (Tauri/Browser) 
 * and Node.js (Fastify/Server) environments, with auto-prefixing fallback 
 * for `VITE_` variables.
 *
 * @param key - The environment variable key (e.g., 'API_URL' or 'VITE_API_URL')
 * @param defaultValue - Fallback value if the variable is undefined (default: '')
 * @returns The resolved environment variable as a string, or the default value
 */
export const getEnvVar = (key: string, defaultValue = ''): string => {
  const viteKey = key.startsWith('VITE_') ? key : `VITE_${key}`;

  // 1. Check Vite / Client environment
  // Safely cast import.meta to avoid TS errors in strict Node contexts
  if (typeof import.meta !== 'undefined' && 'env' in import.meta) {
    const viteEnv = (import.meta as ImportMeta & { env: Record<string, unknown> }).env;
    if (viteEnv[viteKey] !== undefined) return String(viteEnv[viteKey]);
    if (viteEnv[key] !== undefined) return String(viteEnv[key]);
  }

  // 2. Check Node.js / Server environment
  if (typeof process !== 'undefined' && process.env) {
    if (process.env[key] !== undefined) return String(process.env[key]);
    if (process.env[viteKey] !== undefined) return String(process.env[viteKey]);
  }

  return defaultValue;
};