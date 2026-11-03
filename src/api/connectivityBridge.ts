export interface BridgeEvent { id: string; data: unknown; }
export interface BridgeCapabilities {
  bridge?: 'ready' | 'degraded' | 'unavailable';
  redis?: 'ready' | 'degraded' | 'unavailable';
  api?: 'ready' | 'degraded' | 'unavailable';
  mcp?: 'ready' | 'degraded' | 'unavailable';
}
export interface ConnectivityBridgeOptions {
  getAccessToken: () => Promise<string | null>;
  onEvent: (event: BridgeEvent) => void | Promise<void>;
  onState?: (state: 'connecting' | 'connected' | 'degraded' | 'closed') => void;
  onCapabilities?: (capabilities: BridgeCapabilities) => void;
  onReplayGap?: (details: { requestedCursor: string; oldestAvailable: string }) => void;
  basePath?: string;
  maxReconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}
type BridgeMessage =
  | { type: 'event'; id: string; data: unknown }
  | { type: 'degraded'; retryable?: boolean; dependency?: string }
  | { type: 'resumed'; cursor?: string; capabilities?: BridgeCapabilities }
  | { type: 'replay_gap'; requestedCursor: string; oldestAvailable: string; reconcileRequired: boolean }
  | { type: 'heartbeat_ack'; nonce: string; at: number }
  | { type: 'acknowledged'; id: string }
  | { type: 'error'; error?: string };

export function reconnectDelay(attempt: number, maxDelayMs = 30000, random = Math.random): number {
  const exponent = Math.min(Math.max(0, attempt), 10);
  const ceiling = Math.min(maxDelayMs, 500 * 2 ** exponent);
  const jitter = Math.max(0, Math.min(1, random()));
  return Math.floor(ceiling * (0.5 + jitter * 0.5));
}

/** Browser transport; obtains a fresh single-use ticket for every connection attempt. */
export class ConnectivityBridgeClient {
  private socket: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatDeadline: ReturnType<typeof setTimeout> | undefined;
  private pendingNonce: string | null = null;
  private readonly bridgeBaseUrl: URL;

  constructor(private readonly options: ConnectivityBridgeOptions) {
    const configuredBase = options.basePath || import.meta.env.VITE_BRIDGE_BASE_URL?.trim() || '/bridge';
    this.bridgeBaseUrl = new URL(configuredBase.endsWith('/') ? configuredBase : configuredBase + '/', window.location.origin);
  }

  connect(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.open();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'Client disconnected');
    this.options.onState?.('closed');
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
    this.heartbeatTimer = undefined;
    this.heartbeatDeadline = undefined;
    this.pendingNonce = null;
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    this.options.onState?.(this.attempt ? 'degraded' : 'connecting');
    try {
      const token = await this.options.getAccessToken();
      if (!token) throw new Error('A current signed-in session is required');
      const ticketUrl = new URL('v1/ticket', this.bridgeBaseUrl);
      const ticketResponse = await fetch(ticketUrl.toString(), {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        cache: 'no-store',
        credentials: ticketUrl.origin === window.location.origin ? 'same-origin' : 'omit',
        signal: AbortSignal.timeout(5000),
      });
      if (!ticketResponse.ok) throw new Error('Bridge ticket request failed: ' + ticketResponse.status);
      const ticket = await ticketResponse.json() as { ticket?: string };
      if (!ticket.ticket || this.stopped) throw new Error('Bridge did not issue a valid connection ticket');

      const socketUrl = new URL('v1/socket', this.bridgeBaseUrl);
      socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      socketUrl.searchParams.set('ticket', ticket.ticket);
      const socket = new WebSocket(socketUrl.toString());
      this.socket = socket;
      let eventQueue = Promise.resolve();
      const ackWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
      socket.onopen = () => {
        if (this.stopped || this.socket !== socket) return socket.close();
        socket.send(JSON.stringify({ type: 'resume' }));
      };
      socket.onmessage = (message) => {
        let payload: BridgeMessage;
        try { payload = JSON.parse(String(message.data)) as BridgeMessage; } catch { return; }
        if (payload.type === 'resumed') {
          this.attempt = 0;
          this.options.onState?.('connected');
          if (payload.capabilities) this.options.onCapabilities?.(payload.capabilities);
          this.startHeartbeat(socket);
        } else if (payload.type === 'replay_gap') {
          this.options.onReplayGap?.({ requestedCursor: payload.requestedCursor, oldestAvailable: payload.oldestAvailable });
          this.options.onState?.('degraded');
        } else if (payload.type === 'heartbeat_ack' && payload.nonce === this.pendingNonce) {
          if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
          this.heartbeatDeadline = undefined;
          this.pendingNonce = null;
        } else if (payload.type === 'acknowledged' && typeof payload.id === 'string') {
          const waiter = ackWaiters.get(payload.id);
          if (waiter) {
            clearTimeout(waiter.timer);
            ackWaiters.delete(payload.id);
            waiter.resolve();
          }
        } else if (payload.type === 'event' && typeof payload.id === 'string') {
          eventQueue = eventQueue.then(async () => {
            await this.options.onEvent({ id: payload.id, data: payload.data });
            if (socket.readyState !== WebSocket.OPEN) throw new Error('Bridge socket closed before acknowledgement');
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => {
                ackWaiters.delete(payload.id);
                reject(new Error('Bridge acknowledgement timed out'));
              }, 10000);
              ackWaiters.set(payload.id, { resolve, reject, timer });
              socket.send(JSON.stringify({ type: 'ack', id: payload.id }));
            });
          }).catch(() => {
            this.options.onState?.('degraded');
            if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'Event handler failed; replay required');
          });
        } else if (payload.type === 'degraded' || payload.type === 'error') {
          this.options.onState?.('degraded');
        }
      };
      socket.onerror = () => this.options.onState?.('degraded');
      socket.onclose = () => {
        for (const waiter of ackWaiters.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error('Bridge connection closed before acknowledgement'));
        }
        ackWaiters.clear();
        if (this.socket === socket) this.socket = null;
        this.stopHeartbeat();
        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    const interval = this.options.heartbeatIntervalMs ?? 15000;
    const timeout = this.options.heartbeatTimeoutMs ?? 10000;
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (this.pendingNonce) {
        socket.close(4000, 'Heartbeat acknowledgement timed out');
        return;
      }
      this.pendingNonce = crypto.randomUUID();
      socket.send(JSON.stringify({ type: 'heartbeat', nonce: this.pendingNonce }));
      this.heartbeatDeadline = setTimeout(() => {
        if (this.pendingNonce) socket.close(4000, 'Heartbeat acknowledgement timed out');
      }, timeout);
    }, interval);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.options.onState?.('degraded');
    const delay = reconnectDelay(this.attempt++, this.options.maxReconnectDelayMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.open();
    }, delay);
  }
}
