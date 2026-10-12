import appManifest from '../../app/routes.json' with { type: 'json' };

// Keep the runtime contract in the checkout; the legacy RYANAI gitlink is optional.
export const API_ROUTES = Object.freeze({
  healthPath: '/api/health',
  reasonPath: '/api/reason',
  streamPath: '/api/reasoning/stream',
});

export const UI_CONFIG = Object.freeze({
  defaultRoute: appManifest.defaultRoute,
});

export const RYANAI_CORE = Object.freeze({
  api: API_ROUTES,
  ui: UI_CONFIG,
  activeSkills: ['autonomous-reasoning'],
});

interface CoreConfig {
  version?: string;
  environment?: string;
  [key: string]: any;
}

let coreConfig: CoreConfig = {};

try {
  coreConfig = {
    version: "0.1.0",
    environment: import.meta.env.MODE || "production",
  };
} catch {
  coreConfig = { version: "0.1.0" };
}

export default coreConfig;
