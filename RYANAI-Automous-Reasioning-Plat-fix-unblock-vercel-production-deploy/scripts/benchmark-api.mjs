const target = process.env.BENCHMARK_URL;
const concurrency = Number(process.env.BENCHMARK_CONCURRENCY ?? "10");
const durationSeconds = Number(process.env.BENCHMARK_DURATION ?? "10");
const maxP95Ms = Number(process.env.BENCHMARK_MAX_P95_MS ?? "1000");

if (!target) {
  throw new Error("Set BENCHMARK_URL to the API health endpoint to benchmark.");
}

let endpoint;
try {
  endpoint = new URL(target);
} catch {
  throw new Error("BENCHMARK_URL must be an absolute HTTP(S) URL.");
}

if (!["http:", "https:"].includes(endpoint.protocol)) {
  throw new Error("BENCHMARK_URL must use HTTP or HTTPS.");
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
  throw new Error("BENCHMARK_CONCURRENCY must be an integer from 1 to 50.");
}
if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 60) {
  throw new Error("BENCHMARK_DURATION must be an integer from 1 to 60 seconds.");
}
if (!Number.isFinite(maxP95Ms) || maxP95Ms <= 0) {
  throw new Error("BENCHMARK_MAX_P95_MS must be a positive number.");
}

const latencies = [];
let failures = 0;
let firstFailure;
const startedAt = performance.now();
const deadline = Date.now() + durationSeconds * 1000;

async function worker() {
  while (Date.now() < deadline) {
    const started = performance.now();
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
      await response.arrayBuffer();
      if (!response.ok) {
        failures += 1;
        firstFailure ??= `HTTP ${response.status}`;
      }
    } catch (error) {
      failures += 1;
      if (!firstFailure) {
        const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
        firstFailure = `${error instanceof Error ? error.message : String(error)}${cause}`;
      }
    } finally {
      latencies.push(performance.now() - started);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
latencies.sort((left, right) => left - right);

if (latencies.length === 0) {
  throw new Error("The benchmark completed without making any requests.");
}

const percentile = (value) => latencies[Math.ceil(value * latencies.length) - 1];
const elapsedSeconds = (performance.now() - startedAt) / 1000;
const requestsPerSecond = latencies.length / elapsedSeconds;
const p95Ms = percentile(0.95);

console.log(`Target: ${endpoint.origin}${endpoint.pathname}`);
console.log(`Requests: ${latencies.length}; failures: ${failures}; concurrency: ${concurrency}`);
console.log(`Throughput: ${requestsPerSecond.toFixed(2)} requests/second`);
console.log(`Latency ms: p50=${percentile(0.50).toFixed(1)}, p95=${p95Ms.toFixed(1)}, p99=${percentile(0.99).toFixed(1)}`);
console.log(`p95 threshold: ${maxP95Ms} ms`);
if (firstFailure) {
  console.error(`First request failure: ${firstFailure}`);
}

if (failures > 0 || p95Ms > maxP95Ms) {
  process.exitCode = 1;
}
