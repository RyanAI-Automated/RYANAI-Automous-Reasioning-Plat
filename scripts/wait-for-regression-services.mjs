#!/usr/bin/env node

const apiBase = new URL(process.env.API_BASE_URL || 'http://127.0.0.1:3000');
const webBase = new URL(process.env.WEB_BASE_URL || 'http://127.0.0.1:9090');
const mcpBase = new URL(process.env.MCP_URL || 'http://127.0.0.1:8765');
const timeoutMs = Number(process.env.SERVICE_READY_TIMEOUT_MS || 45_000);
const retryMs = Number(process.env.SERVICE_READY_RETRY_MS || 1_000);
const requestTimeoutMs = Number(process.env.SERVICE_REQUEST_TIMEOUT_MS || 4_000);

if (![apiBase, webBase, mcpBase].every((url) => ['http:', 'https:'].includes(url.protocol))) {
  throw new Error('API_BASE_URL, WEB_BASE_URL and MCP_URL must use HTTP or HTTPS.');
}
if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 180_000) {
  throw new Error('SERVICE_READY_TIMEOUT_MS must be between 1000 and 180000.');
}
if (!Number.isFinite(retryMs) || retryMs < 100 || retryMs > 10_000) {
  throw new Error('SERVICE_READY_RETRY_MS must be between 100 and 10000.');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url) {
  return fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
}

async function waitFor(name, check) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';

  while (Date.now() < deadline) {
    try {
      await check();
      console.log(`READY ${name}`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(retryMs);
    }
  }

  throw new Error(`${name} did not become ready within ${timeoutMs}ms: ${lastError}`);
}

async function readHealth(url, expectedStatus, expectedService) {
  const response = await request(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body?.status !== expectedStatus) {
    throw new Error(`expected status "${expectedStatus}", received "${String(body?.status)}"`);
  }
  if (expectedService && body?.service !== expectedService) {
    throw new Error(`expected service "${expectedService}", received "${String(body?.service)}"`);
  }
  return body;
}

await waitFor('API health', async () => {
  await readHealth(new URL('/health', apiBase), 'online');
});

await waitFor('MCP HTTP health', async () => {
  await readHealth(new URL('/health', mcpBase), 'ok', 'ryanai-mcp-manager');
});

await waitFor('Web preview document', async () => {
  const response = await request(webBase);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('response content-type is not text/html');
  }
  const html = await response.text();
  if (!/<div[^>]+id=["']root["']/.test(html)) {
    throw new Error('HTML document does not contain the application root');
  }
});

// The preview must proxy /health to the separately started API. Checking the
// direct API alone would miss a Vite preview configured for the wrong target.
await waitFor('Vite preview API proxy', async () => {
  await readHealth(new URL('/health', webBase), 'online');
});

console.log('PASS all regression services are ready and the web API proxy is live');
