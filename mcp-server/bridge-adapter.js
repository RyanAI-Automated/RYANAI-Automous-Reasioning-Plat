import { randomUUID } from 'node:crypto';

const bridgeUrl = process.env.BRIDGE_INTERNAL_URL?.replace(/\/+$/, '');
const bridgeToken = process.env.BRIDGE_ADAPTER_TOKEN || '';
let heartbeatTimer;

export async function heartbeatMcpAdapter() {
  if (!bridgeUrl || bridgeToken.length < 32) return false;
  try {
    const response = await fetch(`${bridgeUrl}/internal/adapters/mcp/heartbeat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bridgeToken}` },
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function publishMcpBridgeEvent({ topic, idempotencyKey = randomUUID(), payload }) {
  if (!bridgeUrl || bridgeToken.length < 32) return false;
  try {
    const response = await fetch(`${bridgeUrl}/internal/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bridgeToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ topic, idempotencyKey, payload }),
      signal: AbortSignal.timeout(4000),
    });
    return response.ok;
  } catch {
    // MCP execution is not coupled to the optional realtime adapter.
    return false;
  }
}

export function startMcpBridgeHeartbeat() {
  if (heartbeatTimer) return () => stopMcpBridgeHeartbeat();
  void heartbeatMcpAdapter();
  heartbeatTimer = setInterval(() => void heartbeatMcpAdapter(), 15000);
  return () => stopMcpBridgeHeartbeat();
}

export function stopMcpBridgeHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
}
