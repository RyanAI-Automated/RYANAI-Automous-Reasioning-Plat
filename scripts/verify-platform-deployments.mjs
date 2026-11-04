#!/usr/bin/env node
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Read-only health verification for RyanAI's three-platform deployment.
 * It never triggers deployments or prints full URLs/query strings.
 */
export const deploymentTargets = [
  { platform: 'Render', service: 'frontend', variable: 'RENDER_FRONTEND_HEALTH_URL' },
  { platform: 'Vercel', service: 'backend', variable: 'VERCEL_BACKEND_HEALTH_URL' },
  { platform: 'Railway', service: 'API', variable: 'RAILWAY_API_HEALTH_URL' },
  { platform: 'Railway', service: 'MCP', variable: 'RAILWAY_MCP_HEALTH_URL' },
];

function safeHost(value) {
  try { return new URL(value).host; } catch { return 'invalid-url'; }
}

function validateTargetUrl(value) {
  let url;
  try { url = new URL(value); } catch { return { valid: false, reason: 'URL is malformed' }; }
  if (url.protocol !== 'https:') return { valid: false, reason: 'HTTPS is required' };
  if (url.username || url.password) return { valid: false, reason: 'URL must not contain credentials' };
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    return { valid: false, reason: 'Localhost is not a production deployment target' };
  }
  return { valid: true, url };
}

export async function verifyPlatformDeployments(env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 10000) {
  const results = [];
  for (const target of deploymentTargets) {
    const configured = typeof env[target.variable] === 'string' ? env[target.variable].trim() : '';
    if (!configured) {
      results.push({ ...target, status: 'MISSING', host: null, detail: 'Health URL is not configured' });
      continue;
    }

    const checked = validateTargetUrl(configured);
    if (!checked.valid) {
      results.push({ ...target, status: 'INVALID', host: safeHost(configured), detail: checked.reason });
      continue;
    }

    try {
      const response = await fetchImpl(checked.url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.1' },
      });
      const healthy = response.status >= 200 && response.status < 300;
      results.push({
        ...target,
        status: healthy ? 'HEALTHY' : 'UNHEALTHY',
        host: checked.url.host,
        httpStatus: response.status,
        detail: healthy ? 'Endpoint returned a successful HTTP status' : 'Endpoint did not return a successful HTTP status',
      });
    } catch (error) {
      const timedOut = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      results.push({
        ...target,
        status: 'UNHEALTHY',
        host: checked.url.host,
        detail: timedOut ? 'Health request timed out' : 'Health request failed',
      });
    }
  }
  return results;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try { return new URL(import.meta.url).href === pathToFileURL(process.argv[1]).href; }
  catch { return false; }
}

if (isDirectExecution()) {
  const strict = process.argv.includes('--strict');
  const timeoutArg = process.argv.find((arg) => arg.startsWith('--timeout-ms='));
  const timeoutMs = timeoutArg ? Number(timeoutArg.slice('--timeout-ms='.length)) : 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
    console.error('Invalid --timeout-ms value; use an integer from 100 to 60000.');
    process.exit(2);
  }

  const results = await verifyPlatformDeployments(process.env, globalThis.fetch, timeoutMs);
  for (const result of results) {
    const host = result.host ? ' | ' + result.host : '';
    const http = result.httpStatus ? ' | HTTP ' + result.httpStatus : '';
    console.log(result.status + ' | ' + result.platform + ' ' + result.service + host + http + ' | ' + result.detail);
  }
  const healthy = results.filter((result) => result.status === 'HEALTHY').length;
  const blocked = results.length - healthy;
  console.log('\nRyanAI platform verification: ' + healthy + '/' + results.length +
    ' endpoints healthy; ' + blocked + ' missing, invalid, or unhealthy.');
  if (strict && blocked > 0) process.exitCode = 1;
}
