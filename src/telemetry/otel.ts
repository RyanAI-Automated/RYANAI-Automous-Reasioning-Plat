// File path: ./src/telemetry/otel.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'ryanai-autonomous-reasoning-engine',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-pino': { enabled: true },
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

export function startTelemetry() {
  try {
    sdk.start();
    console.log('📊 [OpenTelemetry] Tracing, metrics, and log correlation initialized successfully.');
  } catch (error) {
    console.error('[OpenTelemetry] Error initializing telemetry SDK:', error);
  }

  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('📊 [OpenTelemetry] SDK shut down successfully'))
      .catch((error) => console.error('📊 [OpenTelemetry] Error shutting down SDK', error))
      .finally(() => process.exit(0));
  });

  process.on('SIGINT', () => {
    sdk.shutdown()
      .then(() => console.log('📊 [OpenTelemetry] SDK shut down successfully'))
      .catch((error) => console.error('📊 [OpenTelemetry] Error shutting down SDK', error))
      .finally(() => process.exit(0));
  });
}