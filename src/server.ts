/**
 * This legacy server entrypoint is intentionally quarantined.
 *
 * RyanAI has one supported persistent API runtime:
 * - Development: npm run dev:api
 * - Built runtime: npm start
 *
 * Both commands use src/server/launcher.ts, which owns dependency readiness,
 * worker lifecycle, telemetry, and graceful shutdown.
 */
export {};

throw new Error(
  'Unsupported legacy API entrypoint. Use npm run dev:api for development or npm start for the built runtime (src/server/launcher.ts).',
);
