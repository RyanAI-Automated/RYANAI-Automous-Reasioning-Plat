const bridgeUrl = process.env.BRIDGE_INTERNAL_URL?.replace(/\/+$/, '');
const bridgeToken = process.env.BRIDGE_ADAPTER_TOKEN || '';
let heartbeatTimer;

export async function heartbeatMcpAdapter() {
  if (!bridgeUrl || bridgeToken.length < 32) return false;
  try {
    const response = await fetch(bridgeUrl + '/internal/adapters/mcp/heartbeat', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + bridgeToken },
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
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
