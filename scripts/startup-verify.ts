#!/usr/bin/env node
/**
 * System Health Check & Startup Verification
 * Ensures all services are operational before returning control
 */
import { createLogger } from '../src/shared/logger.js';
import { spawn } from 'node:child_process';

const logger = createLogger('startup-verify');

interface HealthCheck {
  name: string;
  endpoint: string;
  timeout: number;
  critical: boolean;
}

const healthChecks: HealthCheck[] = [
  {
    name: 'API Server',
    endpoint: 'http://localhost:3000/health',
    timeout: 5000,
    critical: true,
  },
  {
    name: 'Redis Cache',
    endpoint: 'redis://localhost:6379',
    timeout: 3000,
    critical: true,
  },
  {
    name: 'PostgreSQL Database',
    endpoint: 'postgresql://postgres:[REDACTED]@localhost:5432/ryanai',
    timeout: 5000,
    critical: true,
  },
  {
    name: 'Web Frontend',
    endpoint: 'http://localhost:9090',
    timeout: 3000,
    critical: false,
  },
];

/** Runs a single startup health check (HTTP, Redis, or PostgreSQL) and reports success as a boolean. */
async function checkHealth(check: HealthCheck): Promise<boolean> {
  try {
    if (check.endpoint.startsWith('http')) {
      const signal = AbortSignal.timeout(check.timeout);
      const res = await fetch(check.endpoint, { signal });
      return res.ok;
    } else if (check.endpoint.startsWith('redis')) {
      // Redis check via redis-cli
      return await checkRedis(check.timeout);
    } else if (check.endpoint.startsWith('postgresql')) {
      // PostgreSQL check via psql
      return await checkPostgres(check.timeout);
    }
    return false;
  } catch (err: unknown) {
    logger.debug(`${check.name} check failed: ${(err instanceof Error ? err.message : String(err))}`);
    return false;
  }
}

async function checkRedis(timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('redis-cli', ['ping'], { timeout });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function checkPostgres(timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('psql', [
      '-U', 'postgres',
      '-h', 'localhost',
      '-d', 'ryanai',
      '-c', 'SELECT 1',
    ], { timeout });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function runStartupVerification() {
  logger.info('🔍 Starting system health verification...\n');

  let passed = 0;
  let failed = 0;
  const failedCritical: string[] = [];

  for (const check of healthChecks) {
    process.stdout.write(`  Checking ${check.name}... `);
    
    let attempts = 0;
    const maxAttempts = 3;
    let healthy = false;

    while (attempts < maxAttempts && !healthy) {
      healthy = await checkHealth(check);
      if (!healthy && attempts < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
      attempts++;
    }

    if (healthy) {
      logger.info(`✅ OK\n`);
      passed++;
    } else {
      const status = check.critical ? '❌ CRITICAL' : '⚠️  WARNING';
      logger.warn(`${status}\n`);
      failed++;
      if (check.critical) {
        failedCritical.push(check.name);
      }
    }
  }

  logger.info('\n📊 Verification Summary');
  logger.info(`─`.repeat(40));
  logger.info(`✅ Passed: ${passed}/${healthChecks.length}`);
  logger.info(`❌ Failed: ${failed}/${healthChecks.length}`);

  if (failedCritical.length > 0) {
    logger.error(`\n🚨 Critical Services Down:`);
    failedCritical.forEach(name => logger.error(`   • ${name}`));
    logger.error('\nTroubleshooting:');
    logger.error('  1. Check Docker containers: docker compose ps');
    logger.error('  2. View logs: docker compose logs -f');
    logger.error('  3. Rebuild: docker compose down -v && docker compose up -d');
    return 1;
  }

  logger.info('\n🎉 All critical services healthy!');
  logger.info('\n📍 Access Points:');
  logger.info('   API:      http://localhost:3000');
  logger.info('   Frontend: http://localhost:9090');
  logger.info('   Health:   http://localhost:3000/health');
  logger.info('   WebSocket: ws://localhost:3000/ws');
  logger.info('\n✨ System ready for operation\n');
  
  return 0;
}

runStartupVerification()
  .then(code => process.exit(code))
  .catch((err) => {
    logger.error('Verification failed:', err);
    process.exit(1);
  });
