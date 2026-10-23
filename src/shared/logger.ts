// src/shared/logger.ts - Unified logging
import pino from 'pino';
import { getConfig } from './config.js';

const config = getConfig();

const transport = config.nodeEnv === 'production' 
  ? undefined
  : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: false,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || (config.nodeEnv === 'production' ? 'info' : 'debug'),
    ...(transport && { transport }),
  }
);

export const createLogger = (module: string) => {
  return logger.child({ module });
};

export default logger;
