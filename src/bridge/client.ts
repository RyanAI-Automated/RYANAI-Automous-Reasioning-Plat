export type BridgeConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'degraded';
export interface BridgeEvent {
  eventId: string;
  cursor: string;
  topic: string;
  payload: unknown;
  occurredAt: number;
}
export interface BridgeClientOptions {
  url: string;
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
type Envelope = { version: number; id?: string; sentAt?: number; message?: { type: string; data?: any } };

export function reconnectDelay(attempt: number, random = Math.random, min = 500, max = 30000): number {
  const exponent = Math.min(Math.max(0, attempt), 10);
  const ceiling = Math.min(max, min * 2 ** exponent);
  return Math.floor(ceiling * (0.5 + Math.max(0, Math.min(1, random())) * 0.5));
}

/** Browser-only WebSocket client. It never stores tickets or credentials in URLs. */
export class RyanAIBridgeClient {
  private socket: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatDeadline: ReturnType<typeof setTimeout> | null = null;
  private pendingNonce: string | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private connecting = false;
  private readonly random: () => number;

  constructor(private readonly options: BridgeClientOptions) {
    if (!options.url || !options.topics.length || !options.getTicket) throw new Error('Bridge URL, topics and ticket provider are required.');
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
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.close(1000, 'Client stopped');
    }
    this.options.onState?.('offline');
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.reconnectTimer = this.heartbeatTimer = this.heartbeatDeadline = this.stableTimer = null;
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
      if (this.stopped) return;
      const socket = new WebSocket(this.options.url);
      this.socket = socket;
      socket.onopen = () => {
        this.send('hello', { ticket });
      };
      socket.onmessage = (event) => {
        let envelope: Envelope;
        try { envelope = JSON.parse(String(event.data)); } catch {
          this.options.onState?.('degraded', 'Invalid bridge frame');
          return;
        }
        if (envelope.version !== 1 || !envelope.message) return;
        const { type, data = {} } = envelope.message;
        if (type === 'ready') {
          this.attempt = 0;
          this.connecting = false;
          this.options.onState?.('connected');
          this.send('subscribe', { topics: this.options.topics });
          this.startHeartbeat();
          this.stableTimer = setTimeout(() => { this.attempt = 0; }, 30000);
        } else if (type === 'heartbeat_ack' && data.nonce === this.pendingNonce) {
          if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
          this.heartbeatDeadline = null;
          this.pendingNonce = null;
        } else if (type === 'event') {
          const delivered = data as BridgeEvent;
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
    this.attempt += 1;
    const delay = reconnectDelay(this.attempt - 1, this.random, this.options.minReconnectMs, this.options.maxReconnectMs);
    this.options.onState?.('reconnecting', 'Retrying bridge connection');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.options.heartbeatIntervalMs ?? 15000;
    const timeout = this.options.heartbeatTimeoutMs ?? 10000;
    this.heartbeatTimer = setInterval(() => {
      if (this.pendingNonce) {
        this.socket?.close(4000, 'Heartbeat timeout');
        return;
      }
      this.pendingNonce = crypto.randomUUID();
      this.send('heartbeat', { nonce: this.pendingNonce });
      this.heartbeatDeadline = setTimeout(() => {
        if (this.pendingNonce) this.socket?.close(4000, 'Heartbeat timeout');
      }, timeout);
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
    this.heartbeatTimer = this.heartbeatDeadline = null;
    this.pendingNonce = null;
  }
}
