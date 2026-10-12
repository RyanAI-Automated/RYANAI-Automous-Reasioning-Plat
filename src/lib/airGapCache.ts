const DB_NAME = 'ryan_ai_airgap_cache';
const STORE_NAME = 'vectors';
const DB_VERSION = 1;

export interface VectorEntry {
  id: string;
  vector: number[];
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface StoredVectorRecord {
  id: string;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  extraFields?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

async function getKey(): Promise<CryptoKey> {
  // Preserve the existing on-disk format. This application-wide key provides
  // obfuscation, not protection against someone with access to this application.
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode('RYANAI-AIRGAP-STATIC-SALT-KEY-2026'),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('ryan-salt'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Run one IndexedDB request and resolve its result only after transaction commit.
 * Closes the database after the operation; opening, request, and transaction errors reject.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      // Resolve only after commit, so a successful request followed by an abort
      // cannot be reported as a successful write.
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Cache transaction aborted'));
      transaction.onerror = () => reject(transaction.error ?? request.error);
    });
  } finally {
    database.close();
  }
}

/**
 * Insert or replace a persisted vector by ID, resolving after transaction commit.
 * Custom fields are also persisted. The vector uses a shared application
 * key for obfuscation; metadata and custom fields remain unencrypted.
 * Serialization, cryptography, and IndexedDB failures reject.
 */
export async function saveVector(entry: VectorEntry): Promise<void> {
  const { id, vector, metadata, ...extraFields } = entry;
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify(vector));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    payload,
  );
  const record: StoredVectorRecord = {
    id,
    iv,
    ciphertext,
    metadata,
    extraFields,
  };
  await withStore('readwrite', (store) => store.put(record));
}

/**
 * Load and decrypt a persisted vector, returning null only when its ID is absent.
 * IndexedDB, cryptography, and JSON parsing failures reject.
 */
export async function loadVector(id: string): Promise<VectorEntry | null> {
  const record = await withStore<StoredVectorRecord | undefined>(
    'readonly',
    (store) => store.get(id),
  );
  if (!record) return null;

  const key = await getKey();
  const iv = new Uint8Array(record.iv.length);
  iv.set(record.iv);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    record.ciphertext,
  );
  return {
    ...record.extraFields,
    id: record.id,
    vector: JSON.parse(new TextDecoder().decode(decrypted)),
    metadata: record.metadata,
  };
}

/**
 * Delete a persisted vector, resolving after commit even if the ID is absent.
 * IndexedDB failures reject.
 */
export async function deleteVector(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}

/** Clear all persisted vectors and resolve after commit; IndexedDB failures reject. */
export async function clearVectorCache(): Promise<void> {
  await withStore('readwrite', (store) => store.clear());
}

/**
 * Clear persisted vectors, then the shared in-memory cache.
 * If IndexedDB clearing fails, reject without clearing the in-memory cache.
 */
export async function clearCache(): Promise<void> {
  await clearVectorCache();
  await airGapCache.clear();
}

interface CacheEntry<T = unknown> {
  value: T;
  expiry: number;
}

export class AirGapCache {
  private store = new Map<string, CacheEntry>();
  private defaultTtl: number;

  constructor(options?: { ttl?: number; [key: string]: unknown }) {
    this.defaultTtl = options?.ttl ?? 3600000; // 1 hour default
  }

  /**
   * Return the cached value, or null when absent or at/past its expiry.
   * Expired entries are removed on access.
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  /**
   * Replace a cached value with a TTL in milliseconds, using the instance default
   * (one hour unless configured) when omitted. Zero or negative TTLs expire immediately.
   */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const expiry = Date.now() + (ttl ?? this.defaultTtl);
    this.store.set(key, { value, expiry });
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

export const airGapCache = new AirGapCache();
