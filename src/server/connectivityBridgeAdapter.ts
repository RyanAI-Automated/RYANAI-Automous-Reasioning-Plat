export class ConnectivityBridgeAdapter {
  private readonly baseUrl = (process.env.BRIDGE_INTERNAL_URL || '').replace(/\/+$/, '');
  private readonly token = process.env.BRIDGE_ADAPTER_TOKEN || '';
  get configured(): boolean { return this.baseUrl.length > 0 && this.token.length >= 32; }

  async heartbeat(signal?: AbortSignal): Promise<boolean> {
    if (!this.configured) return false;
    try {
      const response = await fetch(this.baseUrl + '/internal/adapters/api/heartbeat', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + this.token },
        signal: signal || AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch { return false; }
  }

  async publish(userId: string, idempotencyKey: string, payload: unknown): Promise<boolean> {
    if (!this.configured) return false;
    try {
      const response = await fetch(this.baseUrl + '/internal/events', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + this.token, 'content-type': 'application/json' },
        body: JSON.stringify({ userId, idempotencyKey, payload }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch { return false; }
  }
}
