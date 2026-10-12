// File path: ./src/telemetry.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/** Create a service-name telemetry resource without starting instrumentation. */
export function initializeTelemetry(serviceName: string = "ryanai-autonomous-reasoning-engine"): Resource {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
  });
}

let sdk: NodeSDK | null = null;

/**
 * Start and cache a tracing SDK, returning the cached instance on later calls.
 * Construction errors propagate; synchronous startup errors are caught. Register a
 * SIGTERM handler that shuts down the SDK and exits with code 0.
 */
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