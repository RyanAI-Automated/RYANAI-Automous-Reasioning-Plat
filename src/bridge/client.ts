export type BridgeConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'degraded';
export interface BridgeEvent {
  eventId: string;
  cursor: string;
  topic: string;
  payload: unknown;
  occurredAt: number;
}
export interface BridgeClientOptions {
  url?: string;
  topics: string[];
  getTicket: () => Promise<string>;
  onEvent: (event: BridgeEvent) => void | Promise<void>;
  onState?: (state: BridgeConnectionState, detail?: string) => void;
  minReconnectMs?: number;
  maxReconnectMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  random?: () => number;
}
type Envelope = { version: number; id?: string; sentAt?: number; message?: { type: string; data?: Record<string, unknown> } };

export function reconnectDelay(attempt: number, random = Math.random, min = 500, max = 30000): number {
  const exponent = Math.min(Math.max(0, attempt), 10);
  const ceiling = Math.min(max, min * 2 ** exponent);
  return Math.floor(ceiling * (0.5 + Math.max(0, Math.min(1, random())) * 0.5));
}

export async function requestBridgeTicket(getAccessToken: () => Promise<string | null>): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error('A current signed-in session is required.');
  const response = await fetch('/api/bridge/ticket', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(`Bridge ticket request failed: HTTP ${response.status}`);
  const body = await response.json() as { ticket?: string };
  if (!body.ticket) throw new Error('Bridge did not issue a connection ticket.');
  return body.ticket;
}

/** Browser transport. Tickets are sent in the first authenticated frame, never in the URL. */
export class RyanAIBridgeClient {
  private socket: WebSocket | null = null;
  private stopped = true;
  private connecting = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatDeadline: ReturnType<typeof setTimeout> | null = null;
  private pendingNonce: string | null = null;
  private readonly random: () => number;

  constructor(private readonly options: BridgeClientOptions) {
    if (!options.topics.length || !options.getTicket) throw new Error('Bridge topics and ticket provider are required.');
    this.random = options.random || Math.random;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'Client stopped');
    this.options.onState?.('offline');
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.heartbeatDeadline = null;
    this.pendingNonce = null;
  }

  private send(type: string, data: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ version: 1, id: crypto.randomUUID(), sentAt: Date.now(), message: { type, data } }));
  }

  private async open(): Promise<void> {
    if (this.stopped || this.connecting) return;
    this.connecting = true;
    this.options.onState?.(this.attempt ? 'reconnecting' : 'connecting');
    try {
      const ticket = await this.options.getTicket();
      if (this.stopped) { this.connecting = false; return; }
      const url = new URL(this.options.url || '/bridge/ws', window.location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url.toString());
      this.socket = socket;
      socket.onopen = () => this.send('hello', { ticket });
      socket.onmessage = (event) => {
        let frame: Envelope;
        try { frame = JSON.parse(String(event.data)) as Envelope; } catch {
          this.options.onState?.('degraded', 'Invalid bridge frame');
          return;
        }
        if (frame.version !== 1 || !frame.message) return;
        const { type, data = {} } = frame.message;
        if (type === 'ready') {
          this.connecting = false;
          this.attempt = 0;
          this.options.onState?.('connected', JSON.stringify(data.capabilities || {}));
          this.send('subscribe', { topics: this.options.topics });
          this.startHeartbeat();
        } else if (type === 'heartbeat_ack' && data.nonce === this.pendingNonce) {
          if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
          this.heartbeatDeadline = null;
          this.pendingNonce = null;
        } else if (type === 'event') {
          const delivered = data as unknown as BridgeEvent;
          Promise.resolve(this.options.onEvent(delivered)).then(() => {
            this.send('ack', { eventId: delivered.eventId, cursor: delivered.cursor });
          }).catch(() => {
            this.options.onState?.('degraded', 'Event handler failed; event will be replayed');
            this.socket?.close(1011, 'Event handler failed');
          });
        } else if (type === 'degraded') {
          this.options.onState?.('degraded', String(data.dependency || 'dependency unavailable'));
        } else if (type === 'error') {
          this.options.onState?.('degraded', String(data.code || 'bridge error'));
        }
      };
      socket.onerror = () => this.options.onState?.('degraded', 'WebSocket transport error');
      socket.onclose = () => {
        this.connecting = false;
        this.stopHeartbeat();
        if (this.socket === socket) this.socket = null;
        this.scheduleReconnect();
      };
    } catch (error) {
      this.connecting = false;
      this.options.onState?.('degraded', error instanceof Error ? error.message : 'Ticket request failed');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.stopHeartbeat();
    const delay = reconnectDelay(this.attempt++, this.random, this.options.minReconnectMs, this.options.maxReconnectMs);
    this.options.onState?.('reconnecting', 'Retrying bridge connection');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.pendingNonce) { this.socket?.close(4000, 'Heartbeat timeout'); return; }
      this.pendingNonce = crypto.randomUUID();
      this.send('heartbeat', { nonce: this.pendingNonce });
      this.heartbeatDeadline = setTimeout(() => {
        if (this.pendingNonce) this.socket?.close(4000, 'Heartbeat timeout');
      }, this.options.heartbeatTimeoutMs ?? 10000);
    }, this.options.heartbeatIntervalMs ?? 15000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
    this.heartbeatTimer = this.heartbeatDeadline = null;
    this.pendingNonce = null;
  }
}
