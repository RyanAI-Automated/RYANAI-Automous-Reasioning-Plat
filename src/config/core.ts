// Keep the runtime contract in the checkout; safe fallbacks prevent build failures.
export const API_ROUTES = Object.freeze({
  healthPath: '/api/health',
  reasonPath: '/api/reason',
  streamPath: '/api/reasoning/stream',
});

export const UI_CONFIG = Object.freeze({
  defaultRoute: '/dashboard',
});

export const RYANAI_CORE = Object.freeze({
  api: API_ROUTES,
  ui: UI_CONFIG,
  activeSkills: ['autonomous-reasoning', 'agent-pa-core'],
});

interface CoreConfig {
  version?: string;
  environment?: string;
  [key: string]: any;
}

const coreConfig: CoreConfig = {
  version: "0.1.0",
  environment: import.meta.env.MODE || "production",
};

export default coreConfig;
