import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { startPostgresNotificationListener, type PostgresNotificationListenerStatus } from './postgresNotificationListener.js';

class FakeClient extends EventEmitter {
  constructor(private readonly shouldFail = false) { super(); }
  async connect() {
    if (this.shouldFail) throw Object.assign(new Error('connection unavailable'), { code: 'ECONNRESET' });
  }
  async query(sql: string) {
    if (sql !== 'LISTEN agent_task_queue') throw new Error('Unexpected SQL: ' + sql);
    return { rows: [] };
  }
  async end() { this.emit('end'); }
}
async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for PostgreSQL listener state.');
}

describe('PostgreSQL notification listener', () => {
  it('reconnects with bounded backoff and restores the LISTEN subscription', async () => {
    const clients: FakeClient[] = [];
    const states: PostgresNotificationListenerStatus[] = [];
    const createClient = () => {
      const client = new FakeClient(clients.length === 0);
      clients.push(client);
      return client as never;
    };
    const onNotification = vi.fn();
    const listener = startPostgresNotificationListener({
      connectionString: 'postgresql://test.invalid/test',
      channel: 'agent_task_queue',
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 200,
      clientFactory: createClient,
      onNotification,
      onStatusChange: (state) => states.push(state),
    });

    await waitFor(() => listener.getStatus().state === 'listening');
    expect(clients).toHaveLength(2);
    expect(listener.getStatus()).toMatchObject({
      state: 'listening', connected: true, subscribed: true,
      reconnectAttempts: 1, lastErrorCode: null,
    });
    expect(states.some((state) => state.state === 'backoff' && state.backoffMs === 100)).toBe(true);

    clients[1].emit('notification', { channel: 'other_channel', payload: 'ignored' });
    expect(onNotification).not.toHaveBeenCalled();
    clients[1].emit('notification', { channel: 'agent_task_queue', payload: 'run-123' });
    expect(onNotification).toHaveBeenCalledWith('run-123');
    expect(listener.getStatus().lastNotificationPayload).toBe('run-123');

    clients[1].emit('error', Object.assign(new Error('server restart'), { code: '57P01' }));
    await waitFor(() => listener.getStatus().state === 'listening' && clients.length === 3);
    expect(listener.getStatus()).toMatchObject({ connected: true, subscribed: true, reconnectAttempts: 2 });
    listener.stop();
    expect(listener.getStatus().state).toBe('stopped');
  });

  it('rejects unsafe channel identifiers', () => {
    expect(() => startPostgresNotificationListener({
      connectionString: 'postgresql://test.invalid/test',
      channel: 'safe; DROP TABLE agent_runs',
      onNotification: () => undefined,
      clientFactory: () => new FakeClient() as never,
    })).toThrow(/safe identifier/);
  });
});
