// src/shared/config.ts - Unified configuration loader
import { AppConfig } from './types.js';

/**
 * Merges partial overrides with environment variables and sane defaults to build a fully
 * populated AppConfig. The `nodeEnv` default is derived from `process.env.NODE_ENV` so that
 * container-supplied values (e.g. `production`/`staging`) are honored instead of always
 * falling back to `development`.
 */
function validateConfig(config: Partial<AppConfig>): AppConfig {
  const environment = process.env.NODE_ENV;
  const defaultNodeEnv: AppConfig['nodeEnv'] =
    environment === 'production' || environment === 'staging'
      ? environment
      : 'development';
  const {
    nodeEnv = defaultNodeEnv,
    port = 3000,
    host = '0.0.0.0',
    database = {},
    redis = {},
    jwt = {},
    api = {},
    mcp = {},
    openai = {},
    sentry = {},
    tauri = {},
  } = config;

  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:[REDACTED]@localhost:5432/ryanai';
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const jwtSecret = process.env.JWT_SECRET || 'dev-secret-key-change-in-prod';
  const openaiKey = process.env.OPENAI_API_KEY || '';
  const sentryDsn = process.env.SENTRY_DSN || '';

  return {
    nodeEnv: nodeEnv || 'development',
    port: parseInt(process.env.PORT || String(port), 10),
    host,
    database: {
      url: dbUrl,
      maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
      timeoutMs: parseInt(process.env.DB_TIMEOUT_MS || '2000', 10),
      ...database,
    },
    redis: {
      url: redisUrl,
      timeout: parseInt(process.env.REDIS_TIMEOUT || '5000', 10),
      ...redis,
    },
    jwt: {
      secret: jwtSecret,
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
      ...jwt,
    },
    api: {
      baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
      timeout: parseInt(process.env.API_TIMEOUT || '30000', 10),
      ...api,
    },
    mcp: {
      enabled: process.env.MCP_ENABLED !== 'false',
      serverPort: parseInt(process.env.MCP_PORT || '8765', 10),
      ...mcp,
    },
    openai: {
      apiKey: openaiKey,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      ...openai,
    },
    sentry: {
      enabled: process.env.SENTRY_ENABLED === 'true',
      dsn: sentryDsn,
      ...sentry,
    },
    tauri: {
      enabled: process.env.TAURI_ENABLED === 'true',
      allowedOrigins: (process.env.TAURI_ALLOWED_ORIGINS || 'http://localhost:5173').split(','),
      ...tauri,
    },
  };
}

let config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!config) {
    config = validateConfig({});
  }
  return config;
}

export function initConfig(overrides?: Partial<AppConfig>): AppConfig {
  config = validateConfig(overrides || {});
  return config;
}

export default getConfig;
