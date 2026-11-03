export interface BridgePublishInput {
  topic: string;
  idempotencyKey: string;
  payload: unknown;
}
export class RyanAIBridgeAdapter {
  private readonly baseUrl: string;
  private readonly token: string;
  constructor(baseUrl = process.env.BRIDGE_INTERNAL_URL || '', token = process.env.BRIDGE_ADAPTER_TOKEN || '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }
  get configured(): boolean { return Boolean(this.baseUrl && this.token); }
  async heartbeat(name: 'api' | 'mcp', signal?: AbortSignal): Promise<boolean> {
    if (!this.configured) return false;
    try {
      const response = await fetch(this.baseUrl + '/internal/adapters/' + name + '/heartbeat', {
        method: 'POST', headers: { authorization: 'Bearer ' + this.token },
        signal: signal || AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch { return false; }
  }
  async publish(input: BridgePublishInput, signal?: AbortSignal): Promise<{ accepted: true; eventId: string; cursor: string }> {
    if (!this.configured) throw new Error('RyanAI bridge adapter is not configured');
    const response = await fetch(this.baseUrl + '/internal/events', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + this.token, 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: signal || AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('RyanAI bridge did not durably accept the event');
    return await response.json() as { accepted: true; eventId: string; cursor: string };
  }
}
