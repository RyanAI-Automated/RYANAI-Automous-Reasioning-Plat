import { Redis } from 'ioredis';

function safeRedisErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z0-9_]{2,64}$/.test(code)
    ? code
    : undefined;
}

/**
 * Bound initial readiness while retaining Redis reconnection after startup.
 * Returns the connected client.
 *
 * The first Redis error is reduced to its protocol/network code only. Raw error
 * messages and connection URLs can contain credentials, so they are never
 * copied into the startup diagnostic.
 */
export async function connectRedis(url: string, timeoutMs = 5000): Promise<Redis> {
  const client = new Redis(url, { lazyConnect: true, connectTimeout: timeoutMs });
  let lastErrorCode: string | undefined;
  client.on('error', (error: unknown) => {
    lastErrorCode ??= safeRedisErrorCode(error);
  });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Redis readiness timeout')), timeoutMs);
      }),
    ]);
    return client;
  } catch (error) {
    client.disconnect();
    const code = lastErrorCode ?? safeRedisErrorCode(error);
    const detail = code
      ? ` (${code})`
      : error instanceof Error && error.message === 'Redis readiness timeout'
        ? ` (initial connection exceeded ${timeoutMs}ms)`
        : '';

    throw new Error(
      `Redis is unavailable${detail}. Verify that REDIS_URL uses the Render internal connection URL, ` +
      'that the API and Key Value instance share a workspace and region, and that internal authentication matches. ' +
      'The raw connection URL and server error are intentionally omitted to protect credentials.',
    );
  } finally {
    clearTimeout(timeout);
  }
}
