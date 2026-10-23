// src/observability/telemetry.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

export class RyanAITelemetry {
  private static sdk: NodeSDK | null = null;

  /**
   * Initialize the shared tracing SDK and register shutdown on SIGTERM.
   * Repeated calls do nothing once an SDK exists. Construction errors propagate;
   * synchronous start errors are caught and leave the SDK cached.
   */
  static initialize() {
    if (this.sdk) return;

    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';

    const traceExporter = new OTLPTraceExporter({
      url: otlpEndpoint,
    });

    this.sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'ryanai-autonomous-platform',
        'service.version': '1.0.0',
      }),
      traceExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    try {
      this.sdk.start();
      console.log("[Telemetry] OpenTelemetry distributed tracing SDK initialized successfully.");
    } catch (error) {
      console.error("[Telemetry Error] Failed to start OpenTelemetry SDK:", error);
    }

    process.on('SIGTERM', async () => {
      try {
        await this.sdk?.shutdown();
        console.log("[Telemetry] Tracing SDK shut down gracefully.");
      } catch (error) {
        console.error("[Telemetry Error] Error during shutdown:", error);
      } finally {
        process.exit(0);
      }
    });
  }
}