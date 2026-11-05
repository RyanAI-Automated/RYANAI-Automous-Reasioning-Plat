import { Client } from 'pg';

export type PostgresNotificationListenerState = 'connecting' | 'listening' | 'backoff' | 'stopped';
export interface PostgresNotificationListenerStatus {
  state: PostgresNotificationListenerState;
  connected: boolean;
  subscribed: boolean;
  reconnectAttempts: number;
  backoffMs: number;
  lastConnectedAt: string | null;
  lastNotificationAt: string | null;
  lastNotificationPayload: string | null;
  lastErrorCode: string | null;
}
interface NotificationMessage { channel?: string; payload?: string; }
interface NotificationClient {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
  on(event: 'notification', listener: (message: NotificationMessage) => void): this;
  on(event: 'error', listener: (error: Error & { code?: string }) => void): this;
  on(event: 'end', listener: () => void): this;
}
export interface PostgresNotificationListenerOptions {
  connectionString: string;
  channel: string;
  onNotification: (payload: string | undefined) => void;
  onStatusChange?: (status: PostgresNotificationListenerStatus) => void;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  clientFactory?: () => NotificationClient;
}

/** Dedicated PostgreSQL LISTEN session with capped exponential reconnect backoff. */
export function startPostgresNotificationListener(options: PostgresNotificationListenerOptions) {
  if (!options.connectionString) throw new Error('A PostgreSQL listener connection string is required.');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.channel)) {
    throw new Error('PostgreSQL notification channel must be a safe identifier.');
  }
  const baseDelay = Math.max(100, Math.trunc(options.reconnectBaseDelayMs ?? 1_000));
  const maxDelay = Math.max(baseDelay, Math.trunc(options.reconnectMaxDelayMs ?? 30_000));
  const createClient = options.clientFactory ?? (() => new Client({ connectionString: options.connectionString }) as unknown as NotificationClient);
  let currentClient: NotificationClient | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let consecutiveFailures = 0;
  let stopped = false;
  let status: PostgresNotificationListenerStatus = {
    state: 'connecting', connected: false, subscribed: false, reconnectAttempts: 0,
    backoffMs: 0, lastConnectedAt: null, lastNotificationAt: null,
    lastNotificationPayload: null, lastErrorCode: null,
  };

  const publishStatus = () => options.onStatusChange?.({ ...status });
  const safeErrorCode = (error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
      return error.code.slice(0, 32);
    }
    return 'CONNECTION_FAILED';
  };

  const scheduleReconnect = (attemptGeneration: number, error: unknown) => {
    if (stopped || attemptGeneration !== generation || reconnectTimer) return;
    generation += 1;
    const failedClient = currentClient;
    currentClient = undefined;
    consecutiveFailures += 1;
    const delay = Math.min(maxDelay, baseDelay * (2 ** Math.min(consecutiveFailures - 1, 10)));
    status = {
      ...status, state: 'backoff', connected: false, subscribed: false,
      reconnectAttempts: status.reconnectAttempts + 1, backoffMs: delay,
      lastErrorCode: safeErrorCode(error),
    };
    publishStatus();
    if (failedClient) void failedClient.end().catch(() => undefined);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connectListener();
    }, delay);
    reconnectTimer.unref?.();
  };

  const connectListener = async () => {
    if (stopped || currentClient) return;
    const attemptGeneration = ++generation;
    let candidate: NotificationClient;
    try {
      candidate = createClient();
    } catch (error) {
      scheduleReconnect(attemptGeneration, error);
      return;
    }
    currentClient = candidate;
    status = { ...status, state: 'connecting', connected: false, subscribed: false, backoffMs: 0 };
    publishStatus();

    candidate.on('notification', (message) => {
      if (stopped || attemptGeneration !== generation || status.state !== 'listening') return;
      if (message.channel !== options.channel) return;
      status = { ...status, lastNotificationAt: new Date().toISOString(), lastNotificationPayload: message.payload ?? null };
      publishStatus();
      options.onNotification(message.payload);
    });
    candidate.on('error', (error) => scheduleReconnect(attemptGeneration, error));
    candidate.on('end', () => {
      if (!stopped) scheduleReconnect(attemptGeneration, new Error('PostgreSQL listener session ended.'));
    });

    try {
      await candidate.connect();
      if (stopped || attemptGeneration !== generation) {
        await candidate.end().catch(() => undefined);
        return;
      }
      await candidate.query('LISTEN ' + options.channel);
      if (stopped || attemptGeneration !== generation) {
        await candidate.end().catch(() => undefined);
        return;
      }
      consecutiveFailures = 0;
      status = {
        ...status, state: 'listening', connected: true, subscribed: true, backoffMs: 0,
        lastConnectedAt: new Date().toISOString(), lastErrorCode: null,
      };
      publishStatus();
    } catch (error) {
      scheduleReconnect(attemptGeneration, error);
    }
  };

  void connectListener();
  return {
    getStatus: () => ({ ...status }),
    stop: () => {
      if (stopped) return;
      stopped = true;
      generation += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      const activeClient = currentClient;
      currentClient = undefined;
      status = { ...status, state: 'stopped', connected: false, subscribed: false, backoffMs: 0 };
      publishStatus();
      if (activeClient) void activeClient.end().catch(() => undefined);
    },
  };
}
