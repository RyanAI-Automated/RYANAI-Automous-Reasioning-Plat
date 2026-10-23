import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { AirGapVectorStore } from './vectorStore';

let store: AirGapVectorStore;

beforeEach(async () => {
  store = new AirGapVectorStore();
  await store.clear();
});

describe('AirGapVectorStore', () => {
  it('ranks saved vectors and excludes removed entries', async () => {
    await store.save({ id: 'perpendicular', vector: [0, 1] });
    await store.save({ id: 'aligned', vector: [1, 0] });
    expect(
      (await store.similaritySearch([1, 0], 1)).map(({ id }) => id),
    ).toEqual(['aligned']);
    await store.remove('aligned');
    expect(await store.get('aligned')).toBeNull();
    expect((await store.similaritySearch([1, 0])).map(({ id }) => id)).toEqual([
      'perpendicular',
    ]);
  });

  it('clears durable vectors as well as the search index', async () => {
    await store.save({ id: 'persisted', vector: [1, 0] });
    await store.clear();
    expect(await store.get('persisted')).toBeNull();
    expect(await store.similaritySearch([1, 0])).toEqual([]);
  });
});
