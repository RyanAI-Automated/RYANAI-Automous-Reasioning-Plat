import { describe, expect, it, vi } from 'vitest';
import { inspectReadiness } from './readiness.js';

const healthy = async () => 'ok';
const unavailable = async () => {
  throw new Error('sensitive connection details must not escape');
};

describe('live dependency readiness', () => {
  it('reports ready only when live dependencies and startup components are ready', async () => {
    await expect(
      inspectReadiness({
        database: healthy,
        redis: healthy,
        agentCheckpointerInitialized: true,
        apiListening: true,
      }),
    ).resolves.toEqual({
      ready: true,
      services: {
        database: true,
        redis: true,
        agentCheckpointer: true,
        api: true,
      },
    });
  });

  it('marks PostgreSQL and the shared checkpointer unavailable after a failed live probe', async () => {
    const result = await inspectReadiness({
      database: unavailable,
      redis: healthy,
      agentCheckpointerInitialized: true,
      apiListening: true,
    });

    expect(result.ready).toBe(false);
    expect(result.services).toEqual({
      database: false,
      redis: true,
      agentCheckpointer: false,
      api: true,
    });
    expect(JSON.stringify(result)).not.toContain('sensitive');
  });

  it('recovers readiness when a dependency probe succeeds again', async () => {
    const database = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('ok');
    const probes = {
      database,
      redis: healthy,
      agentCheckpointerInitialized: true,
      apiListening: true,
    };

    expect((await inspectReadiness(probes)).ready).toBe(false);
    expect((await inspectReadiness(probes)).ready).toBe(true);
  });

  it('marks Redis unavailable when its live probe fails', async () => {
    const result = await inspectReadiness({
      database: healthy,
      redis: unavailable,
      agentCheckpointerInitialized: true,
      apiListening: true,
    });

    expect(result.ready).toBe(false);
    expect(result.services.redis).toBe(false);
    expect(result.services.database).toBe(true);
  });

  it('recovers readiness when Redis becomes available again', async () => {
    const redis = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('PONG');
    const probes = {
      database: healthy,
      redis,
      agentCheckpointerInitialized: true,
      apiListening: true,
    };

    expect((await inspectReadiness(probes)).ready).toBe(false);
    expect((await inspectReadiness(probes)).ready).toBe(true);
  });

  it('bounds a dependency probe that never settles', async () => {
    const neverSettles = () => new Promise<never>(() => {});
    const startedAt = Date.now();
    const result = await inspectReadiness(
      {
        database: neverSettles,
        redis: healthy,
        agentCheckpointerInitialized: true,
        apiListening: true,
      },
      10,
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(result.ready).toBe(false);
    expect(result.services.database).toBe(false);
    expect(result.services.agentCheckpointer).toBe(false);
  });

  it('clamps invalid and excessive probe timeouts to a safe bound', async () => {
    const neverSettles = () => new Promise<never>(() => {});
    const startedAt = Date.now();
    const result = await inspectReadiness(
      {
        database: neverSettles,
        redis: healthy,
        agentCheckpointerInitialized: true,
        apiListening: true,
      },
      Number.POSITIVE_INFINITY,
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(result.ready).toBe(false);
  });

  it('keeps readiness false when the checkpointer did not initialize', async () => {
    const result = await inspectReadiness({
      database: healthy,
      redis: healthy,
      agentCheckpointerInitialized: false,
      apiListening: true,
    });

    expect(result.ready).toBe(false);
    expect(result.services.agentCheckpointer).toBe(false);
  });

  it('does not report ready before the API listener is active', async () => {
    const result = await inspectReadiness({
      database: healthy,
      redis: healthy,
      agentCheckpointerInitialized: true,
      apiListening: false,
    });

    expect(result.ready).toBe(false);
    expect(result.services.api).toBe(false);
  });
});
