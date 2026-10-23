import Redis from 'ioredis';

export interface ResourceUsageEvent {
  organizationId: string;
  tokensConsumed: number;
  computeTimeMs: number;
  ebpfInvocations: number;
  timestamp: number;
}

export class TokenMeterEngine {
  private redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }

  /**
   * Record resource consumption atomically in Redis
   */
  async trackUsage(event: ResourceUsageEvent): Promise<{ monthlyTokens: number; monthlyCostUsd: number }> {
    const currentMonth = new Date().toISOString().slice(0, 7); // e.g., '2026-09'
    const orgKey = `billing:${event.organizationId}:${currentMonth}`;

    const pipeline = this.redis.pipeline();
    pipeline.hincrby(orgKey, 'total_tokens', event.tokensConsumed);
    pipeline.hincrby(orgKey, 'total_compute_ms', event.computeTimeMs);
    pipeline.hincrby(orgKey, 'total_ebpf_calls', event.ebpfInvocations);

    const results = await pipeline.exec();
    const totalTokens = (results?.[0]?.[1] as number) || 0;
    const totalComputeMs = (results?.[1]?.[1] as number) || 0;

    // Rate calculation: $0.002 per 1k tokens, $0.0001 per sec compute
    const tokenCost = (totalTokens / 1000) * 0.002;
    const computeCost = (totalComputeMs / 1000) * 0.0001;
    const monthlyCostUsd = parseFloat((tokenCost + computeCost).toFixed(4));

    return {
      monthlyTokens: totalTokens,
      monthlyCostUsd,
    };
  }
}