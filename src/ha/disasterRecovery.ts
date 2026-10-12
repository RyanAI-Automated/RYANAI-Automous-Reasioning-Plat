import axios from 'axios';

export interface HealthCheckResult {
  primaryModelAvailable: boolean;
  activeProvider: 'OPENAI' | 'LOCAL_CUDA_FALLBACK';
  latencyMs: number;
}

export class DisasterRecoveryEngine {
  private primaryEndpoint = 'https://api.openai.com/v1/models';
  private localCudaEndpoint = process.env.LOCAL_CUDA_INFERENCE_URL || 'http://localhost:8000/v1/models';

  /**
   * Probe the primary endpoint, then the local CUDA endpoint if the first probe fails.
   * Use 2500 ms and 1500 ms request timeouts respectively; return the selected provider
   * and total elapsed milliseconds, or throw when both probes fail.
   */
  async evaluateHealthAndFailover(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await axios.get(this.primaryEndpoint, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        timeout: 2500,
      });

      return {
        primaryModelAvailable: true,
        activeProvider: 'OPENAI',
        latencyMs: Date.now() - start,
      };
    } catch {
      console.warn('⚠️ Primary LLM Cloud Endpoint degraded. Activating Local CUDA Inference Fallback...');

      // Fallback verification
      try {
        await axios.get(this.localCudaEndpoint, { timeout: 1500 });
        return {
          primaryModelAvailable: false,
          activeProvider: 'LOCAL_CUDA_FALLBACK',
          latencyMs: Date.now() - start,
        };
      } catch {
        throw new Error('CRITICAL: All reasoning providers (Cloud and Local CUDA) are unreachable.');
      }
    }
  }
}