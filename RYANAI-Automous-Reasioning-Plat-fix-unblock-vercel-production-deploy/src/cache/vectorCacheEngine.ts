import { createHash } from 'node:crypto';

export interface CacheEntry {
  hash: string;
  prompt: string;
  embedding: number[];
  response: string;
  createdAt: number;
  hitCount: number;
}

export class VectorCacheEngine {
  private inMemoryCache: Map<string, CacheEntry> = new Map();
  private similarityThreshold: number;

  constructor(similarityThreshold = 0.95) {
    this.similarityThreshold = similarityThreshold;
  }

  /**
   * Calculate Cosine Similarity between two embedding vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Search for semantically equivalent query in cache
   */
  async findMatch(queryPrompt: string, queryEmbedding: number[]): Promise<CacheEntry | null> {
    let bestMatch: CacheEntry | null = null;
    let highestScore = -1;

    for (const entry of this.inMemoryCache.values()) {
      const score = this.cosineSimilarity(queryEmbedding, entry.embedding);
      if (score > highestScore && score >= this.similarityThreshold) {
        highestScore = score;
        bestMatch = entry;
      }
    }

    if (bestMatch) {
      bestMatch.hitCount += 1;
      return bestMatch;
    }

    return null;
  }

  /**
   * Store new prompt-response vector entry
   */
  async set(prompt: string, embedding: number[], response: string): Promise<void> {
    const hash = createHash('sha256').update(prompt).digest('hex');
    this.inMemoryCache.set(hash, {
      hash,
      prompt,
      embedding,
      response,
      createdAt: Date.now(),
      hitCount: 0,
    });
  }
}