// src/cache/vectorCache.ts
import Redis from 'ioredis';
import { createHash } from 'node:crypto';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export class RyanAIVectorCache {
  private static client: Redis | null = null;

  /**
   * Returns a singleton ioredis client instance with fault tolerance
   */
  private static getClient(): Redis {
    if (!this.client) {
      this.client = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
        enableOfflineQueue: true,
        lazyConnect: false,
      });

      this.client.on('connect', () => {
        console.log('[Vector Cache] Redis connection established.');
      });

      this.client.on('error', (err) => {
        console.warn('[Vector Cache Warning] Redis error:', err.message);
      });
    }
    return this.client;
  }

  /**
   * Generates a deterministic SHA-256 key from a raw prompt string
   */
  private static hashPrompt(prompt: string): string {
    return createHash('sha256').update(prompt.trim().toLowerCase()).digest('hex');
  }

  /**
   * Caches arbitrary typed data or objects against a specific key
   */
  static async setCache<T>(key: string, data: T, ttlSeconds = 3600): Promise<void> {
    try {
      const client = this.getClient();
      const serialized = typeof data === 'string' ? data : JSON.stringify(data);
      await client.setex(`ryanai:cache:${key}`, ttlSeconds, serialized);
    } catch (error) {
      console.error('[Vector Cache Error] Failed to write key to Redis:', error);
    }
  }

  /**
   * Retrieves typed cached data by key
   */
  static async getCache<T>(key: string): Promise<T | null> {
    try {
      const client = this.getClient();
      const cached = await client.get(`ryanai:cache:${key}`);
      if (!cached) return null;

      try {
        return JSON.parse(cached) as T;
      } catch {
        return cached as unknown as T;
      }
    } catch (error) {
      console.error('[Vector Cache Error] Failed to read key from Redis:', error);
      return null;
    }
  }

  /**
   * Caches a successful reasoning output against a SHA-256 prompt digest
   */
  static async setCachedResponse(prompt: string, responseData: string, ttlSeconds = 3600): Promise<void> {
    const hashKey = `prompt:${this.hashPrompt(prompt)}`;
    await this.setCache<string>(hashKey, responseData, ttlSeconds);
    console.log('[Vector Cache] Stored semantic response for hashed prompt key.');
  }

  /**
   * Retrieves a cached reasoning response using prompt SHA-256 hashing
   */
  static async getCachedResponse(prompt: string): Promise<string | null> {
    const hashKey = `prompt:${this.hashPrompt(prompt)}`;
    const cached = await this.getCache<string>(hashKey);
    if (cached) {
      console.log('[Vector Cache] Cache hit! Returning pre-computed response.');
    }
    return cached;
  }

  /**
   * Invalidates operational cache keys
   */
  static async invalidate(key: string): Promise<void> {
    try {
      const client = this.getClient();
      await client.del(`ryanai:cache:${key}`);
    } catch (error) {
      console.error('[Vector Cache Error] Invalidation failed:', error);
    }
  }

  /**
   * Gracefully shuts down the Redis connection pool
   */
  static async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}