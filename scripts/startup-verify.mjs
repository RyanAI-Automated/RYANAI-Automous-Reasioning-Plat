#!/usr/bin/env node

import { apiHealthUrl, webUrl, mcpHealthUrl } from './health-config.mjs';
const timeoutMs = Number(process.env.STARTUP_TIMEOUT_MS || 60_000);
const retryDelayMs = Number(process.env.STARTUP_RETRY_DELAY_MS || 2_000);

async function checkEndpoint(label, url, validate = () => {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await validate(response);
      console.log(`PASS ${label}`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(`${label} did not become healthy: ${lastError?.message ?? 'timeout'}`);
}

try {
  await checkEndpoint('API', apiHealthUrl, async (response) => {
    const health = await response.json();
    if (health.status !== 'online') throw new Error('API status is not online');
    if (health.services?.database !== true) throw new Error('PostgreSQL is unhealthy');
    if (health.services?.redis !== true) throw new Error('Redis is unhealthy');
  });
  await checkEndpoint('Web frontend', `${webUrl}/health`);
  if (mcpHealthUrl) await checkEndpoint('MCP service', mcpHealthUrl);
  console.log('All critical RyanAI services are healthy.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
