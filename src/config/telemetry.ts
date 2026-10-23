// File path: ./src/config/telemetry.ts

import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

// Dynamically use OTLP collector if an endpoint is provided, otherwise fall back to console trace logging
const traceExporter = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  ? new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })
  : new ConsoleSpanExporter();

export const otelSDK = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: "ryanai-reasoning-gateway",
    [ATTR_SERVICE_VERSION]: "1.0.0",
  }),
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable high-noise file system tracing to keep telemetry logs clean
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});

// Graceful shutdown handling for process signals
const shutdownTelemetry = (signal: string) => {
  otelSDK
    .shutdown()
    .then(() => console.log(`[Telemetry] Tracing successfully terminated (${signal})`))
    .catch((error) => console.error(`[Telemetry] Error terminating tracing (${signal}):`, error))
    .finally(() => process.exit(0));
};

process.on("SIGTERM", () => shutdownTelemetry("SIGTERM"));
process.on("SIGINT", () => shutdownTelemetry("SIGINT"));