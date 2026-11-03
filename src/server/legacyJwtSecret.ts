import { randomBytes } from 'node:crypto';

/**
 * Resolve signing material for the legacy Fastify entrypoint.
 * Production must always receive a strong, explicitly managed secret.
 * Local development gets an ephemeral secret rather than a predictable
 * committed fallback, so tokens cannot be forged from repository contents.
 */
export function resolveLegacyJwtSecret(
  nodeEnv: string | undefined,
  configuredSecret: string | undefined,
): string {
  const secret = configuredSecret?.trim();
  if (secret) {
    if (nodeEnv === 'production' && Buffer.byteLength(secret, 'utf8') < 32) {
      throw new Error('JWT_SECRET must contain at least 32 bytes in production.');
    }
    return secret;
  }

  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error('JWT_SECRET is required unless NODE_ENV is explicitly development or test.');
  }

  return randomBytes(32).toString('base64url');
}
