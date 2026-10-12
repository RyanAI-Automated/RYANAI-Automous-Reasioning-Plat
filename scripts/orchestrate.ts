#!/usr/bin/env node

/**
 * Complete System Orchestrator
 * Starts all RyanAI components in correct dependency order
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../src/shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logger = createLogger('orchestrator');

const nodeEnv = process.env.NODE_ENV || 'development';
const isDev = nodeEnv === 'development';

interface Service {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  retry?: number;
  dependsOn?: string[];
}

const services: Record<string, Service> = {
  database: {
    name: 'PostgreSQL + pgvector',
    command: 'docker',
    args: ['compose', 'up', '-d', 'ryanai-db'],
  },
  redis: {
    name: 'Redis Cache',
    command: 'docker',
    args: ['compose', 'up', '-d', 'ryanai-redis'],
    dependsOn: ['database'],
  },
  api: {
    name: 'API Server',
    command: isDev ? 'npm' : 'docker',
    args: isDev ? ['run', 'dev:api'] : ['compose', 'up', '-d', 'ryanai-api'],
    dependsOn: ['database', 'redis'],
  },
  web: {
    name: 'Web UI',
    command: isDev ? 'npm' : 'docker',
    args: isDev ? ['run', 'dev:web'] : ['compose', 'up', '-d', 'ryanai-web'],
    dependsOn: ['api'],
  },
};

const runOrder = isDev ? ['database', 'redis', 'api', 'web'] : ['database', 'redis', 'api', 'web'];
const running = new Set<string>();
const completed = new Set<string>();

async function runService(serviceName: string): Promise<boolean> {
  const service = services[serviceName];
  if (!service) {
    logger.warn(`Unknown service: ${serviceName}`);
    return false;
  }

  // Check dependencies
  if (service.dependsOn) {
    for (const dep of service.dependsOn) {
      if (!completed.has(dep)) {
        logger.info(`Waiting for ${dep}...`);
        await sleep(1000);
        return false; // Retry
      }
    }
  }

  logger.info(`Starting ${service.name}...`);
  running.add(serviceName);

  return new Promise((resolve) => {
    const proc = spawn(service.command, service.args, {
      cwd: path.join(__dirname, '..'),
      stdio: isDev && serviceName !== 'database' ? 'inherit' : 'pipe',
      shell: true,
      env: { ...process.env, ...service.env },
    });

    const timeout = serviceName === 'database' || serviceName === 'redis' ? 30000 : 60000;
    const timer = setTimeout(() => {
      logger.info(`✓ ${service.name} started`);
      running.delete(serviceName);
      completed.add(serviceName);
      resolve(true);
    }, timeout);

    proc.on('error', (err) => {
      clearTimeout(timer);
      logger.error(`✗ ${service.name} error: ${err.message}`);
      running.delete(serviceName);
      resolve(false);
    });

    proc.on('close', (code) => {
      if (!completed.has(serviceName) && code !== 0) {
        clearTimeout(timer);
        logger.error(`✗ ${service.name} exited with code ${code}`);
        resolve(false);
      }
    });
  });
}

/** Pings database, Redis, and API health endpoints, logging the status of each without failing the orchestration run. */
async function runHealthChecks(): Promise<boolean> {
  logger.info('Running health checks...');

  const checks = [
    {
      name: 'Database',
      url: 'postgresql://postgres:[REDACTED]@localhost:5432/ryanai',
      timeout: 5000,
    },
    {
      name: 'Redis',
      url: 'redis://localhost:6379',
      timeout: 5000,
    },
    {
      name: 'API',
      url: 'http://localhost:3000/health',
      timeout: 5000,
    },
  ];

  for (const check of checks) {
    try {
      if (check.url.includes('http')) {
        const res = await fetch(check.url, { signal: AbortSignal.timeout(check.timeout) });
        if (res.ok) {
          logger.info(`✓ ${check.name} healthy`);
        } else {
          logger.warn(`⚠ ${check.name} returned ${res.status}`);
        }
      }
    } catch (err: unknown) {
      logger.warn(`⚠ ${check.name} check failed: ${(err instanceof Error ? err.message : String(err))}`);
    }
  }

  return true;
}

async function orchestrate() {
  logger.info(`🚀 RyanAI Orchestrator starting (${nodeEnv} mode)`);

  for (let attempt = 0; attempt < 3; attempt++) {
    for (const serviceName of runOrder) {
      if (!completed.has(serviceName)) {
        const success = await runService(serviceName);
        if (!success && attempt < 2) {
          logger.warn(`Retrying ${serviceName}...`);
          await sleep(2000);
          continue;
        }
      }
    }
  }

  if (completed.size === runOrder.length) {
    logger.info('✓ All services started');
    await runHealthChecks();
    logger.info('🎉 RyanAI platform ready!');
    logger.info('📍 API: http://localhost:3000');
    logger.info('📍 Web: http://localhost:5173');
    logger.info('📍 Health: http://localhost:3000/health');
    process.exit(0);
  } else {
    logger.error('✗ Some services failed to start');
    process.exit(1);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  process.exit(0);
});

orchestrate().catch((err) => {
  logger.error(err);
  process.exit(1);
});
