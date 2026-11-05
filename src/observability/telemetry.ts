import { startTelemetry } from '../telemetry.js';

/** @deprecated Compatibility facade for the canonical process-wide SDK. */
export class RyanAITelemetry {
  static initialize(): boolean {
    return startTelemetry();
  }
}
