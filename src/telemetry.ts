// File path: ./src/telemetry.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export function initializeTelemetry(serviceName: string = "ryanai-autonomous-reasoning-engine"): Resource {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
  });
}

let sdk: NodeSDK | null = null;

export function startTelemetry(serviceName: string = "ryanai-autonomous-reasoning-engine") {
  if (sdk) {
    return sdk;
  }

  const resource = initializeTelemetry(serviceName);

  sdk = new NodeSDK({
    resource,
    resourceDetectors: [],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-pino': { enabled: true },
        '@opentelemetry/instrumentation-http': { enabled: true },
      }),
    ],
  });

  try {
    sdk.start();
    console.log('🔍 [OpenTelemetry] Tracing & Logging Initialized');
  } catch (error) {
    console.error('[OpenTelemetry] Error initializing OpenTelemetry SDK:', error);
  }

  process.on('SIGTERM', () => {
    sdk?.shutdown()
      .then(() => console.log('📊 [OpenTelemetry] SDK shut down successfully'))
      .catch((error) => console.error('[OpenTelemetry] Error shutting down SDK', error))
      .finally(() => process.exit(0));
  });

  return sdk;
}