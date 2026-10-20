// Keep the runtime contract in the checkout; safe fallbacks prevent build failures.
export const API_ROUTES = Object.freeze({
  healthPath: '/api/health',
  reasonPath: '/api/reason',
  streamPath: '/api/reasoning/stream',
});

// Route id (not a path) used for unknown hash segments; keep in sync with
// app/routes.json "defaultRoute". Inlined so the server build does not need to
// import JSON from outside src/.
export const UI_CONFIG = Object.freeze({
  defaultRoute: 'landing' as const,
});

export const RYANAI_CORE = Object.freeze({
  api: API_ROUTES,
  ui: UI_CONFIG,
  activeSkills: ['autonomous-reasoning', 'agent-pa-core'],
});

interface CoreConfig {
  version?: string;
  environment?: string;
  [key: string]: unknown;
}

const coreConfig: CoreConfig = {
  version: "0.1.0",
  environment:
    (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE || "production",
};

export default coreConfig;
