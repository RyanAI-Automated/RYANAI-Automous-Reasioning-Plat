// File path: ./src/services/vectorCache.ts

import { createClient } from "redis";
import { Pool } from "pg";

export class VectorCacheManager {
  private redisClient;
  private pgPool: Pool;

  constructor(redisUrl: string, connectionString: string) {
    this.redisClient = createClient({ url: redisUrl });
    this.redisClient.connect().catch(console.error);
    this.pgPool = new Pool({ connectionString });
  }

  async getCachedResponse(embedding: number[]): Promise<string | null> {
    // Check Redis fast-cache first
    const cacheKey = `vec_cache:${JSON.stringify(embedding.slice(0, 5))}`;
    const cached = await this.redisClient.get(cacheKey);
    if (cached) return cached;

    // Fallback to pgvector semantic similarity search
    const query = `
      SELECT response FROM reasoning_cache 
      WHERE 1 - (embedding <=> $1::vector) > 0.95 
      LIMIT 1;
    `;
    const result = await this.pgPool.query(query, [`[${embedding.join(",")}]`]);
    if (result.rows.length > 0) {
      await this.redisClient.setEx(cacheKey, 3600, result.rows[0].response);
      return result.rows[0].response;
    }
    return null;
  }
}