import { Redis } from 'ioredis';

/**
 * Bound initial readiness while retaining Redis reconnection after startup.
 * Returns the connected client.
 * timeoutMs bounds initial readiness in milliseconds. Connection failure or timeout
 * disconnects the client and rejects with a configuration diagnostic that omits the URL.
 */
export async function connectRedis(url: string, timeoutMs = 5000): Promise<Redis> {
  // Normalize localhost to 127.0.0.1 to prevent Windows IPv6 (::1) vs Docker port-binding mismatches
  const normalizedUrl = (url || 'redis://127.0.0.1:6379').replace('localhost', '127.0.0.1');

  const client = new Redis(normalizedUrl, {
    lazyConnect: true,
    connectTimeout: timeoutMs,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(times * 50, 2000);
    },
    enableReadyCheck: true,
  });

  // Suppress unhandled error crashes during initial connection probe
  client.on('error', (err) => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[Redis Connection Warning]: ${err.message}`);
    }
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
  } catch (err: any) {
    client.disconnect();
    throw new Error(
      `Redis is unavailable (${err?.message || 'Connection failed'}). Start PostgreSQL and Redis with \`docker compose up -d --wait postgres redis\`, ` +
      'or start your local services. Check REDIS_URL in .env, including its password. ' +
      'If Docker is missing in Codespaces, rebuild the dev container first.',
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
