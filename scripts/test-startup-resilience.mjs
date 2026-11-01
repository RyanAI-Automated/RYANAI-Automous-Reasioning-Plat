#!/usr/bin/env node
/**
 * Exercise production startup against disposable CI PostgreSQL/Redis services.
 * Each failure case runs in a child process and must exit before opening its
 * HTTP listener. Checkpointer setup failure is injected through disposable
 * PostgreSQL DDL; a final clean restart proves recovery after transient faults.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import pg from 'pg';

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const timeoutMs = Number(process.env.STARTUP_RESILIENCE_TIMEOUT_MS || 20_000);
const launcher = new URL('../dist/server/server/launcher.js', import.meta.url);

if (!databaseUrl || !redisUrl) {
  throw new Error('DATABASE_URL and REDIS_URL must target disposable CI services.');
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve an ephemeral test port.'));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function runChild(label, env) {
  const child = spawn(process.execPath, [launcher.pathname], {
    env: {
      ...process.env,
      ...env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      JWT_SECRET: 'isolated-ci-startup-secret-at-least-32-characters',
      SCHEDULER_ENABLED: 'false',
      ALERTS_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output = (output + chunk).slice(-12000); });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output = (output + chunk).slice(-12000); });
  return {
    child,
    get output() { return output; },
    async exited() {
      let timer;
      try {
        return await Promise.race([
          new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', (code, signal) => resolve({ code, signal }));
          }),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              child.kill('SIGKILL');
              reject(new Error(label + ' did not exit within ' + timeoutMs + 'ms'));
            }, timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function expectStartupFailure(label, env, expectedText) {
  const port = await reservePort();
  const process = runChild(label, { ...env, PORT: String(port) });
  const exit = await process.exited();
  if (exit.code === 0) throw new Error(label + ' unexpectedly exited successfully.');
  if (!process.output.includes(expectedText)) {
    throw new Error(label + ' failed for an unexpected reason. Expected diagnostic: ' + expectedText + '. Output: ' + process.output);
  }
  let listening = false;
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(1000) });
    listening = response.ok || response.status === 503;
  } catch {
    // Connection refusal is the expected fail-closed result.
  }
  if (listening) throw new Error(label + ' opened an HTTP listener despite failed dependencies.');
  console.log('PASS ' + label + ': process exited before opening the API listener');
}

async function withInjectedCheckpointerFailure(run) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.ryanai_test_reject_checkpoint_ddl()
      RETURNS event_trigger
      LANGUAGE plpgsql
      AS $body$
      DECLARE command record;
      BEGIN
        FOR command IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
          IF command.command_tag = 'CREATE TABLE'
            AND command.object_identity ~* '(checkpoint_migrations|checkpoints|checkpoint_blobs|checkpoint_writes)' THEN
            RAISE EXCEPTION 'injected LangGraph checkpointer setup failure';
          END IF;
        END LOOP;
      END;
      $body$;
    `);
    try {
      await pool.query(`
        CREATE EVENT TRIGGER ryanai_test_reject_checkpoint_ddl
        ON ddl_command_end
        EXECUTE FUNCTION public.ryanai_test_reject_checkpoint_ddl();
      `);
      await run();
    } finally {
      await pool.query('DROP EVENT TRIGGER IF EXISTS ryanai_test_reject_checkpoint_ddl');
      await pool.query('DROP FUNCTION IF EXISTS public.ryanai_test_reject_checkpoint_ddl()');
    }
  } finally {
    await pool.end();
  }
}

async function expectCheckpointerSetupFailure() {
  await withInjectedCheckpointerFailure(() => expectStartupFailure(
    'Agent checkpointer setup failure',
    { DATABASE_URL: databaseUrl, REDIS_URL: redisUrl },
    'Production startup blocked: required dependency checks failed for agent checkpointer',
  ));
}

async function expectHealthyRecovery() {
  const port = await reservePort();
  const process = runChild('healthy recovery', {
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    PORT: String(port),
  });
  const deadline = Date.now() + timeoutMs;
  let health;
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) {
      throw new Error('Healthy recovery process exited early. Output: ' + process.output);
    }
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/health', {
        signal: AbortSignal.timeout(1000),
      });
      const body = await response.json();
      if (response.ok && body.status === 'online') {
        health = body;
        break;
      }
    } catch {
      // Continue waiting for startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!health) {
    process.child.kill('SIGKILL');
    throw new Error('Healthy recovery did not become ready. Output: ' + process.output);
  }
  for (const dependency of ['database', 'redis', 'agentCheckpointer', 'api']) {
    if (health.services?.[dependency] !== true) {
      process.child.kill('SIGKILL');
      throw new Error('Healthy recovery reported ' + dependency + ' as unavailable.');
    }
  }
  console.log('PASS healthy restart: PostgreSQL, Redis, checkpointer and API report ready');
  process.child.kill('SIGTERM');
  await new Promise((resolve) => process.child.once('exit', resolve));
}

try {
  const unreachableDatabase = new URL(databaseUrl);
  unreachableDatabase.port = '1';
  await expectStartupFailure(
    'PostgreSQL unavailable',
    { DATABASE_URL: unreachableDatabase.toString(), REDIS_URL: redisUrl },
    'Production startup blocked',
  );

  // Inject a real PostgreSQL DDL failure into LangGraph PostgresSaver setup.
  // This runs before any successful checkpointer setup creates its tables.
  await expectCheckpointerSetupFailure();

  const unreachableRedis = new URL(redisUrl);
  unreachableRedis.port = '1';
  await expectStartupFailure(
    'Redis unavailable',
    { DATABASE_URL: databaseUrl, REDIS_URL: unreachableRedis.toString() },
    'Redis is unavailable',
  );

  await expectHealthyRecovery();
  console.log('Startup resilience checks passed.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
