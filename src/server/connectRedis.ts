import { Redis } from 'ioredis';

/**
 * Bound initial readiness while retaining Redis reconnection after startup.
 * Returns the connected client.
 * timeoutMs bounds initial readiness in milliseconds. Connection failure or timeout
 * disconnects the client and rejects with a configuration diagnostic that omits the URL.
 */
export async function connectRedis(url: string, timeoutMs = 5000): Promise<Redis> {
  const client = new Redis(url, { lazyConnect: true, connectTimeout: timeoutMs });
  // connect() rejects on connection errors; avoid ioredis logging configuration.
  client.on('error', () => {});
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Redis readiness timeout')), timeoutMs);
      }),
    ]);
    return client;
  } catch {
    client.disconnect();
    throw new Error(
      'Redis is unavailable. Start PostgreSQL and Redis with `docker compose up -d --wait postgres redis`, ' +
      'or start your local services. Check REDIS_URL in .env, including its password. ' +
      'If Docker is missing in Codespaces, rebuild the dev container first.',
    );
  } finally {
    clearTimeout(timeout);
  }
}
