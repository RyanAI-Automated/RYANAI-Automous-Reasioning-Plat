/**
 * The supported production API runtime is src/server/launcher.ts.
 * This legacy entrypoint has no PostgreSQL-backed readiness contract and
 * must never be used as a production or staging service.
 */
export function assertLegacyEntrypointEnvironment(nodeEnv: string | undefined): void {
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error(
      'The legacy API entrypoint is restricted to NODE_ENV=development or test. Use src/server/launcher.ts for supported runtime startup.',
    );
  }
}
