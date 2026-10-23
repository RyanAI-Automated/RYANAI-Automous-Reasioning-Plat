import { FastifyServerOptions } from 'fastify';

const isProduction = process.env.NODE_ENV === 'production';

export const loggerConfig: FastifyServerOptions['logger'] = isProduction
  ? {
      level: process.env.LOG_LEVEL || 'info',
      // Redact sensitive headers or fields from logs automatically
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-slack-signature"]',
          'body.password',
          'password',
        ],
        censor: '[REDACTED]',
      },
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            parameters: request.params,
            query: request.query,
            // Remote IP tracking
            remoteAddress: request.ip,
          };
        },
      },
    }
  : {
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    };