#!/usr/bin/env node
import { execFile, promisify } from 'node:child_process';

const execFileAsync = promisify(execFile);
const timeoutMs = Number(process.env.API_TIMEOUT || 5000);
const apiBase = process.env.API_BASE_URL || 'http://127.0.0.1:3000';
const webBase = process.env.WEB_URL || 'http://127.0.0.1:9090';
const mcpBase = process.env.MCP_URL || 'http://127.0.0.1:8765';
const results = [];

async function check(name, operation) {
  try { await operation(); results.push(true); console.log(`PASS ${name}`); }
  catch (error) { results.push(false); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
async function json(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json().catch(() => null);
}
async function compose(service, args) {
  await execFileAsync(process.platform === 'win32' ? 'docker.exe' : 'docker', ['compose', 'exec', '-T', service, ...args], { timeout: timeoutMs });
}

await check('PostgreSQL connection', () => compose('postgres', ['pg_isready', '-U', 'ryanai', '-d', 'ryanai_db']));
await check('Redis connection', () => compose('redis', ['redis-cli', '--no-auth-warning', 'ping']));
await check('API health endpoint', async () => { const body = await json(`${apiBase}/health`); if (body?.status !== 'online') throw new Error('API is not online'); });
await check('API database and Redis health', async () => { const body = await json(`${apiBase}/health`); if (!body?.services?.database || !body?.services?.redis) throw new Error('API dependencies are unhealthy'); });
await check('Web health endpoint', () => json(`${webBase}/health`));
await check('Web document', async () => { const response = await fetch(`${webBase}/`, { signal: AbortSignal.timeout(timeoutMs) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); });
await check('MCP health endpoint', async () => { const body = await json(`${mcpBase}/health`); if (body?.status !== 'ok') throw new Error('MCP is unhealthy'); });

const passed = results.filter(Boolean).length;
console.log(`\nIntegration checks: ${passed}/${results.length} passed`);
if (passed !== results.length) process.exitCode = 1;
