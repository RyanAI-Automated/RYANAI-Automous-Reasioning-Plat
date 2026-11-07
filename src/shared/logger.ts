// src/shared/logger.ts - Unified logging
import pino from 'pino';
import { getConfig } from './config.js';

const config = getConfig();
const isDevelopment = config.nodeEnv === 'development';

// Pretty transport is intentionally limited to local development. Staging and
// production images omit devDependencies, and should emit structured JSON logs.
const transport = isDevelopment
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: false,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  ...(transport && { transport }),
});

export const createLogger = (module: string) => {
  return logger.child({ module });
};

export default logger;
