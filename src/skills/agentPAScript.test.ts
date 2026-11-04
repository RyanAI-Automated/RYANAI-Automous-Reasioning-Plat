import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPAScript } from './agentPAScript.js';

describe('AgentPAScript read-only observer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses to report active without real health probes', async () => {
    const observer = new AgentPAScript();
    await expect(observer.start()).rejects.toThrow('without real API, PostgreSQL and Redis health probes');
    expect(observer.getStatus().active).toBe(false);
    expect(observer.getStatus().workState).toBe('stopped');
  });

  it('performs a real initial observation and reports each dependency', async () => {
    const healthCheck = vi.fn().mockResolvedValue({ api: true, database: true, redis: true });
    const observer = new AgentPAScript({ healthCheck, heartbeatIntervalMs: 60000 });
    const reports: unknown[] = [];
    observer.on('report', (report) => reports.push(report));

    await observer.start();

    expect(healthCheck).toHaveBeenCalledTimes(1);
    expect(observer.getStatus()).toMatchObject({
      active: true,
      workState: 'monitoring',
      health: { api: true, database: true, redis: true },
      observationsCompleted: 1,
      eBPFPolicyEnforced: false,
      genXPolicyEngineAvailable: true,
    });
    expect(reports).toHaveLength(1);
    await observer.stop();
    expect(observer.getStatus().active).toBe(false);
  });

  it('continues read-only monitoring and reports degraded probes without leaking errors', async () => {
    vi.useFakeTimers();
    const healthCheck = vi.fn()
      .mockResolvedValueOnce({ api: true, database: true, redis: true })
      .mockRejectedValueOnce(new Error('postgres://user:secret@example.invalid/db'));
    const observer = new AgentPAScript({ healthCheck, heartbeatIntervalMs: 1000 });

    await observer.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(healthCheck).toHaveBeenCalledTimes(2);
    expect(observer.getStatus().workState).toBe('degraded');
    expect(observer.getStatus().lastError).not.toContain('secret');
    expect(observer.getStatus().lastReport).toContain('Read-only monitoring continues');
    await observer.stop();
  });

  it('reports an unhealthy dependency as degraded rather than healthy', async () => {
    const observer = new AgentPAScript({
      healthCheck: async () => ({ api: true, database: false, redis: true }),
    });
    await observer.start();
    expect(observer.getStatus().workState).toBe('degraded');
    expect(observer.getStatus().health.database).toBe(false);
    await observer.stop();
  });
});
