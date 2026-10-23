const url = new URL(process.env.MCP_HEALTH_URL || 'http://127.0.0.1:8765/health');
if (!['http:', 'https:'].includes(url.protocol)) {
  throw new Error('MCP_HEALTH_URL must use HTTP or HTTPS.');
}

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  if (!response.ok || body.status !== 'ok' || body.service !== 'ryanai-mcp-manager') {
    throw new Error(`Unexpected health response (HTTP ${response.status}): ${JSON.stringify(body)}`);
  }
  console.log(`RyanAI MCP HTTP service is healthy at ${url.origin}.`);
} catch (error) {
  console.error(`RyanAI MCP HTTP service is unavailable at ${url.origin}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
