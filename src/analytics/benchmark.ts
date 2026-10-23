// src/analytics/benchmark.ts
import { db } from '../database/db';
import { primaryBrain, secondaryBrain, logicBrain } from '../config/brains';
import { HumanMessage } from '@langchain/core/messages';

export interface BenchmarkResult {
  brainName: string;
  latencyMs: number;
  tokenCountEstimate: number;
  tokensPerSecond: number;
  success: boolean;
  error?: string;
}

export class RyanAIBenchmarkEngine {
  /**
   * Run a telemetry benchmark across all three configured brain nodes.
   * Return latency in milliseconds and throughput estimated at four characters per
   * token. Model failures become failed results; database archival is attempted,
   * but persistence failures do not prevent returning the results.
   */
  static async runClusterBenchmark(testPrompt = "Evaluate the efficiency of eBPF packet filtering over standard socket routing."): Promise<BenchmarkResult[]> {
    console.log("[Benchmark] Initiating cluster performance analysis...");
    
    const brains = [
      { name: "nvidia-primary", model: primaryBrain },
      { name: "qwen-secondary", model: secondaryBrain },
      { name: "lmstudio-logic", model: logicBrain }
    ];

    const results: BenchmarkResult[] = [];

    for (const b of brains) {
      const startTime = performance.now();
      let success = true;
      let errorMsg: string | undefined;
      let responseContent = "";

      try {
        const response = await b.model.invoke([new HumanMessage(testPrompt)]);
        responseContent = response.content.toString();
      } catch (err: unknown) {
        success = false;
        errorMsg = (err instanceof Error ? err.message : String(err));
      }

      const endTime = performance.now();
      const latencyMs = parseFloat((endTime - startTime).toFixed(2));
      
      // Rough token estimation (approx. 4 chars per token)
      const tokenCountEstimate = Math.ceil(responseContent.length / 4);
      const tokensPerSecond = latencyMs > 0 ? parseFloat(((tokenCountEstimate / latencyMs) * 1000).toFixed(2)) : 0;

      results.push({
        brainName: b.name,
        latencyMs,
        tokenCountEstimate,
        tokensPerSecond,
        success,
        error: errorMsg
      });

      console.log(`[Benchmark] ${b.name} -> Latency: ${latencyMs}ms | Speed: ${tokensPerSecond} tok/s | Status: ${success ? 'PASS' : 'FAIL'}`);
    }

    // Persist benchmark metrics to PostgreSQL
    await this.saveBenchmarkMetrics(results);

    return results;
  }

  private static async saveBenchmarkMetrics(results: BenchmarkResult[]) {
    try {
      for (const res of results) {
        await db.agentMemory.create({
          data: {
            sessionId: "benchmark-telemetry-run",
            brainSource: `benchmark_${res.brainName}`,
            content: JSON.stringify(res),
            metadata: {
              latencyMs: res.latencyMs,
              tokensPerSecond: res.tokensPerSecond,
              success: res.success,
              timestamp: Date.now()
            }
          }
        });
      }
      console.log("[Benchmark] Performance metrics successfully archived to PostgreSQL.");
    } catch (error) {
      console.error("[Benchmark Error] Failed to persist telemetry metrics:", error);
    }
  }
}