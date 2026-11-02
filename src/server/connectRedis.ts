import { Redis } from 'ioredis';

export interface RedisConnectionTarget {
  protocol: 'redis:' | 'rediss:';
  host: string;
  port: number;
  database: number;
  tls: boolean;
  authenticated: boolean;
}

/** Validate Redis URL shape without returning or logging credentials. */
export function inspectRedisConnectionUrl(url: string): RedisConnectionTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid REDIS_URL: expected a valid redis:// or rediss:// URL.');
  }
  if (!url.startsWith('redis://') && !url.startsWith('rediss://')) {
    throw new Error('Invalid REDIS_URL scheme: use lowercase redis:// or rediss://.');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('Invalid REDIS_URL scheme: use redis:// or rediss://.');
  }
  if (!parsed.hostname) throw new Error('Invalid REDIS_URL: a Redis hostname is required.');
  if (parsed.port && (!/^\d+$/.test(parsed.port) || Number(parsed.port) < 1 || Number(parsed.port) > 65535)) {
    throw new Error('Invalid REDIS_URL: port must be between 1 and 65535.');
  }
  const databasePath = parsed.pathname.replace(/^\//, '');
  if (databasePath && !/^\d+$/.test(databasePath)) {
    throw new Error('Invalid REDIS_URL: database path must be a numeric index.');
  }
  return {
    protocol: parsed.protocol as RedisConnectionTarget['protocol'],
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    database: databasePath ? Number(databasePath) : 0,
    tls: parsed.protocol === 'rediss:',
    authenticated: Boolean(parsed.username || parsed.password),
  };
}

function safeRedisErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z0-9_]{2,64}$/.test(code) ? code : undefined;
}

function redisFailureHint(code?: string): string {
  switch (code) {
    case 'ECONNREFUSED':
      return 'The Redis host refused the connection; verify the internal hostname and port.';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'The Redis hostname could not be resolved; verify the internal URL and service networking.';
    case 'ETIMEDOUT':
      return 'The Redis connection timed out; verify that both Render services share a region and workspace.';
    case 'ECONNRESET':
      return 'The Redis connection was reset; verify the URL scheme and TLS requirements.';
    case 'WRONGPASS':
    case 'NOAUTH':
      return 'Redis authentication failed; verify whether internal authentication is enabled and that REDIS_URL contains matching credentials.';
    case 'CERT_HAS_EXPIRED':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      return 'Redis TLS certificate validation failed; verify the rediss:// endpoint and certificate configuration.';
    default:
      return 'Verify the Render internal connection URL, shared workspace and region, and any configured internal authentication.';
  }
}

/**
 * Bound initial readiness while retaining Redis reconnection after startup.
 * ioredis interprets rediss:// as TLS and redis:// as plain TCP.
 */
export async function connectRedis(url: string, timeoutMs = 5000): Promise<Redis> {
  const target = inspectRedisConnectionUrl(url);
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
      `Redis is unavailable${detail}. ${redisFailureHint(code)} ` +
      `Endpoint: ${target.protocol}//${target.host}:${target.port}; TLS: ${target.tls ? 'enabled' : 'disabled'}; ` +
      `authentication: ${target.authenticated ? 'configured' : 'not configured'}. Credentials and raw server errors are omitted.`,
      {
        // eslint-disable-next-line preserve-caught-error -- Redis errors may embed REDIS_URL credentials.
        cause: new Error(code ? `Redis connection failed with code ${code}` : 'Redis connection attempt failed'),
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}
