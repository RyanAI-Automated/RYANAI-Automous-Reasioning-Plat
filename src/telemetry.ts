import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export let sdk: NodeSDK | null = null;
let lifecycle: 'idle' | 'started' | 'stopped' = 'idle';
let handlersRegistered = false;

/** One SDK lifecycle per Node process. No exporter/content capture is enabled without explicit configuration. */
export function startTelemetry(serviceName = process.env.OTEL_SERVICE_NAME || 'ryanai-autonomous-platform'): boolean {
  if (lifecycle !== 'idle') return lifecycle === 'started';

  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const traceExporter = endpoint ? new OTLPTraceExporter({ url: endpoint }) : undefined;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version || 'unknown',
    }),
    ...(traceExporter ? { traceExporter } : {}),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': { enabled: true },
      }),
    ],
  });

  try {
    sdk.start();
    lifecycle = 'started';
    if (!handlersRegistered) {
      handlersRegistered = true;
      const shutdown = () => { void shutdownTelemetry(); };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
    }
    console.log('[Telemetry] OpenTelemetry SDK started; content capture remains disabled.');
    return true;
  } catch (error) {
    lifecycle = 'stopped';
    console.error('[Telemetry] SDK startup failed; application continues without telemetry.', error instanceof Error ? error.name : 'UnknownError');
    return false;
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (lifecycle !== 'started' || !sdk) return;
  lifecycle = 'stopped';
  try {
    await sdk.shutdown();
    console.log('[Telemetry] OpenTelemetry SDK flushed and shut down.');
  } catch (error) {
    console.error('[Telemetry] SDK shutdown failed.', error instanceof Error ? error.name : 'UnknownError');
  }
}

// This module is imported before application modules by the API launcher and telemetry:collect script.
startTelemetry();
