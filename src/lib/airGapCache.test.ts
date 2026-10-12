import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import {
  airGapCache,
  saveVector,
  loadVector,
  clearVectorCache,
  deleteVector,
  VectorEntry,
  AirGapCache,
  clearCache,
} from './airGapCache';

describe('AirGapCache and Vector Operations', () => {
  beforeEach(async () => {
    await clearCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should save and load a vector entry correctly', async () => {
    const entry: VectorEntry = {
      id: 'vec-1',
      vector: [0.1, 0.2, 0.3],
      metadata: { source: 'test' },
      label: 'custom field',
      attributes: { tags: ['offline'], score: 0.9 },
      iv: 'user field with a storage-key name',
      ciphertext: 'another user field',
    };

    await saveVector(entry);
    const loaded = await loadVector('vec-1');

    expect(loaded).toEqual(entry);
  });

  it('should return null for non-existent keys', async () => {
    const loaded = await loadVector('non-existent');
    expect(loaded).toBeNull();
  });

  it('should expire entries based on TTL', async () => {
    vi.useFakeTimers();

    const entry: VectorEntry = {
      id: 'vec-ttl',
      vector: [0.5, 0.6],
    };

    await airGapCache.set(entry.id, entry, 1000);

    // Verify initial entry existence
    const cachedBefore = await airGapCache.get(entry.id);
    expect(cachedBefore).toEqual(entry);

    // Fast-forward time beyond the TTL
    vi.advanceTimersByTime(1050);

    // Await the expired lookup
    const cachedAfter = await airGapCache.get(entry.id);
    expect(cachedAfter).toBeNull();
  });

  it('should overwrite and delete persisted vectors', async () => {
    await saveVector({ id: 'replace', vector: [1] });
    await saveVector({ id: 'replace', vector: [2], metadata: { revision: 2 } });
    expect(await loadVector('replace')).toEqual({
      id: 'replace',
      vector: [2],
      metadata: { revision: 2 },
    });
    await deleteVector('replace');
    expect(await loadVector('replace')).toBeNull();
    await deleteVector('replace');
  });

  it('should expire at the exact TTL boundary', async () => {
    vi.useFakeTimers();
    await airGapCache.set('boundary', 'value', 1000);
    vi.advanceTimersByTime(1000);
    expect(await airGapCache.get('boundary')).toBeNull();
  });

  it('should clear all cache entries', async () => {
    await saveVector({ id: 'vec-1', vector: [1] });
    await saveVector({ id: 'vec-2', vector: [2] });

    await clearVectorCache();

    expect(await loadVector('vec-1')).toBeNull();
    expect(await loadVector('vec-2')).toBeNull();
  });

  it('clears both persistent vectors and in-memory values through clearCache', async () => {
    await saveVector({ id: 'persisted', vector: [1, 2] });
    await airGapCache.set('memory', { result: 'cached' });
    await clearCache();
    expect(await loadVector('persisted')).toBeNull();
    expect(await airGapCache.get('memory')).toBeNull();
  });

  it('rejects a write whose request succeeds but transaction subsequently aborts', async () => {
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = put.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(saveVector({ id: 'aborted', vector: [1] })).rejects.toThrow(
      'Cache transaction aborted',
    );
    expect(await loadVector('aborted')).toBeNull();
  });

  it.each([0, -1])(
    'expires immediately for an explicit TTL of %s',
    async (ttl) => {
      const cache = new AirGapCache({ ttl: 1000 });
      await cache.set('entry', 'value', ttl);
      expect(await cache.get('entry')).toBeNull();
    },
  );

  it('uses a custom default TTL and resets expiry when a value is overwritten', async () => {
    vi.useFakeTimers();
    const cache = new AirGapCache({ ttl: 100 });
    await cache.set('entry', 'original');
    vi.advanceTimersByTime(99);
    expect(await cache.get('entry')).toBe('original');
    await cache.set('entry', 'replacement', 200);
    vi.advanceTimersByTime(1);
    expect(await cache.get('entry')).toBe('replacement');
    vi.advanceTimersByTime(199);
    expect(await cache.get('entry')).toBeNull();
    vi.setSystemTime(Date.now() - 500);
    expect(await cache.get('entry')).toBeNull();
  });
});
