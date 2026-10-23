import type { WebSocketMessage } from '../shared/types.js';
// src/api/client.ts - Frontend WebSocket client
import { ref } from 'vue';

export interface ClientOptions {
  url?: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class RyanAIClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnect: boolean;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private messageHandlers: Map<string, (data: WebSocketMessage) => void> = new Map();
  private eventHandlers: Map<string, ((data: unknown) => void)[]> = new Map();

  public connected = ref(false);
  public authenticated = ref(false);

  constructor(options: ClientOptions = {}) {
    this.url = options.url || `ws://${window.location.host}/ws`;
    this.reconnect = options.reconnect !== false;
    this.reconnectInterval = options.reconnectInterval || 3000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
  }

  public async connect(token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.connected.value = true;
          this.reconnectAttempts = 0;

          if (token) {
            this.send('auth.verify', { token });
          }

          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (err) {
            console.error('Message parse error:', err);
          }
        };

        this.ws.onclose = () => {
          this.connected.value = false;
          if (this.reconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => this.connect(token), this.reconnectInterval);
          }
        };

        this.ws.onerror = (err: Event) => {
          console.error('WebSocket error:', err);
          reject(err);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Sends a request on the given channel and resolves with the server's response data. */
  public send(channel: string, data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = `${Date.now()}-${Math.random()}`;
      const message = {
        id,
        type: 'request',
        channel,
        data,
        timestamp: Date.now(),
      };

      // Register handler for response
      const handler = (response: WebSocketMessage) => {
        this.messageHandlers.delete(id);
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response.data);
        }
      };

      this.messageHandlers.set(id, handler);
      this.ws.send(JSON.stringify(message));

      // Timeout after 30s
      setTimeout(() => {
        if (this.messageHandlers.has(id)) {
          this.messageHandlers.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  /** Registers an event/stream handler for a channel and returns an unsubscribe function. */
  public on(channel: string, handler: (data: unknown) => void): () => void {
    if (!this.eventHandlers.has(channel)) {
      this.eventHandlers.set(channel, []);
    }
    this.eventHandlers.get(channel)!.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(channel);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }

  /** Starts a reasoning request and safely extracts the string result, defaulting to '' when absent. */
  public async reasoning(prompt: string, context?: Record<string, unknown>): Promise<string> {
    const response = await this.send('reasoning.start', {
      prompt,
      context,
      sessionId: `session-${Date.now()}`,
    });
    return typeof response === 'object' && response !== null && 'result' in response && typeof response.result === 'string' ? response.result : '';
  }

  /** Routes an incoming WebSocket message to the matching response handler or event/stream listeners. */
  private handleMessage(message: WebSocketMessage<{ authenticated?: boolean }>) {
    const { id, type, channel, data, error } = message;

    // Handle response to request
    if (type === 'response' && this.messageHandlers.has(id)) {
      const handler = this.messageHandlers.get(id)!;
      handler({ ...message, error });
    }

    // Handle events/streams
    if (type === 'event' || type === 'stream') {
      const handlers = this.eventHandlers.get(channel);
      if (handlers) {
        handlers.forEach(h => h(data));
      }
    }

    // Handle auth
    if (channel === 'auth.verify') {
      this.authenticated.value = data?.authenticated || false;
    }
  }
}

// Export Vue composable
export function useRyanAI(options?: ClientOptions) {
  const client = new RyanAIClient(options);
  const connected = ref(false);
  const authenticated = ref(false);

  const connect = async (token?: string) => {
    await client.connect(token);
    connected.value = client.connected.value;
    authenticated.value = client.authenticated.value;
  };

  const reason = async (prompt: string) => {
    return await client.reasoning(prompt);
  };

  const subscribe = (channel: string, handler: (data: unknown) => void) => {
    return client.on(channel, handler);
  };

  return {
    client,
    connected,
    authenticated,
    connect,
    reason,
    subscribe,
  };
}
