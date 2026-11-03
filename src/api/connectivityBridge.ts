export interface ConnectivityBridgeOptions {
  getAccessToken: () => Promise<string | null>;
  onEvent: (event: { id: string; data: unknown }) => void | Promise<void>;
  onState?: (state: 'connecting' | 'connected' | 'degraded' | 'closed') => void;
  basePath?: string;
  maxReconnectDelayMs?: number;
}

type BridgeMessage =
  | { type: 'event'; id: string; data: unknown }
  | { type: 'degraded'; retryable?: boolean }
  | { type: 'resumed'; cursor?: string }
  | { type: 'error'; error?: string };

export function reconnectDelay(attempt: number, maxDelayMs = 30_000, random = Math.random): number {
  const ceiling = Math.min(maxDelayMs, 500 * 2 ** Math.min(attempt, 10));
  return Math.floor(ceiling * (0.5 + random() * 0.5));
}

/**
 * Browser transport for the independent RyanAI bridge.
 * A fresh, single-use ticket is obtained for every socket attempt; access tokens
 * are sent only in the HTTPS Authorization header, never in a WebSocket URL.
 */
export class ConnectivityBridgeClient {
  private socket: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly basePath: string;
  private readonly cursorKey = 'ryanai.connectivity.cursor.v1';

  constructor(private readonly options: ConnectivityBridgeOptions) {
    this.basePath = (options.basePath || '/bridge').replace(/\/$/, '');
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
    this.socket?.close(1000, 'Client disconnected');
    this.socket = null;
    this.options.onState?.('closed');
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    this.options.onState?.(this.attempt ? 'degraded' : 'connecting');
    try {
      const token = await this.options.getAccessToken();
      if (!token) throw new Error('A current signed-in session is required');
      const ticketResponse = await fetch(`${this.basePath}/v1/ticket`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!ticketResponse.ok) throw new Error(`Bridge ticket request failed: ${ticketResponse.status}`);
      const ticket = await ticketResponse.json() as { ticket?: string };
      if (!ticket.ticket || this.stopped) throw new Error('Bridge did not issue a valid connection ticket');

      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${scheme}//${window.location.host}${this.basePath}/v1/socket?ticket=${encodeURIComponent(ticket.ticket)}`);
      this.socket = socket;
      socket.onopen = () => {
        if (this.stopped || this.socket !== socket) return socket.close();
        this.attempt = 0;
        this.options.onState?.('connected');
        const cursor = sessionStorage.getItem(this.cursorKey);
        socket.send(JSON.stringify({ type: 'resume', ...(cursor ? { cursor } : {}) }));
      };
      socket.onmessage = (message) => {
        let payload: BridgeMessage;
        try { payload = JSON.parse(String(message.data)) as BridgeMessage; } catch { return; }
        if (payload.type === 'event' && typeof payload.id === 'string') {
          Promise.resolve(this.options.onEvent({ id: payload.id, data: payload.data }))
            .then(() => {
              if (socket.readyState !== WebSocket.OPEN) return;
              sessionStorage.setItem(this.cursorKey, payload.id);
              socket.send(JSON.stringify({ type: 'ack', id: payload.id }));
            })
            .catch(() => this.options.onState?.('degraded'));
        } else if (payload.type === 'degraded') {
          this.options.onState?.('degraded');
        }
      };
      socket.onerror = () => this.options.onState?.('degraded');
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
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
