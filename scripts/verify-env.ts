// File path: ./scripts/verify-env.ts

import { Pool } from 'pg';
import { createClient } from 'redis';

export interface EnvConfig {
  [key: string]: unknown;
}

export function verifyEnv(env: EnvConfig): boolean {
  let isValid = true;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === null || value === '') {
      console.warn(`[Env Warning] Missing or empty required environment variable: ${key}`);
      isValid = false;
    }
  }
  return isValid;
}

/**
 * Probe PostgreSQL and Redis, returning false when a connection check fails.
 * Close the database pool after its probe; pool cleanup and client construction
 * errors propagate rather than becoming a false result.
 */
export async function verifyEnvironment(): Promise<boolean> {
  console.log('Verifying RyanAI infrastructure connections...');
  let allPassed = true;

  const dbPool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ryanai',
  });

  try {
    const dbRes = await dbPool.query('SELECT NOW()');
    console.log(' PostgreSQL connection verified:', dbRes.rows[0].now);
  } catch (err: unknown) {
    console.error(' PostgreSQL connection failed:', (err instanceof Error ? err.message : String(err)));
    allPassed = false;
  } finally {
    await dbPool.end();
  }

  const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });

  try {
    await redisClient.connect();
    await redisClient.ping();
    console.log(' Redis cache connection verified.');
    await redisClient.disconnect();
  } catch (err: unknown) {
    console.error(' Redis connection failed:', (err instanceof Error ? err.message : String(err)));
    allPassed = false;
  }

  return allPassed;
}

// Auto-execute when run as a standalone script
verifyEnvironment().then((success) => {
  if (!success) {
    process.exitCode = 1;
  }
});